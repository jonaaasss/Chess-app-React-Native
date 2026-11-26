// Shields: on each of your pieces and pawns (not the king) that the opponent
// attacks and that you can take back on, a small shield shows which of your
// pieces should take back when it is taken (the board editor, Study).
// - The opponent is assumed to take with its cheapest attacker (that may
//   legally take); your recaptures are your legal captures on that square
//   afterwards.
// - One recapture: that piece. Two or more: Stockfish picks the best in the
//   board editor (only those moves, `chooseRecapture`); it is stored on the
//   board (`ReactionBoard.shields`, by position) so Study shows it without
//   the engine. You can change it (or remove the shield) in the editor;
//   such a choice is `manual` and is never replaced by Stockfish.
import { toFen } from './chess';
import { legalMovesFrom, makeMove, type GameState } from './chessEngine';
import { engineEvalsFor, type EngineEval } from './ownMove';
import type { PieceCode, ShieldMark } from './types';

const VALUE: Record<string, number> = { P: 1, N: 3, B: 3, R: 5, Q: 9, K: 100 };

export interface Tension {
  square: string;
  piece: PieceCode;
  // The opponent's capture assumed (its cheapest attacker).
  capture: { from: string; to: string };
  // Your legal recaptures after it, cheapest piece first.
  recaptures: { from: string; piece: PieceCode; san: string }[];
  // The position after the opponent's capture (your move).
  after: GameState;
}

// The key of a position for the stored shields: pieces and side to move.
export function shieldKey(st: GameState): string {
  return toFen(st.pieces, st.turn, st.castling, st.enPassant).split(' ').slice(0, 2).join(' ');
}

// Your attacked pieces and pawns that you can take back on.
export function findTensions(st: GameState, yourColor: 'w' | 'b'): Tension[] {
  const opp = yourColor === 'w' ? 'b' : 'w';
  const out: Tension[] = [];
  const oppSquares = Object.entries(st.pieces).filter(([, p]) => p && p[0] === opp).map(([sq]) => sq);
  for (const [square, piece] of Object.entries(st.pieces)) {
    if (!piece || piece[0] !== yourColor || piece[1] === 'K') continue;
    const attackers = oppSquares
      .filter((from) => {
        try {
          return legalMovesFrom(st, from).includes(square);
        } catch {
          return false;
        }
      })
      .sort((a, b) => VALUE[st.pieces[a]![1]] - VALUE[st.pieces[b]![1]]);
    if (attackers.length === 0) continue;
    const from = attackers[0];
    let after: GameState;
    try {
      // A pawn reaching the last rank takes as a queen.
      const promo = st.pieces[from]![1] === 'P' && (square[1] === '1' || square[1] === '8') ? 'Q' : undefined;
      after = makeMove({ ...st, turn: opp }, from, square, promo).next;
    } catch {
      continue;
    }
    const recaptures: Tension['recaptures'] = [];
    for (const [sq, p] of Object.entries(after.pieces)) {
      if (!p || p[0] !== yourColor) continue;
      let can = false;
      try {
        can = legalMovesFrom(after, sq).includes(square);
      } catch {
        can = false;
      }
      if (!can) continue;
      let san = `${p[1]}x${square}`;
      try {
        const promo = p[1] === 'P' && (square[1] === '1' || square[1] === '8') ? 'Q' : undefined;
        san = makeMove(after, sq, square, promo).san;
      } catch {
        // Keep the plain form.
      }
      recaptures.push({ from: sq, piece: p, san });
    }
    if (recaptures.length === 0) continue;
    recaptures.sort((a, b) => VALUE[a.piece[1]] - VALUE[b.piece[1]]);
    out.push({ square, piece, capture: { from, to: square }, recaptures, after });
  }
  return out;
}

// The shields to show on a position (Study): stored choices, else the only
// recapture. The tensions are kept for the last positions asked.
const tensionCache = new Map<string, Tension[]>();
export function shieldsOn(st: GameState, yourColor: 'w' | 'b', stored: Record<string, ShieldMark[]> | undefined): { square: string; piece: PieceCode; manual: boolean }[] {
  const key = `${yourColor}|${shieldKey(st)}`;
  let list = tensionCache.get(key);
  if (!list) {
    list = findTensions(st, yourColor);
    if (tensionCache.size > 200) tensionCache.clear();
    tensionCache.set(key, list);
  }
  const marks = stored?.[shieldKey(st)];
  return list.flatMap((t) => {
    const sh = shieldFor(t, marks);
    return sh ? [{ square: t.square, piece: sh.piece, manual: sh.manual }] : [];
  });
}

// The shield to show for a tension: a stored mark (yours or Stockfish's),
// else the only recapture. Null: no shield (removed, or not decided yet).
export function shieldFor(t: Tension, stored: ShieldMark[] | undefined): { from: string; piece: PieceCode; manual: boolean } | null {
  const mark = stored?.find((m) => m.square === t.square);
  if (mark) {
    if (mark.from === null) return null;
    const r = t.recaptures.find((x) => x.from === mark.from);
    if (r) return { from: r.from, piece: r.piece, manual: !!mark.manual };
  }
  if (t.recaptures.length === 1) return { from: t.recaptures[0].from, piece: t.recaptures[0].piece, manual: false };
  return null;
}

// Stockfish's choice among two or more recaptures (only those moves, depth 10);
// null when it could not answer.
export async function chooseRecapture(t: Tension, yourColor: 'w' | 'b', engine: EngineEval): Promise<string | null> {
  if (t.recaptures.length < 2) return t.recaptures[0]?.from ?? null;
  const evals = await engineEvalsFor(t.after, t.recaptures.map((r) => r.san), engine);
  if (!evals) return null;
  let best: { from: string; v: number } | null = null;
  for (const r of t.recaptures) {
    const v = evals.get(r.san);
    if (v === undefined) continue;
    const mine = yourColor === 'w' ? v : -v;
    if (!best || mine > best.v) best = { from: r.from, v: mine };
  }
  return best?.from ?? null;
}
