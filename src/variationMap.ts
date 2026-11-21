// Variations (new opening → "Variations (Lichess)"): the plans of an opening,
// found from the Lichess opening explorer (no AI). A plan is where YOUR
// pieces go — knights, bishops, queen and the king's castling side (rooks and
// pawns are not counted). A new plan only starts where an opponent move sends
// at least one of your pieces to another square or on another route; the
// same plan reached by another move order is one plan.
//
// 1. Scan: from the opening's start, your move = the most played one (or the
//    one you chose, `overrides`); the opponent's moves with at least
//    `minShare` of the games there and `minWeight` of all games are followed;
//    when none qualifies the line goes on with the most played move. Every
//    line runs to `ownMoves` of your moves.
// 2. Setup of a line: where each of your pieces is after your first
//    `planMoves` moves (later moves don't count). Only a move that at least
//    `settle` of the players choose fixes a piece's square; after a move most
//    players don't agree on, the piece is "open" (its square does not count).
//    A recapture (taking on the square the opponent just moved to) doesn't
//    count; other captures do (...Nxe4 taking a pawn is a plan). Not castled
//    yet = timing, does not count; a piece that was taken does not count.
// 3. Plans: bottom up, at every position the plans of its continuations are
//    merged when no piece is fixed on two different squares (a piece fixed
//    in one plan and open in the other counts half). Plans played in fewer
//    than `minPlan` of all games join the plan most like them.
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
  share: number; // of the games in the position before it
  mine: boolean;
}

// One of your pieces, by its square at the opening's start.
export interface PlanPiece {
  id: string; // square at the opening's start
  code: string; // Jonas's code: NQ/NK, BB/BW, Q, K
}

// Where a piece is in a plan: a fixed square (`home` when it never moved),
// open (players differ; `options` = the squares seen most), or taken.
export type PieceSpot = { kind: 'square'; square: string; home: boolean } | { kind: 'castled'; side: 'O-O' | 'O-O-O' } | { kind: 'open'; options: string[] } | { kind: 'taken' };

export interface Plan {
  line: VarMove[]; // the most played line of the plan, from the opening's start
  lines: VarMove[][]; // all its lines (heaviest first)
  share: number; // share of all games
  spots: Map<string, PieceSpot>; // by piece id
  name?: string; // Lichess's name, when it is not just the start position's
  // Opponent moves where other lines of this plan leave its main line ("5.Nc3").
  alsoAfter: { moves: VarMove[]; at: number }[];
}

// One of your moves where something else is popular too: a chip to play
// that instead (the scan is then run again).
export interface VariationChoice {
  path: VarMove[];
  fen: string;
  played: string;
  alternatives: { san: string; share: number }[];
}

export interface PlanOptions {
  minShare: number;
  minWeight: number;
  ownMoves: number;
  planMoves: number; // your first moves that decide the plan
  minGames: number;
  maxRequests: number;
  settle: number; // a move fixes a piece's square when this share of the players choose it
  typical: number; // a plan's square for a piece: in at least this share of its games
  minPlan: number; // a plan must be played in this share of all games
}

export const DEFAULT_PLAN_OPTIONS: PlanOptions = {
  minShare: 0.15,
  minWeight: 0.03,
  ownMoves: 8,
  planMoves: 6,
  minGames: 30,
  maxRequests: 500,
  settle: 0.4,
  typical: 0.6,
  minPlan: 0.05
};

interface Node {
  state: GameState;
  moves: VarMove[];
  weight: number;
  own: number;
  name?: string;
  children: Node[];
}

type Spot = { sq: string; settled: boolean } | { taken: true };

interface Draft {
  leaves: Node[];
  weight: number;
}

export async function scanPlans(
  start: GameState,
  yourColor: 'w' | 'b',
  setup: { from: string; to: string }[], // the opening's setup moves from the standard start
  fetcher: (fen: string) => Promise<ExplorerResult>,
  overrides: Map<string, string>,
  opts: PlanOptions = DEFAULT_PLAN_OPTIONS,
  onProgress?: (text: string) => void,
  cancelled?: () => boolean
): Promise<{ plans: Plan[]; pieces: PlanPiece[]; choices: VariationChoice[]; requests: number }> {
  let requests = 0;
  const choices: VariationChoice[] = [];
  const root: Node = { state: start, moves: [], weight: 1, own: 0, children: [] };
  const queue: Node[] = [root];
  let rootName: string | undefined;

  while (queue.length > 0) {
    if (cancelled?.()) break;
    // Heaviest lines first, so a cut-off scan still has the main ones.
    queue.sort((a, b) => b.weight - a.weight);
    const n = queue.shift()!;
    const mine = n.state.turn === yourColor;
    if ((!mine && n.own >= opts.ownMoves) || requests >= opts.maxRequests) continue;
    requests += 1;
    onProgress?.(`Reading the explorer… ${requests} positions`);
    const st = n.state;
    const fen = toFen(st.pieces, st.turn, st.castling, st.enPassant);
    const res = await fetcher(fen);
    if (res.opening) n.name = res.opening;
    if (n === root) rootName = res.opening;
    if (res.games < opts.minGames || res.moves.length === 0) continue;
    let picks: { san: string; share: number; weight: number; opening?: string }[];
    if (mine) {
      const forced = overrides.get(fen);
      const pick = res.moves.find((m) => m.san === forced) ?? res.moves[0];
      const alternatives = res.moves.filter((m) => m !== pick && m.games / res.games >= 0.2).map((m) => ({ san: m.san, share: m.games / res.games }));
      if (alternatives.length > 0 && n.weight >= 0.15) choices.push({ path: n.moves, fen, played: pick.san, alternatives });
      picks = [{ san: pick.san, share: pick.games / res.games, weight: n.weight, opening: pick.opening }];
    } else {
      const real = res.moves.filter((m) => m.games >= opts.minGames && m.games / res.games >= opts.minShare && (n.weight * m.games) / res.games >= opts.minWeight);
      const top = res.moves[0];
      // The followed moves share all of the position's games, so the rarer
      // moves left out count with them (each plan's share stays honest).
      const followed = real.reduce((sum, m) => sum + m.games, 0);
      picks = real.length
        ? real.map((m) => ({ san: m.san, share: m.games / res.games, weight: (n.weight * m.games) / followed, opening: m.opening }))
        : top.games >= opts.minGames
          ? // No real choice: the line goes on with the main move, as often as before.
            [{ san: top.san, share: top.games / res.games, weight: n.weight, opening: top.opening }]
          : [];
    }
    for (const p of picks) {
      const mv = moveForSan(st, p.san);
      if (!mv) continue;
      const r = makeMove(st, mv.from, mv.to, mv.promotion);
      const child: Node = {
        state: r.next,
        moves: [...n.moves, { ...mv, san: r.san, after: r.next, share: p.share, mine }],
        weight: p.weight,
        own: n.own + (mine ? 1 : 0),
        name: p.opening ?? n.name,
        children: []
      };
      n.children.push(child);
      queue.push(child);
    }
  }

  // Your pieces at the start (knights, bishops, queen, king) and their codes.
  const pieces: PlanPiece[] = Object.entries(start.pieces)
    .filter(([, p]) => p && p[0] === yourColor && 'NBQK'.includes(p[1]))
    .map(([sq, p]) => ({ id: sq, code: pieceCode(p![1], sq, setup) }))
    .sort((a, b) => ORDER.indexOf(a.code.slice(0, 2)) - ORDER.indexOf(b.code.slice(0, 2)));

  const setups = new Map<Node, Map<string, Spot>>();
  const setupOf = (leaf: Node) => {
    let s = setups.get(leaf);
    if (!s) {
      s = lineSetup(leaf.moves, pieces, opts.settle, opts.planMoves);
      setups.set(leaf, s);
    }
    return s;
  };
  const typicalOf = (d: Draft) => typicalSetup(d, pieces, setupOf, opts.typical);
  const conflicts = (a: Draft, b: Draft) => countConflicts(typicalOf(a), typicalOf(b));

  // Bottom up: merge the plans of the continuations that agree.
  const plansOf = (n: Node): Draft[] => {
    if (n.children.length === 0) return n.moves.length ? [{ leaves: [n], weight: n.weight }] : [];
    return mergeDrafts(n.children.flatMap(plansOf), conflicts);
  };
  let drafts = plansOf(root).sort((a, b) => b.weight - a.weight);
  // Rare plans join the plan most like them.
  const big = drafts.filter((d) => d.weight >= opts.minPlan);
  if (big.length === 0 && drafts.length > 0) big.push(drafts[0]);
  for (const d of drafts) {
    if (big.includes(d)) continue;
    const target = big.reduce((best, b) => (conflicts(b, d) < conflicts(best, d) ? b : best), big[0]);
    target.leaves.push(...d.leaves);
    target.weight += d.weight;
  }
  // Absorbing can make two plans agree after all: merge until stable.
  for (let merged = true; merged; ) {
    merged = false;
    big.sort((a, b) => b.weight - a.weight);
    outer: for (let i = 0; i < big.length; i++)
      for (let j = i + 1; j < big.length; j++)
        if (conflicts(big[i], big[j]) < 1) {
          big[i].leaves.push(...big[j].leaves);
          big[i].weight += big[j].weight;
          big.splice(j, 1);
          merged = true;
          break outer;
        }
  }
  drafts = big.sort((a, b) => b.weight - a.weight);

  const plans: Plan[] = drafts.map((d) => {
    const leaves = [...d.leaves].sort((a, b) => b.weight - a.weight);
    const line = leaves[0].moves;
    const alsoAfter: Plan['alsoAfter'] = [];
    for (const l of leaves.slice(1)) {
      if (l.weight < d.weight * 0.15) continue;
      const at = differsAt(l.moves, line);
      if (at < 0 || l.moves[at].mine) continue;
      // Only where the plan is still being decided (within your first moves).
      if (l.moves.slice(0, at).filter((m) => m.mine).length >= opts.planMoves) continue;
      if (alsoAfter.some((a) => a.at === at && a.moves[at].san === l.moves[at].san)) continue;
      alsoAfter.push({ moves: l.moves, at });
    }
    const name = leaves[0].name && leaves[0].name !== rootName ? leaves[0].name : undefined;
    return {
      line,
      lines: leaves.map((l) => l.moves),
      share: d.weight,
      spots: describeSpots(d, pieces, setupOf, opts.typical),
      ...(name ? { name } : {}),
      alsoAfter: alsoAfter.slice(0, 3)
    };
  });
  return { plans, pieces, choices, requests };
}

const ORDER = ['NQ', 'NK', 'BW', 'BB', 'Q', 'K'];

// Where each piece is at the end of a line. A move fixes the square only
// when at least `settle` of the players chose it; otherwise the piece is
// open from then on (until a move most players agree on moves it again).
function lineSetup(moves: VarMove[], pieces: PlanPiece[], settle: number, planMoves: number): Map<string, Spot> {
  const at = new Map<string, string>(pieces.map((p) => [p.id, p.id])); // id → current square
  const spot = new Map<string, Spot>(pieces.map((p) => [p.id, { sq: p.id, settled: true }]));
  let own = 0;
  let lastTo = '';
  for (const m of moves) {
    if (m.mine) {
      own += 1;
      const late = own > planMoves;
      const recapture = m.san.includes('x') && m.to === lastTo;
      const castle = m.san.startsWith('O-O');
      for (const p of pieces) {
        if (at.get(p.id) !== m.from) continue;
        at.set(p.id, m.to);
        if (late || recapture) continue; // keeps its plan square
        spot.set(p.id, { sq: castle ? (m.san.startsWith('O-O-O') ? 'O-O-O' : 'O-O') : m.to, settled: m.share >= settle });
      }
    } else {
      lastTo = m.to;
      for (const p of pieces) if (at.get(p.id) === m.to) {
        at.set(p.id, 'x');
        // Taken after your first moves: it keeps the square it had in the plan.
        if (own < planMoves) spot.set(p.id, { taken: true });
      }
    }
  }
  return spot;
}

// The plan's square per piece: the square (or castling side) the piece has,
// fixed, in at least `typical` of the plan's games; 'open' when players
// differ; null when there is nothing to compare (mostly taken, or the king
// not castled yet).
type Typical = string | 'open' | null;
function typicalSetup(d: Draft, pieces: PlanPiece[], setupOf: (n: Node) => Map<string, Spot>, typical: number): Map<string, Typical> {
  const out = new Map<string, Typical>();
  for (const p of pieces) {
    const count = new Map<string, number>();
    let none = 0;
    for (const l of d.leaves) {
      const s = setupOf(l).get(p.id);
      if (!s || 'taken' in s || (p.code === 'K' && s.sq === p.id)) none += l.weight; // taken / not castled yet
      else if (s.settled) count.set(s.sq, (count.get(s.sq) ?? 0) + l.weight);
    }
    const best = [...count.entries()].sort((a, b) => b[1] - a[1])[0];
    out.set(p.id, best && best[1] >= typical * d.weight ? best[0] : none >= 0.5 * d.weight ? null : 'open');
  }
  return out;
}

// Pieces fixed on different squares count 1; fixed in one and open in the
// other counts half.
function countConflicts(a: Map<string, Typical>, b: Map<string, Typical>): number {
  let n = 0;
  for (const [id, x] of a) {
    const y = b.get(id);
    if (!x || !y || x === y) continue;
    n += x === 'open' || y === 'open' ? 0.5 : 1;
  }
  return n;
}

// Heaviest first; each draft joins the first one that agrees with it.
function mergeDrafts(list: Draft[], conflicts: (a: Draft, b: Draft) => number): Draft[] {
  const out: Draft[] = [];
  for (const d of [...list].sort((a, b) => b.weight - a.weight)) {
    const into = out.find((o) => conflicts(o, d) < 1);
    if (into) {
      into.leaves.push(...d.leaves);
      into.weight += d.weight;
    } else out.push({ leaves: [...d.leaves], weight: d.weight });
  }
  return out;
}

function describeSpots(d: Draft, pieces: PlanPiece[], setupOf: (n: Node) => Map<string, Spot>, typical: number): Map<string, PieceSpot> {
  const fixed = typicalSetup(d, pieces, setupOf, typical);
  const out = new Map<string, PieceSpot>();
  for (const p of pieces) {
    const sq = fixed.get(p.id);
    if (sq && sq !== 'open') {
      out.set(p.id, sq.startsWith('O-O') ? { kind: 'castled', side: sq as 'O-O' | 'O-O-O' } : { kind: 'square', square: sq, home: sq === p.id });
      continue;
    }
    let takenWeight = 0;
    const seen = new Map<string, number>();
    for (const l of d.leaves) {
      const s = setupOf(l).get(p.id);
      if (!s) continue;
      if ('taken' in s) takenWeight += l.weight;
      else if (!(p.code === 'K' && s.sq === p.id)) seen.set(s.sq, (seen.get(s.sq) ?? 0) + l.weight);
    }
    if (takenWeight >= typical * d.weight) out.set(p.id, { kind: 'taken' });
    else out.set(p.id, { kind: 'open', options: [...seen.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([sq]) => sq) });
  }
  return out;
}

// Jonas's piece codes: NQ/NK (the knight from the queen- or kingside), BB/BW
// (dark- or light-squared bishop), Q, K. `setup` traces a piece back to its
// square in the standard start.
function pieceCode(kind: string, square: string, setup: { from: string; to: string }[]): string {
  if (kind === 'B') return (square.charCodeAt(0) - 97 + Number(square[1])) % 2 === 1 ? 'BB' : 'BW';
  if (kind !== 'N') return kind;
  let sq = square;
  for (let i = setup.length - 1; i >= 0; i--) if (setup[i].to === sq) sq = setup[i].from;
  return sq[0] <= 'd' ? 'NQ' : 'NK';
}

// "BB g7", "Q e7", "K O-O", "Q stays on d8", "BB e7 or d6", "NQ taken".
export function spotText(piece: PlanPiece, spot: PieceSpot | undefined): string {
  if (!spot) return `${piece.code} ?`;
  switch (spot.kind) {
    case 'square':
      return spot.home ? `${piece.code} stays on ${spot.square}` : `${piece.code} ${spot.square}`;
    case 'castled':
      return `K ${spot.side}`;
    case 'taken':
      return `${piece.code} taken`;
    case 'open':
      return spot.options.length ? `${piece.code} ${spot.options.join(' or ')}` : piece.code === 'K' ? 'K castles later' : `${piece.code} free`;
  }
}

// Of `earlier`, the plan most like `plan` (fewest pieces on other squares).
export function closestPlan(pieces: PlanPiece[], plan: Plan, earlier: Plan[]): number {
  let best = 0;
  let fewest = Infinity;
  earlier.forEach((e, i) => {
    const n = spotDifferences(pieces, plan, e, '').length;
    if (n < fewest) {
      fewest = n;
      best = i;
    }
  });
  return best;
}

// The pieces whose fixed square differs between two plans ("BB e7 (plan 1: g7)").
export function spotDifferences(pieces: PlanPiece[], plan: Plan, base: Plan, baseLabel: string): string[] {
  const key = (s: PieceSpot | undefined) => (s?.kind === 'square' ? s.square : s?.kind === 'castled' ? s.side : null);
  const out: string[] = [];
  for (const p of pieces) {
    const a = plan.spots.get(p.id);
    const b = base.spots.get(p.id);
    const ka = key(a);
    const kb = key(b);
    const rest = (s: PieceSpot | undefined) => spotText(p, s).slice(p.code.length + 1);
    if (ka && kb && ka !== kb) out.push(`${spotText(p, a)} (${baseLabel}: ${kb})`);
    // Fixed in one, open in the other: only when the open one usually goes elsewhere.
    else if (ka && b?.kind === 'open' && b.options.length && b.options[0] !== ka) out.push(`${spotText(p, a)} (${baseLabel}: ${rest(b)})`);
    else if (kb && a?.kind === 'open' && a.options.length && a.options[0] !== kb) out.push(`${spotText(p, a)} (${baseLabel}: ${kb})`);
  }
  return out;
}

// The first move where `a` leaves `b` (its index), or -1 when it doesn't.
export function differsAt(a: VarMove[], b: VarMove[]): number {
  for (let i = 0; i < a.length; i++) {
    const m = b[i];
    if (!m || m.from !== a[i].from || m.to !== a[i].to) return i;
  }
  return -1;
}

// A plan's main line as the recorded line of a Reactions board (no branches).
export function planLine(moves: VarMove[]): LineMove[] {
  let line: LineMove[] = [];
  for (let i = moves.length - 1; i >= 0; i--) {
    const m = moves[i];
    line = [{ san: m.san, from: m.from, to: m.to, promotion: m.promotion, after: m.after, children: line }];
  }
  return line;
}
