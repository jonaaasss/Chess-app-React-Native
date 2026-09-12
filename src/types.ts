export type GroupId = 'white' | 'black';

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

// One committed move in a BoardFace's persisted (linear, non-branching)
// history — lets the editor step back through how a position was built
// even after closing and reopening it, or duplicating the board. Rewinding
// and then playing a different move truncates and replaces the tail of
// this list rather than branching, unlike Reactions' MoveNode tree.
export interface BoardMove {
  from: string;
  to: string;
  promotion?: PromotionPiece;
  piecesAfter: Partial<Record<string, PieceCode>>;
  turnAfter: 'w' | 'b';
  castlingAfter: CastlingRights;
  enPassantAfter: string | null;
}

// One side of a board — its own position, its own annotations, its own
// study text, and (for Others/Plan) the move history that built its
// position. Board style is a single global setting (Settings screen), not
// per-board, so it isn't part of this shape. Reactions boards carry a
// front/back too (for their text) even though their position is driven by
// the top-level fields and `recording` instead — `front.moves`/`back.moves`
// stay empty for them.
export interface BoardFace {
  pieces: Partial<Record<string, PieceCode>>;
  turn: 'w' | 'b';
  castling: CastlingRights;
  enPassant: string | null;
  arrows: Arrow[];
  circles: Circle[];
  text: string;
  moves: BoardMove[];
}

// A single board on a card (up to 6 — see Card.boards). The card itself
// holds no text — every board carries its own study text instead, but
// where depends on the mode (see `descriptionFace` in CardEditorOverlay,
// which also carries text over when a mode switch would otherwise strand
// it on a face the new mode never shows):
//  - "Reactions": one continuous rules-accurate game — `pieces`/`turn`/
//    `castling`/`enPassant`/`arrows`/`circles` are the pre-Play position and
//    its annotations, `recording` holds the line played after Play. There
//    is no front/back position split for Reactions — `front.text` is its
//    single "Description", shown throughout Study; `back` is otherwise
//    unused (`.moves` stays empty on both).
//  - "Others": `front`/`back` are fully independent boards (their own
//    position, annotations, AND text) — the "Apply to Back" action in the
//    editor copies the front's position/arrows/circles/moves onto the back
//    (its own text is left alone), but nothing keeps them in sync
//    automatically. `recording` stays empty; each face's `.moves` is its
//    own persisted, linear (non-branching) history of how its position was
//    built.
//  - "Plan": there's only one position/description, not a front/back split
//    — `back` is simply where they (and the plan's arrows) live; `front`
//    mirrors `back`'s position (kept in sync on every move, same as its
//    `.moves` history) but is otherwise unused and never shown. Circles on
//    `back` are decorative context. Study hides `back`'s arrows/circles and
//    you must draw the arrows yourself; a Plan board can't be saved with
//    zero arrows on `back`. `recording` stays empty.
export interface ReactionBoard {
  id: string;
  order: number; // 0-5, for the 2-column layout
  pieces: Partial<Record<string, PieceCode>>;
  turn: 'w' | 'b';
  castling: CastlingRights;
  enPassant: string | null;
  arrows: Arrow[];
  circles: Circle[];
  // The recorded game tree's root-level moves — a list (not a single node)
  // so branching works the same way at the very first move as it does
  // anywhere deeper in the line: recording[0] is the move originally played
  // through, any further entries are variations starting on move 1. An
  // empty array means Play has never been used on this board yet.
  recording: MoveNode[];
  front: BoardFace;
  back: BoardFace;
}

// 'plan': like 'others' (same board editor, same front/back split) except
// at least one arrow is required on the back before it can be saved, and
// Study hides the front's arrows/circles — you draw the back's arrows
// yourself instead of just flipping.
export type CardMode = 'others' | 'reactions' | 'plan';

export interface Repertoire {
  id: string;
  group: GroupId;
  name: string;
  order: number;
  // A seeded, non-deletable-by-normal-means demo repertoire — shown/hidden
  // as a pair (one per group) via the Home screen's Hide/Show toggle rather
  // than the usual per-row Delete, and restorable to its original content.
  isExample?: boolean;
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
  // Always has at least one board — study text lives on each board's
  // front/back now, not on the card itself.
  boards: ReactionBoard[];
}
