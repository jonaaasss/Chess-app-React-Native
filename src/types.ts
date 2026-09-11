export type GroupId = 'white' | 'black';

export type Side = 'front' | 'back';

export type ArrowColor = 'green' | 'orange' | 'red' | 'blue';

export type PieceCode =
  | 'wK' | 'wQ' | 'wR' | 'wB' | 'wN' | 'wP'
  | 'bK' | 'bQ' | 'bR' | 'bB' | 'bN' | 'bP';

export type PromotionPiece = 'Q' | 'R' | 'B' | 'N';

export interface Arrow {
  from: string; // square e.g. "e4"
  to: string;
  color: ArrowColor;
}

export interface Circle {
  square: string;
  color: ArrowColor;
}

export interface CastlingRights {
  wK: boolean;
  wQ: boolean;
  bK: boolean;
  bQ: boolean;
}

export interface BoardState {
  pieces: Partial<Record<string, PieceCode>>; // square -> piece
  style: number; // 0, 1, 2
  arrows: Arrow[];
  // "Others" mode never lets you add these (its editor stays exactly as
  // before), but switching a card from Reactions to Others keeps a board's
  // circles instead of silently dropping them, so this can be non-empty.
  circles?: Circle[];
}

export interface CardFace {
  text: string;
  board: BoardState | null;
}

// One ply in a Reactions board's recorded game tree. `children[0]` (when
// present) is the move that was actually played through during the
// original Play recording — the "main line" — any further children are
// variations created by rewinding to this node and playing a different
// move. Annotations (arrows/circles) drawn or removed while recording are
// attached to the ply they happened on, so Study mode can show exactly
// what was visible at each point without a separate solution data source.
export interface MoveNode {
  id: string;
  san: string;
  from: string;
  to: string;
  promotion?: PromotionPiece;
  piecesAfter: Partial<Record<string, PieceCode>>;
  turnAfter: 'w' | 'b';
  castlingAfter: CastlingRights;
  enPassantAfter: string | null;
  addedArrows: Arrow[];
  addedCircles: Circle[];
  removedArrows: Arrow[];
  removedCircles: Circle[];
  children: MoveNode[];
}

// A single board on a card (up to 6 — see Card.boards). Both modes use
// this same shape and the same 2-column grid; the difference is the
// editor each opens and whether `recording` is used:
//  - "Others": free-form position + annotations, `recording` stays empty,
//    front and back show the same board (hence the "resets the back board
//    to match" reminder).
//  - "Reactions": one continuous rules-accurate game; `recording` holds the
//    line played after Play, and the back is derived by replaying it.
// The card's own front/back *text* fields still exist alongside these.
export interface ReactionBoard {
  id: string;
  order: number; // 0-5, for the 2-column layout
  pieces: Partial<Record<string, PieceCode>>;
  // A Reactions board is one continuous, rules-accurate game from the
  // standard starting position (White always moves first, same as a real
  // game) — setup moves before Play and recorded moves after Play use the
  // exact same turn/castling/en-passant tracking, so there's never an
  // ambiguous "whose turn is it" moment and en passant stays reliable.
  turn: 'w' | 'b';
  castling: CastlingRights;
  enPassant: string | null;
  style: number;
  arrows: Arrow[];
  circles: Circle[];
  // The recorded game tree's root-level moves — a list (not a single node)
  // so branching works the same way at the very first move as it does
  // anywhere deeper in the line: recording[0] is the move originally played
  // through, any further entries are variations starting on move 1. An
  // empty array means Play has never been used on this board yet.
  recording: MoveNode[];
}

export type CardMode = 'others' | 'reactions';

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
  name: string;
  mode: CardMode;
  front: CardFace; // front/back keep their text; .board is legacy/unused now
  back: CardFace;
  boards: ReactionBoard[];
}
