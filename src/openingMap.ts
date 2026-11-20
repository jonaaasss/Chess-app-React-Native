// Opening map: the splits in an opening that change your plan, found from
// the Lichess opening explorer (no AI).
//
// 1. The explorer tree is walked from the opening's start position, heaviest
//    lines first: on your move the most played move (or the one you chose
//    instead, `overrides`), on the opponent's move every move with at least
//    `minShare` of the games, up to `depth` of your moves.
// 2. At each opponent decision every followed move gets a plan signature:
//    your moves that come back in most of its lines within the next
//    `lookahead` of your moves. Moves with similar signatures are merged
//    into one group (they need the same plan).
// 3. A decision with two or more groups is a split. Each group is searched
//    again for later splits; a group without any becomes a "situation": one
//    Plan card from the position after its most played move.
import { toFen } from './chess';
import { makeMove, type GameState } from './chessEngine';
import { moveForSan, type ExplorerResult } from './lichessExplorer';
import type { PromotionPiece } from './types';
import type { LineMove } from './importOpening';

export interface MapMove {
  from: string;
  to: string;
  promotion?: PromotionPiece;
  san: string;
  ply: number; // index from the opening's start (0 = first move after it)
}

export interface MapNode {
  state: GameState;
  path: MapMove[];
  weight: number;
  games: number;
  mine: boolean; // your move here
  children: { move: MapMove; share: number; node: MapNode }[];
  // Your move only: other moves people play here (at least 20% of the games).
  alternatives: { san: string; share: number }[];
}

export interface MapGroup {
  moves: { move: MapMove; share: number }[]; // the opponent moves in the group
  share: number;
  main: MapNode; // after the group's most played move
  splits: MapSplit[];
}

export interface MapSplit {
  at: MapNode; // the opponent decision
  groups: MapGroup[];
}

export interface Situation {
  node: MapNode;
  label: string; // the moves that lead here since the start
  share: number; // share of the games that reach it
  decisions: MapMove[]; // the opponent's choices at the splits on the way
}

export interface MapOptions {
  depth: number;
  lookahead: number;
  minShare: number;
  minGames: number;
  maxRequests: number;
}

export const DEFAULT_MAP_OPTIONS: MapOptions = { depth: 6, lookahead: 3, minShare: 0.15, minGames: 30, maxRequests: 260 };

export interface MapResult {
  root: MapNode;
  splits: MapSplit[];
  situations: Situation[];
  requests: number;
}

export async function scanOpening(
  start: GameState,
  yourColor: 'w' | 'b',
  fetcher: (fen: string) => Promise<ExplorerResult>,
  overrides: Map<string, string>,
  opts: MapOptions = DEFAULT_MAP_OPTIONS,
  onProgress?: (text: string) => void,
  cancelled?: () => boolean
): Promise<MapResult> {
  let requests = 0;
  const root: MapNode = { state: start, path: [], weight: 1, games: 0, mine: start.turn === yourColor, children: [], alternatives: [] };
  const queue: { node: MapNode; own: number }[] = [{ node: root, own: 0 }];

  while (queue.length > 0) {
    if (cancelled?.()) break;
    queue.sort((a, b) => b.node.weight - a.node.weight);
    const { node, own } = queue.shift()!;
    if (node.mine && own >= opts.depth) continue;
    if (requests >= opts.maxRequests) continue;
    requests += 1;
    onProgress?.(`Reading the explorer… ${requests} positions`);
    const st = node.state;
    const res = await fetcher(toFen(st.pieces, st.turn, st.castling, st.enPassant));
    node.games = res.games;
    if (res.games < opts.minGames || res.moves.length === 0) continue;
    const fen = toFen(st.pieces, st.turn, st.castling, st.enPassant);
    const followed = node.mine
      ? (() => {
          const forced = overrides.get(fen);
          const pick = res.moves.find((m) => m.san === forced) ?? res.moves[0];
          node.alternatives = res.moves.filter((m) => m !== pick && m.games / res.games >= 0.2).map((m) => ({ san: m.san, share: m.games / res.games }));
          return [pick];
        })()
      : res.moves.filter((m) => m.games / res.games >= opts.minShare && m.games >= opts.minGames);
    for (const m of followed) {
      const mv = moveForSan(st, m.san);
      if (!mv) continue;
      const r = makeMove(st, mv.from, mv.to, mv.promotion);
      const share = m.games / res.games;
      const child: MapNode = {
        state: r.next,
        path: [...node.path, { ...mv, san: r.san, ply: node.path.length }],
        weight: node.mine ? node.weight : node.weight * share,
        games: m.games,
        mine: r.next.turn === yourColor,
        children: [],
        alternatives: []
      };
      node.children.push({ move: child.path[child.path.length - 1], share: node.mine ? 1 : share, node: child });
      queue.push({ node: child, own: own + (node.mine ? 1 : 0) });
    }
  }

  // Your moves in the next `lookahead` of your moves, with how much of the
  // node's weight reaches them.
  function signature(node: MapNode): Set<string> {
    const counts = new Map<string, number>();
    let total = 0;
    const walk = (n: MapNode, w: number, ownLeft: number, seen: Set<string>) => {
      if (n.children.length === 0 || ownLeft === 0) {
        total += w;
        seen.forEach((k) => counts.set(k, (counts.get(k) ?? 0) + w));
        return;
      }
      for (const c of n.children) {
        const next = new Set(seen);
        if (n.mine) next.add(`${c.move.from}${c.move.to}`);
        walk(c.node, w * c.share, n.mine ? ownLeft - 1 : ownLeft, next);
      }
    };
    walk(node, 1, opts.lookahead, new Set());
    return new Set([...counts].filter(([, w]) => total > 0 && w / total >= 0.6).map(([k]) => k));
  }
  const similar = (a: Set<string>, b: Set<string>) => {
    if (a.size === 0 && b.size === 0) return true;
    const inter = [...a].filter((k) => b.has(k)).length;
    return inter / new Set([...a, ...b]).size >= 0.5;
  };

  // A situation must be reached in at least this share of all games; rarer
  // groups are left out, and positions rarer than twice this are not split.
  const MIN_GROUP = 0.15;
  function findSplits(node: MapNode, depthLeft: number): MapSplit[] {
    if (depthLeft <= 0 || node.children.length === 0 || node.weight < MIN_GROUP * 2) return [];
    if (node.mine || node.children.length < 2) return node.children.flatMap((c) => findSplits(c.node, depthLeft));
    const sigs = node.children.map((c) => signature(c.node));
    const groups: { idx: number[]; sig: Set<string> }[] = [];
    node.children.forEach((_, i) => {
      const g = groups.find((x) => similar(x.sig, sigs[i]));
      if (g) g.idx.push(i);
      else groups.push({ idx: [i], sig: sigs[i] });
    });
    const big = groups.filter((g) => g.idx.reduce((s, i) => s + node.children[i].node.weight, 0) >= MIN_GROUP);
    if (big.length < 2) return node.children.flatMap((c) => findSplits(c.node, depthLeft));
    groups.splice(0, groups.length, ...big);
    return [
      {
        at: node,
        groups: groups.map((g) => {
          const kids = g.idx.map((i) => node.children[i]).sort((a, b) => b.share - a.share);
          return {
            moves: kids.map((k) => ({ move: k.move, share: k.share })),
            share: kids.reduce((s, k) => s + k.share, 0),
            main: kids[0].node,
            splits: kids.flatMap((k) => findSplits(k.node, depthLeft - 1))
          };
        })
      }
    ];
  }
  // At most two levels of splits: deeper down there are too few games.
  const splits = findSplits(root, 2);

  const situations: Situation[] = [];
  const label = (n: MapNode) => n.path.map((m) => m.san).join(' ');
  const collect = (list: MapSplit[], decisions: MapMove[]) => {
    for (const sp of list) {
      for (const g of sp.groups) {
        const d = [...decisions, g.moves[0].move];
        if (g.splits.length > 0) collect(g.splits, d);
        else situations.push({ node: g.main, label: label(g.main), share: g.main.weight, decisions: d });
      }
    }
  };
  collect(splits, []);
  if (situations.length === 0) situations.push({ node: root, label: '', share: 1, decisions: [] });
  return { root, splits, situations, requests };
}

// "5.Nxc6" style label of one move in a line that starts at `startPly`
// (the number of half-moves already played before the opening's start).
export function moveLabel(move: MapMove, startPly: number): string {
  const ply = startPly + move.ply;
  const n = Math.floor(ply / 2) + 1;
  return ply % 2 === 0 ? `${n}.${move.san}` : `${n}...${move.san}`;
}

// "5.Nxc6 bxc6 6.e5 Qe7" (or "5...Nf6 6.Nc3" when the line starts with Black).
export function formatLine(moves: MapMove[], startPly: number): string {
  return moves
    .map((m, i) => {
      const ply = startPly + m.ply;
      const n = Math.floor(ply / 2) + 1;
      if (ply % 2 === 0) return `${n}.${m.san}`;
      return i === 0 ? `${n}...${m.san}` : m.san;
    })
    .join(' ');
}

// From `node`, follow the line while it is forced: your move, and an
// opponent move played in at least 70% of the games. Stops at the first
// real choice of the opponent (or after `maxPlies`).
export function forcedEnd(node: MapNode, maxPlies = 8): MapNode {
  let n = node;
  for (let i = 0; i < maxPlies && n.children.length > 0; i++) {
    const top = [...n.children].sort((a, b) => b.share - a.share)[0];
    if (!n.mine && top.share < 0.7) break;
    n = top.node;
  }
  return n;
}

// The recorded line of a "Specific line" card for one group of a split:
// the group's moves (the most played first), then your moves and every
// opponent move reached in at least 10% of all games (or the main one when
// it has at least half of the games there), up to `ownLimit` of your moves.
export function groupLine(split: MapSplit, group: MapGroup, ownLimit = 4): LineMove[] {
  const rec = (node: MapNode, own: number): LineMove[] => {
    if (node.children.length === 0) return [];
    if (node.mine) {
      if (own >= ownLimit) return [];
      const c = node.children[0];
      return [{ san: c.move.san, from: c.move.from, to: c.move.to, promotion: c.move.promotion, after: c.node.state, children: rec(c.node, own + 1) }];
    }
    const kids = [...node.children].sort((a, b) => b.share - a.share);
    let pick = kids.filter((k) => k.node.weight >= 0.1);
    if (pick.length === 0 && kids[0].share >= 0.5) pick = [kids[0]];
    return pick.map((k) => ({ san: k.move.san, from: k.move.from, to: k.move.to, promotion: k.move.promotion, after: k.node.state, children: rec(k.node, own) }));
  };
  return group.moves
    .map((gm) => split.at.children.find((c) => c.move.san === gm.move.san))
    .filter((c): c is MapNode['children'][number] => Boolean(c))
    .map((c) => ({ san: c.move.san, from: c.move.from, to: c.move.to, promotion: c.move.promotion, after: c.node.state, children: rec(c.node, 0) }));
}

// How many of your moves the main line of a recorded line holds, and
// whether it has variations.
export function lineShape(line: LineMove[], yourColor: 'w' | 'b'): { own: number; branches: boolean } {
  let own = 0;
  let branches = line.length > 1;
  let n: LineMove | undefined = line[0];
  while (n) {
    if (n.after.turn !== yourColor) own += 1;
    if (n.children.length > 1) branches = true;
    n = n.children[0];
  }
  return { own, branches };
}

// A line is forcing when its main line has at least two captures or checks
// in its first six moves (gambits, centre breaks, trades).
export function isForcing(line: LineMove[]): boolean {
  let n: LineMove | undefined = line[0];
  let hits = 0;
  for (let i = 0; n && i < 6; i++, n = n.children[0]) if (/[x+]/.test(n.san)) hits += 1;
  return hits >= 2;
}
