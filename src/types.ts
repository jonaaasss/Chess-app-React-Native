export type GroupId = 'white' | 'black';

export type Side = 'front' | 'back';

export type ArrowColor = 'green' | 'orange' | 'red' | 'blue';

export type PieceCode =
  | 'wK' | 'wQ' | 'wR' | 'wB' | 'wN' | 'wP'
  | 'bK' | 'bQ' | 'bR' | 'bB' | 'bN' | 'bP';

export interface Arrow {
  from: string; // square e.g. "e4"
  to: string;
  color: ArrowColor;
}

export interface BoardState {
  pieces: Partial<Record<string, PieceCode>>; // square -> piece
  style: number; // 0, 1, 2
  arrows: Arrow[];
}

export interface CardFace {
  text: string;
  board: BoardState | null;
}

export interface Repertoire {
  id: string;
  group: GroupId;
  name: string;
  order: number;
}

export interface Opening {
  id: string;
  repertoireId: string;
  name: string;
  order: number;
}

export interface Card {
  id: string;
  openingId: string;
  order: number;
  front: CardFace;
  back: CardFace;
}
