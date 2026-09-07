import type { BoardState, PieceCode } from './types';

export const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
export const RANKS = ['8', '7', '6', '5', '4', '3', '2', '1'];

export function allSquares(): string[] {
  const squares: string[] = [];
  for (const r of RANKS) {
    for (const f of FILES) {
      squares.push(f + r);
    }
  }
  return squares;
}

export function startingPosition(): Partial<Record<string, PieceCode>> {
  const order = ['R', 'N', 'B', 'Q', 'K', 'B', 'N', 'R'];
  const result: Partial<Record<string, PieceCode>> = {};
  FILES.forEach((f, i) => {
    result[f + '8'] = ('b' + order[i]) as PieceCode;
    result[f + '7'] = 'bP';
    result[f + '2'] = 'wP';
    result[f + '1'] = ('w' + order[i]) as PieceCode;
  });
  return result;
}

export function newBoardState(style = 0): BoardState {
  return {
    pieces: startingPosition(),
    style,
    arrows: []
  };
}

export function cloneBoardState(board: BoardState): BoardState {
  return {
    pieces: { ...board.pieces },
    style: board.style,
    arrows: board.arrows.map((a) => ({ ...a }))
  };
}

const PIECE_GLYPH: Record<string, string> = {
  K: '♔',
  Q: '♕',
  R: '♖',
  B: '♗',
  N: '♘',
  P: '♙'
};

export function pieceGlyph(code: PieceCode): string {
  return PIECE_GLYPH[code[1]];
}

export function pieceColor(code: PieceCode): 'w' | 'b' {
  return code[0] as 'w' | 'b';
}

export function squareIndex(square: string): { file: number; rank: number } {
  return { file: FILES.indexOf(square[0]), rank: RANKS.indexOf(square[1]) };
}

export function squareFromIndex(file: number, rank: number): string | null {
  if (file < 0 || file > 7 || rank < 0 || rank > 7) return null;
  return FILES[file] + RANKS[rank];
}

type Pieces = Partial<Record<string, PieceCode>>;

function slideMoves(pieces: Pieces, from: string, deltas: [number, number][]): string[] {
  const piece = pieces[from];
  if (!piece) return [];
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

function stepMoves(pieces: Pieces, from: string, deltas: [number, number][]): string[] {
  const piece = pieces[from];
  if (!piece) return [];
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

// Pseudo-legal moves for a single piece, honoring how each piece type
// actually moves and blocks/captures — but with no concept of whose turn
// it is, no check safety, no castling, no en passant, and no promotion.
// This board is a position-setup tool, not a game engine, so only the
// piece-movement rules that matter for "is this a sane square to drop the
// piece on" are implemented.
export function legalMoves(pieces: Pieces, from: string): string[] {
  const piece = pieces[from];
  if (!piece) return [];
  const kind = piece[1];

  if (kind === 'N') return stepMoves(pieces, from, KNIGHT_DELTAS);
  if (kind === 'K') return stepMoves(pieces, from, [...ORTHOGONALS, ...DIAGONALS]);
  if (kind === 'B') return slideMoves(pieces, from, DIAGONALS);
  if (kind === 'R') return slideMoves(pieces, from, ORTHOGONALS);
  if (kind === 'Q') return slideMoves(pieces, from, [...ORTHOGONALS, ...DIAGONALS]);

  if (kind === 'P') {
    const color = pieceColor(piece);
    const { file, rank } = squareIndex(from);
    const dir = color === 'w' ? -1 : 1; // RANKS[0] is rank 8, so "forward" decreases the index for white
    const startRank = color === 'w' ? 6 : 1;
    const moves: string[] = [];
    const oneSq = squareFromIndex(file, rank + dir);
    if (oneSq && !pieces[oneSq]) {
      moves.push(oneSq);
      if (rank === startRank) {
        const twoSq = squareFromIndex(file, rank + dir * 2);
        if (twoSq && !pieces[twoSq]) moves.push(twoSq);
      }
    }
    for (const df of [-1, 1]) {
      const captureSq = squareFromIndex(file + df, rank + dir);
      const occupant = captureSq ? pieces[captureSq] : undefined;
      if (captureSq && occupant && pieceColor(occupant) !== color) moves.push(captureSq);
    }
    return moves;
  }

  return [];
}
