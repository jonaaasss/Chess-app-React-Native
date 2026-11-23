// How often a board's position comes up: the share of the games from the
// opening's start position that reach it, counting only the opponent's
// choices (your own moves are taken as played every time). Read from the
// Lichess explorer (the database chosen in the Explorer panel); almost all
// answers come from the cache on the phone. Shown under each board in the
// card editor and in Study (`BoardShare`).
import { startingPosition, toFen } from './chess';
import { faceBaseState, makeMove, type GameState } from './chessEngine';
import { fetchExplorer, getExplorerDb, moveForSan } from './lichessExplorer';
import type { CardMode, OpeningStartPosition, PromotionPiece, ReactionBoard } from './types';

type PlainMove = { from: string; to: string; promotion?: PromotionPiece };

// The moves from the standard start to the board's position: for Plan and
// Summary the position on `back`, for Reactions where its line starts.
export function boardMovesFromStart(board: ReactionBoard, mode: CardMode): PlainMove[] {
  if (mode === 'reactions') return board.setupMoves;
  const face = board.back;
  const base = faceBaseState(board, face);
  return base.ply === 0 ? face.moves : [...board.setupMoves, ...face.moves];
}

const memo = new Map<string, number | null>();

// Null when it can't be worked out (the board does not start from the
// opening's start position, no Lichess token, no connection).
export async function boardShare(board: ReactionBoard, mode: CardMode, opening: OpeningStartPosition | undefined, yourColor: 'w' | 'b'): Promise<number | null> {
  const moves = boardMovesFromStart(board, mode);
  const prefix = opening?.setupMoves ?? [];
  if (moves.length < prefix.length) return null;
  for (let i = 0; i < prefix.length; i++) if (moves[i].from !== prefix[i].from || moves[i].to !== prefix[i].to) return null;
  const db = await getExplorerDb();
  const key = `${db}|${yourColor}|${moves.map((m) => `${m.from}${m.to}${m.promotion ?? ''}`).join(',')}`;
  if (memo.has(key)) return memo.get(key)!;
  let st: GameState = opening
    ? { pieces: opening.pieces, turn: opening.turn, castling: opening.castling, enPassant: opening.enPassant }
    : { pieces: startingPosition(), turn: 'w', castling: { wK: true, wQ: true, bK: true, bQ: true }, enPassant: null };
  let share = 1;
  try {
    for (const m of moves.slice(prefix.length)) {
      if (st.turn !== yourColor) {
        const res = await fetchExplorer(toFen(st.pieces, st.turn, st.castling, st.enPassant), db);
        const hit = res.games > 0 ? res.moves.find((x) => {
          const mv = moveForSan(st, x.san);
          return !!mv && mv.from === m.from && mv.to === m.to;
        }) : undefined;
        share *= hit ? hit.games / res.games : 0;
        if (share === 0) break;
      }
      st = makeMove(st, m.from, m.to, m.promotion).next;
    }
  } catch {
    return null;
  }
  memo.set(key, share);
  return share;
}

// "29%", or "<1%" for a rare position.
export function shareText(share: number): string {
  return share >= 0.005 ? `${Math.round(share * 100)}%` : '<1%';
}
