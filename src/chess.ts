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
