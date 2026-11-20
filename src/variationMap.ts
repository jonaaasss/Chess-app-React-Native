// Variations (new opening → "Variations (Lichess)"): the main variations of
// an opening, found from the Lichess opening explorer (no AI), each as one
// complete line from the opening's start, so you always see how its
// position is reached.
//
// - Your move: the most played one (or the one you chose, `overrides`).
// - The opponent's move: every move with at least `minShare` of the games
//   in that position that is also reached in at least `minWeight` of all
//   games from the start; each one starts its own variation. When no move
//   qualifies, the line simply goes on with the most played move, so every
//   variation runs to `ownMoves` of your moves (or until the games run out).
// - Board 1 is the main line (the most played move at every choice). Then,
//   one by one, the line that leaves the lines chosen so far with the most
//   played move (compared with the line it shares the most moves with).
import { toFen } from './chess';
import { makeMove, type GameState } from './chessEngine';
import { moveForSan, type ExplorerResult } from './lichessExplorer';
import type { LineMove } from './importOpening';
import type { PromotionPiece } from './types';

export interface VarMove {
  from: string;
  to: string;
  promotion?: PromotionPiece;
  san: string;
  after: GameState;
}

export interface Variation {
  moves: VarMove[]; // from the opening's start
  share: number; // share of all games that reach its last real choice
  weights: number[]; // share of all games after each move
  main: boolean;
  // Not for the main line: the earlier variation it shares the most moves
  // with, the index of its first own move, and how often that move is played
  // (share of all games).
  parent?: number;
  differs?: number;
  branchShare?: number;
  // Another move order of an earlier variation: from move index `from` on
  // both lines have the same position after every move, to the end.
  transposes?: { line: number; from: number };
  // Lichess's name of the opening, the deepest one on the line (left out
  // when it is only the name of the start position).
  name?: string;
}

// One of your moves where something else is popular too: a chip to play
// that instead (the scan is then run again).
export interface VariationChoice {
  path: VarMove[];
  fen: string;
  played: string;
  alternatives: { san: string; share: number }[];
}

export interface VariationOptions {
  minShare: number;
  minWeight: number;
  ownMoves: number;
  minGames: number;
  maxRequests: number;
  maxLines: number;
}

export const DEFAULT_VARIATION_OPTIONS: VariationOptions = { minShare: 0.15, minWeight: 0.05, ownMoves: 8, minGames: 30, maxRequests: 400, maxLines: 12 };

interface Node {
  state: GameState;
  moves: VarMove[];
  weights: number[]; // share of all games after each move
  weight: number;
  share: number; // weight at the last real choice
  own: number; // your moves played
  name?: string;
}

export async function scanVariations(
  start: GameState,
  yourColor: 'w' | 'b',
  fetcher: (fen: string) => Promise<ExplorerResult>,
  overrides: Map<string, string>,
  opts: VariationOptions = DEFAULT_VARIATION_OPTIONS,
  onProgress?: (text: string) => void,
  cancelled?: () => boolean
): Promise<{ variations: Variation[]; choices: VariationChoice[]; requests: number }> {
  let requests = 0;
  const leaves: Node[] = [];
  const choices: VariationChoice[] = [];
  const queue: Node[] = [{ state: start, moves: [], weights: [], weight: 1, share: 1, own: 0 }];
  let rootName: string | undefined;

  while (queue.length > 0) {
    if (cancelled?.()) break;
    // Heaviest lines first, so a cut-off scan still has the main ones.
    queue.sort((a, b) => b.weight - a.weight);
    const n = queue.shift()!;
    const mine = n.state.turn === yourColor;
    if ((!mine && n.own >= opts.ownMoves) || requests >= opts.maxRequests) {
      leaves.push(n);
      continue;
    }
    requests += 1;
    onProgress?.(`Reading the explorer… ${requests} positions`);
    const st = n.state;
    const fen = toFen(st.pieces, st.turn, st.castling, st.enPassant);
    const res = await fetcher(fen);
    if (res.opening) n.name = res.opening;
    if (n.moves.length === 0) rootName = res.opening;
    if (res.games < opts.minGames || res.moves.length === 0) {
      leaves.push(n);
      continue;
    }
    let picks: { san: string; share: number; real: boolean; opening?: string }[];
    if (mine) {
      const forced = overrides.get(fen);
      const pick = res.moves.find((m) => m.san === forced) ?? res.moves[0];
      const alternatives = res.moves.filter((m) => m !== pick && m.games / res.games >= 0.2).map((m) => ({ san: m.san, share: m.games / res.games }));
      if (alternatives.length > 0 && n.weight >= 0.15) choices.push({ path: n.moves, fen, played: pick.san, alternatives });
      picks = [{ san: pick.san, share: 1, real: false, opening: pick.opening }];
    } else {
      const real = res.moves.filter((m) => m.games >= opts.minGames && m.games / res.games >= opts.minShare && (n.weight * m.games) / res.games >= opts.minWeight);
      const top = res.moves[0];
      picks = real.length
        ? real.map((m) => ({ san: m.san, share: m.games / res.games, real: true, opening: m.opening }))
        : top.games >= opts.minGames
          ? [{ san: top.san, share: top.games / res.games, real: false, opening: top.opening }]
          : [];
    }
    let pushed = 0;
    for (const p of picks) {
      const mv = moveForSan(st, p.san);
      if (!mv) continue;
      const r = makeMove(st, mv.from, mv.to, mv.promotion);
      const weight = mine ? n.weight : n.weight * p.share;
      queue.push({
        state: r.next,
        moves: [...n.moves, { ...mv, san: r.san, after: r.next }],
        weights: [...n.weights, weight],
        weight,
        share: p.real ? weight : n.share,
        own: n.own + (mine ? 1 : 0),
        name: p.opening ?? n.name
      });
      pushed += 1;
    }
    if (pushed === 0) leaves.push(n);
  }

  const lines = leaves.filter((l) => l.moves.length > 0);
  // The main line: at every choice the most played move.
  let pool = lines;
  for (let i = 0; pool.length > 1; i++) {
    const withMove = pool.filter((l) => l.moves[i]);
    if (withMove.length === 0) break;
    const best = withMove.reduce((a, b) => (b.weights[i] > a.weights[i] ? b : a));
    pool = withMove.filter((l) => l.moves[i].from === best.moves[i].from && l.moves[i].to === best.moves[i].to);
  }
  const main = pool[0];
  const chosen: Node[] = main ? [main] : [];
  const info = new Map<Node, { parent: number; differs: number; branchShare: number }>();
  const rest = lines.filter((l) => l !== main);
  while (rest.length > 0 && chosen.length < opts.maxLines) {
    let best: { l: Node; parent: number; differs: number; branchShare: number } | null = null;
    for (const l of rest) {
      const c = closest(l, chosen);
      const branchShare = l.weights[c.differs] ?? 0;
      if (!best || branchShare > best.branchShare || (branchShare === best.branchShare && l.share > best.l.share)) best = { l, ...c, branchShare };
    }
    chosen.push(best!.l);
    info.set(best!.l, { parent: best!.parent, differs: best!.differs, branchShare: best!.branchShare });
    rest.splice(rest.indexOf(best!.l), 1);
  }
  const key = (st: GameState) => toFen(st.pieces, st.turn, st.castling, st.enPassant);
  const keys = chosen.map((l) => l.moves.map((m) => key(m.after)));
  const variations: Variation[] = chosen.map((l, i) => {
    let transposes: { line: number; from: number } | undefined;
    for (let j = 0; j < i && !transposes; j++) {
      const a = keys[i];
      const b = keys[j];
      if (a.length !== b.length || a[a.length - 1] !== b[b.length - 1]) continue;
      let from = a.length - 1;
      while (from > 0 && a[from - 1] === b[from - 1]) from -= 1;
      transposes = { line: j, from };
    }
    return {
      moves: l.moves,
      weights: l.weights,
      share: l.share,
      main: l === main,
      ...(info.get(l) ?? {}),
      ...(transposes ? { transposes } : {}),
      ...(l.name && l.name !== rootName ? { name: l.name } : {})
    };
  });
  return { variations, choices, requests };
}

// Of `list`, the line that shares the most moves with `v` (its index), and
// the index of the first move where `v` leaves it.
export function closest(v: Pick<Variation, 'moves'>, list: Pick<Variation, 'moves'>[]): { parent: number; differs: number } {
  let parent = 0;
  let differs = -1;
  list.forEach((c, i) => {
    const d = differsAt(v, c);
    const at = d < 0 ? v.moves.length : d;
    if (at > differs) {
      differs = at;
      parent = i;
    }
  });
  return { parent, differs };
}

// The first move where `v` leaves `base` (its index), or -1 when it doesn't.
export function differsAt(v: Pick<Variation, 'moves'>, base: Pick<Variation, 'moves'>): number {
  for (let i = 0; i < v.moves.length; i++) {
    const b = base.moves[i];
    if (!b || b.from !== v.moves[i].from || b.to !== v.moves[i].to) return i;
  }
  return -1;
}

// The variation as the recorded line of a Reactions board (no branches).
export function variationLine(v: Variation): LineMove[] {
  let line: LineMove[] = [];
  for (let i = v.moves.length - 1; i >= 0; i--) {
    const m = v.moves[i];
    line = [{ san: m.san, from: m.from, to: m.to, promotion: m.promotion, after: m.after, children: line }];
  }
  return line;
}
