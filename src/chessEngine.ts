// A small, self-contained, rules-accurate chess engine used only by the
// "Reactions" board mode (Play/Study). This is deliberately separate from
// chess.ts's `legalMoves`, which is a simplified "how does this piece move"
// helper for the free-form board editor (no turns, no check safety) — this
// module implements full legality (check, castling, en passant, promotion)
// plus SAN notation, since Reactions cards record and replay a real PGN-like
// game tree.
import type { CastlingRights, PieceCode, PromotionPiece } from './types';
import { FILES, RANKS, pieceColor, squareFromIndex, squareIndex } from './chess';

export type PieceType = 'K' | 'Q' | 'R' | 'B' | 'N' | 'P';
export type Color = 'w' | 'b';
export type Pieces = Partial<Record<string, PieceCode>>;

export interface GameState {
  pieces: Pieces;
  turn: Color;
  castling: CastlingRights;
  enPassant: string | null; // the square a pawn can be captured en passant on
}

export interface Move {
  from: string;
  to: string;
  promotion?: PromotionPiece;
}

export interface MoveResult {
  next: GameState;
  san: string;
  move: Move;
  captured: boolean;
  isCastle: boolean;
  isEnPassant: boolean;
  isCheck: boolean;
  isCheckmate: boolean;
  isStalemate: boolean;
}

const DIAGONALS: [number, number][] = [
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1]
];
const ORTHOGONALS: [number, number][] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1]
];
const KNIGHT_DELTAS: [number, number][] = [
  [1, 2],
  [2, 1],
  [2, -1],
  [1, -2],
  [-1, -2],
  [-2, -1],
  [-2, 1],
  [-1, 2]
];

function otherColor(c: Color): Color {
  return c === 'w' ? 'b' : 'w';
}

function pieceType(code: PieceCode): PieceType {
  return code[1] as PieceType;
}

// Best-effort castling rights for a position that came from the free-form
// board editor (no real move history to consult): a side keeps the right to
// castle a given way as long as its king and that rook are still on their
// original squares. This can't know whether the king/rook have *moved and
// come back*, but it's a reasonable default for a hand-set-up position.
export function inferCastlingRights(pieces: Pieces): CastlingRights {
  return {
    wK: pieces['e1'] === 'wK' && pieces['h1'] === 'wR',
    wQ: pieces['e1'] === 'wK' && pieces['a1'] === 'wR',
    bK: pieces['e8'] === 'bK' && pieces['h8'] === 'bR',
    bQ: pieces['e8'] === 'bK' && pieces['a8'] === 'bR'
  };
}

export function createGameState(pieces: Pieces, turn: Color): GameState {
  return {
    pieces: { ...pieces },
    turn,
    castling: inferCastlingRights(pieces),
    enPassant: null
  };
}

export function findKing(pieces: Pieces, color: Color): string | null {
  for (const sq in pieces) {
    const p = pieces[sq];
    if (p && p[0] === color && p[1] === 'K') return sq;
  }
  return null;
}

// Is `square` attacked by any piece of `byColor`? Cast rays/deltas OUT from
// the square being tested rather than checking every piece's own moves —
// the standard efficient approach, and it sidesteps needing full legal-move
// generation (attacks don't care about the attacker's own king safety).
export function isSquareAttacked(pieces: Pieces, square: string, byColor: Color): boolean {
  const { file, rank } = squareIndex(square);

  // Pawns: an attacker is one step "behind" (toward its own start) diagonally.
  const pawnDir = byColor === 'w' ? 1 : -1;
  for (const df of [-1, 1]) {
    const sq = squareFromIndex(file + df, rank + pawnDir);
    const p = sq ? pieces[sq] : undefined;
    if (p && p[0] === byColor && p[1] === 'P') return true;
  }

  for (const [df, dr] of KNIGHT_DELTAS) {
    const sq = squareFromIndex(file + df, rank + dr);
    const p = sq ? pieces[sq] : undefined;
    if (p && p[0] === byColor && p[1] === 'N') return true;
  }

  for (const [df, dr] of [...ORTHOGONALS, ...DIAGONALS]) {
    const sq = squareFromIndex(file + df, rank + dr);
    const p = sq ? pieces[sq] : undefined;
    if (p && p[0] === byColor && p[1] === 'K') return true;
  }

  for (const [df, dr] of DIAGONALS) {
    let f = file + df;
    let r = rank + dr;
    while (f >= 0 && f <= 7 && r >= 0 && r <= 7) {
      const sq = squareFromIndex(f, r)!;
      const p = pieces[sq];
      if (p) {
        if (p[0] === byColor && (p[1] === 'B' || p[1] === 'Q')) return true;
        break;
      }
      f += df;
      r += dr;
    }
  }

  for (const [df, dr] of ORTHOGONALS) {
    let f = file + df;
    let r = rank + dr;
    while (f >= 0 && f <= 7 && r >= 0 && r <= 7) {
      const sq = squareFromIndex(f, r)!;
      const p = pieces[sq];
      if (p) {
        if (p[0] === byColor && (p[1] === 'R' || p[1] === 'Q')) return true;
        break;
      }
      f += df;
      r += dr;
    }
  }

  return false;
}

export function isInCheck(state: GameState, color: Color): boolean {
  const king = findKing(state.pieces, color);
  if (!king) return false;
  return isSquareAttacked(state.pieces, king, otherColor(color));
}

function slidePseudoMoves(pieces: Pieces, from: string, deltas: [number, number][]): string[] {
  const piece = pieces[from]!;
  const color = pieceColor(piece);
  const { file, rank } = squareIndex(from);
  const moves: string[] = [];
  for (const [df, dr] of deltas) {
    let f = file + df;
    let r = rank + dr;
    while (f >= 0 && f <= 7 && r >= 0 && r <= 7) {
      const sq = squareFromIndex(f, r)!;
      const occupant = pieces[sq];
      if (!occupant) {
        moves.push(sq);
      } else {
        if (pieceColor(occupant) !== color) moves.push(sq);
        break;
      }
      f += df;
      r += dr;
    }
  }
  return moves;
}

function stepPseudoMoves(pieces: Pieces, from: string, deltas: [number, number][]): string[] {
  const piece = pieces[from]!;
  const color = pieceColor(piece);
  const { file, rank } = squareIndex(from);
  const moves: string[] = [];
  for (const [df, dr] of deltas) {
    const sq = squareFromIndex(file + df, rank + dr);
    if (!sq) continue;
    const occupant = pieces[sq];
    if (!occupant || pieceColor(occupant) !== color) moves.push(sq);
  }
  return moves;
}

const CASTLE_SQUARES = {
  w: { king: 'e1', kingSide: { rook: 'h1', through: ['f1', 'g1'], king: 'g1', safe: ['e1', 'f1', 'g1'] }, queenSide: { rook: 'a1', through: ['b1', 'c1', 'd1'], king: 'c1', safe: ['e1', 'd1', 'c1'] } },
  b: { king: 'e8', kingSide: { rook: 'h8', through: ['f8', 'g8'], king: 'g8', safe: ['e8', 'f8', 'g8'] }, queenSide: { rook: 'a8', through: ['b8', 'c8', 'd8'], king: 'c8', safe: ['e8', 'd8', 'c8'] } }
} as const;

// Pseudo-legal moves: obeys how each piece moves, blocking, captures, en
// passant and castling — but does NOT yet filter out moves that leave the
// mover's own king in check (see legalMovesFrom for that).
export function pseudoMovesFrom(state: GameState, from: string): string[] {
  const piece = state.pieces[from];
  if (!piece) return [];
  const color = pieceColor(piece);
  const kind = pieceType(piece);

  if (kind === 'N') return stepPseudoMoves(state.pieces, from, KNIGHT_DELTAS);
  if (kind === 'B') return slidePseudoMoves(state.pieces, from, DIAGONALS);
  if (kind === 'R') return slidePseudoMoves(state.pieces, from, ORTHOGONALS);
  if (kind === 'Q') return slidePseudoMoves(state.pieces, from, [...ORTHOGONALS, ...DIAGONALS]);

  if (kind === 'K') {
    const moves = stepPseudoMoves(state.pieces, from, [...ORTHOGONALS, ...DIAGONALS]);
    const c = CASTLE_SQUARES[color];
    const rights = state.castling;
    const canKingSide = color === 'w' ? rights.wK : rights.bK;
    const canQueenSide = color === 'w' ? rights.wQ : rights.bQ;
    const opp = otherColor(color);
    if (
      canKingSide &&
      c.kingSide.through.every((sq) => !state.pieces[sq]) &&
      c.kingSide.safe.every((sq) => !isSquareAttacked(state.pieces, sq, opp))
    ) {
      moves.push(c.kingSide.king);
    }
    if (
      canQueenSide &&
      c.queenSide.through.every((sq) => !state.pieces[sq]) &&
      c.queenSide.safe.every((sq) => !isSquareAttacked(state.pieces, sq, opp))
    ) {
      moves.push(c.queenSide.king);
    }
    return moves;
  }

  // Pawn.
  const { file, rank } = squareIndex(from);
  const dir = color === 'w' ? -1 : 1;
  const startRank = color === 'w' ? 6 : 1;
  const moves: string[] = [];
  const oneSq = squareFromIndex(file, rank + dir);
  if (oneSq && !state.pieces[oneSq]) {
    moves.push(oneSq);
    if (rank === startRank) {
      const twoSq = squareFromIndex(file, rank + dir * 2);
      if (twoSq && !state.pieces[twoSq]) moves.push(twoSq);
    }
  }
  for (const df of [-1, 1]) {
    const captureSq = squareFromIndex(file + df, rank + dir);
    if (!captureSq) continue;
    const occupant = state.pieces[captureSq];
    if (occupant && pieceColor(occupant) !== color) moves.push(captureSq);
    else if (captureSq === state.enPassant) moves.push(captureSq);
  }
  return moves;
}

export function isPromotionMove(state: GameState, from: string, to: string): boolean {
  const piece = state.pieces[from];
  if (!piece || pieceType(piece) !== 'P') return false;
  const { rank } = squareIndex(to);
  return rank === 0 || rank === 7;
}

// Applies a move WITHOUT mutating `pieces`, returning the resulting pieces
// map plus bookkeeping needed for SAN/castling-rights/en-passant updates.
function applyToPieces(
  pieces: Pieces,
  from: string,
  to: string,
  promotion?: PromotionPiece
): { pieces: Pieces; captured: boolean; isCastle: boolean; isEnPassant: boolean; enPassantTarget: string | null } {
  const piece = pieces[from]!;
  const color = pieceColor(piece);
  const kind = pieceType(piece);
  const next: Pieces = { ...pieces };
  let captured = Boolean(next[to]);
  let isCastle = false;
  let isEnPassant = false;
  let enPassantTarget: string | null = null;

  delete next[from];

  if (kind === 'K' && Math.abs(squareIndex(from).file - squareIndex(to).file) === 2) {
    isCastle = true;
    const c = CASTLE_SQUARES[color];
    const side = to === c.kingSide.king ? c.kingSide : c.queenSide;
    next[to] = piece;
    const rookFrom = side.rook;
    const rookTo = side === c.kingSide ? squareFromIndex(squareIndex(to).file - 1, squareIndex(to).rank)! : squareFromIndex(squareIndex(to).file + 1, squareIndex(to).rank)!;
    next[rookTo] = next[rookFrom];
    delete next[rookFrom];
  } else {
    next[to] = promotion ? (`${color}${promotion}` as PieceCode) : piece;
    if (kind === 'P') {
      const fromIdx = squareIndex(from);
      const toIdx = squareIndex(to);
      if (fromIdx.file !== toIdx.file && !pieces[to]) {
        // Diagonal pawn move onto an empty square = en passant capture.
        isEnPassant = true;
        captured = true;
        const capturedSq = squareFromIndex(toIdx.file, fromIdx.rank)!;
        delete next[capturedSq];
      }
      if (Math.abs(toIdx.rank - fromIdx.rank) === 2) {
        enPassantTarget = squareFromIndex(fromIdx.file, (fromIdx.rank + toIdx.rank) / 2);
      }
    }
  }

  return { pieces: next, captured, isCastle, isEnPassant, enPassantTarget };
}

function updateCastlingRights(rights: CastlingRights, from: string, to: string): CastlingRights {
  const next = { ...rights };
  if (from === 'e1') {
    next.wK = false;
    next.wQ = false;
  }
  if (from === 'e8') {
    next.bK = false;
    next.bQ = false;
  }
  if (from === 'h1' || to === 'h1') next.wK = false;
  if (from === 'a1' || to === 'a1') next.wQ = false;
  if (from === 'h8' || to === 'h8') next.bK = false;
  if (from === 'a8' || to === 'a8') next.bQ = false;
  return next;
}

// Legal moves for the piece on `from`: pseudo-legal, minus any that would
// leave the mover's own king in check.
export function legalMovesFrom(state: GameState, from: string): string[] {
  const piece = state.pieces[from];
  if (!piece) return [];
  const color = pieceColor(piece);
  return pseudoMovesFrom(state, from).filter((to) => {
    const { pieces: after } = applyToPieces(state.pieces, from, to);
    return !isSquareAttacked(after, findKing(after, color) ?? from, otherColor(color));
  });
}

export interface LegalMove {
  from: string;
  to: string;
}

export function allLegalMoves(state: GameState, color: Color): LegalMove[] {
  const result: LegalMove[] = [];
  for (const sq in state.pieces) {
    const p = state.pieces[sq];
    if (p && pieceColor(p) === color) {
      for (const to of legalMovesFrom(state, sq)) result.push({ from: sq, to });
    }
  }
  return result;
}

function disambiguation(state: GameState, from: string, to: string): string {
  const piece = state.pieces[from]!;
  const color = pieceColor(piece);
  const kind = pieceType(piece);
  if (kind === 'P' || kind === 'K') return '';

  const others: string[] = [];
  for (const sq in state.pieces) {
    if (sq === from) continue;
    const p = state.pieces[sq];
    if (p && pieceColor(p) === color && pieceType(p) === kind && legalMovesFrom(state, sq).includes(to)) {
      others.push(sq);
    }
  }
  if (others.length === 0) return '';

  const fromIdx = squareIndex(from);
  const sameFile = others.some((sq) => squareIndex(sq).file === fromIdx.file);
  const sameRank = others.some((sq) => squareIndex(sq).rank === fromIdx.rank);
  if (!sameFile) return FILES[fromIdx.file];
  if (!sameRank) return RANKS[fromIdx.rank];
  return from;
}

// Plays a move on `state` (must already be legal — callers are expected to
// only offer squares from legalMovesFrom) and returns the resulting state
// plus SAN and check/mate bookkeeping.
export function makeMove(state: GameState, from: string, to: string, promotion?: PromotionPiece): MoveResult {
  const piece = state.pieces[from];
  if (!piece) throw new Error(`No piece on ${from}`);
  const color = pieceColor(piece);
  const kind = pieceType(piece);
  const isCastleAttempt = kind === 'K' && Math.abs(squareIndex(from).file - squareIndex(to).file) === 2;

  const disambig = disambiguation(state, from, to);
  const wasCapture = Boolean(state.pieces[to]) || (kind === 'P' && to === state.enPassant && squareIndex(from).file !== squareIndex(to).file);

  const applied = applyToPieces(state.pieces, from, to, promotion);
  const nextCastling = updateCastlingRights(state.castling, from, to);
  const nextTurn = otherColor(state.turn);
  const next: GameState = {
    pieces: applied.pieces,
    turn: nextTurn,
    castling: nextCastling,
    enPassant: applied.enPassantTarget
  };

  const isCheck = isInCheck(next, nextTurn);
  const opponentMoves = allLegalMoves(next, nextTurn);
  const isCheckmate = isCheck && opponentMoves.length === 0;
  const isStalemate = !isCheck && opponentMoves.length === 0;

  let san: string;
  if (applied.isCastle) {
    const c = CASTLE_SQUARES[color];
    san = to === c.kingSide.king ? 'O-O' : 'O-O-O';
  } else {
    const pieceLetter = kind === 'P' ? '' : kind;
    const captureMark = wasCapture ? 'x' : '';
    const fromFile = kind === 'P' && wasCapture ? FILES[squareIndex(from).file] : '';
    const promoSuffix = promotion ? `=${promotion}` : '';
    san = `${pieceLetter}${kind === 'P' ? fromFile : disambig}${captureMark}${to}${promoSuffix}`;
  }
  if (isCheckmate) san += '#';
  else if (isCheck) san += '+';

  return {
    next,
    san,
    move: { from, to, promotion },
    captured: applied.captured,
    isCastle: applied.isCastle,
    isEnPassant: applied.isEnPassant,
    isCheck,
    isCheckmate,
    isStalemate
  };
}
