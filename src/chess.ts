import type { Arrow, BoardFace, BoardState, CardMode, CastlingRights, Circle, MoveNode, OpeningStartPosition, PieceCode, ReactionBoard } from './types';

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

// Walks a recorded tree's "main line" (recording[0], then children[0] each
// step) to its final node — the position reached by playing the line as it
// was originally recorded. Returns null for an empty recording.
export function mainLineLeaf(recording: MoveNode[]): MoveNode | null {
  if (recording.length === 0) return null;
  let node = recording[0];
  while (node.children.length > 0) node = node.children[0];
  return node;
}

export function mainLineNodes(recording: MoveNode[]): MoveNode[] {
  if (recording.length === 0) return [];
  const nodes: MoveNode[] = [];
  let node: MoveNode | undefined = recording[0];
  while (node) {
    nodes.push(node);
    node = node.children[0];
  }
  return nodes;
}

export function mainLineSans(recording: MoveNode[]): string[] {
  if (recording.length === 0) return [];
  const sans: string[] = [];
  let node: MoveNode | undefined = recording[0];
  while (node) {
    sans.push(node.san);
    node = node.children[0];
  }
  return sans;
}

export function cloneMoveNode(node: MoveNode): MoveNode {
  return {
    ...node,
    piecesAfter: { ...node.piecesAfter },
    castlingAfter: { ...node.castlingAfter },
    addedArrows: node.addedArrows.map((a) => ({ ...a })),
    addedCircles: node.addedCircles.map((c) => ({ ...c })),
    removedArrows: node.removedArrows.map((a) => ({ ...a })),
    removedCircles: node.removedCircles.map((c) => ({ ...c })),
    children: node.children.map(cloneMoveNode)
  };
}

export function freshFace(): BoardFace {
  return {
    pieces: startingPosition(),
    turn: 'w',
    castling: { wK: true, wQ: true, bK: true, bQ: true },
    enPassant: null,
    arrows: [],
    circles: [],
    text: '',
    moves: []
  };
}

export function cloneBoardFace(face: BoardFace): BoardFace {
  return {
    pieces: { ...face.pieces },
    turn: face.turn,
    castling: { ...face.castling },
    enPassant: face.enPassant,
    arrows: face.arrows.map((a) => ({ ...a })),
    circles: face.circles.map((c) => ({ ...c })),
    text: face.text,
    moves: face.moves.map((m) => ({
      ...m,
      piecesAfter: { ...m.piecesAfter },
      castlingAfter: { ...m.castlingAfter },
      arrowsAfter: m.arrowsAfter.map((a) => ({ ...a })),
      circlesAfter: m.circlesAfter.map((c) => ({ ...c }))
    }))
  };
}

// A face's arrows/circles are tied to a specific position in its move
// history, not just "whatever's currently drawn" — position 0 (before any
// move) keeps them on the face itself; every move after that carries its
// own in `arrowsAfter`/`circlesAfter`, so replaying a move never disturbs
// what was drawn on an earlier position, and stepping back through history
// shows exactly what was there at each step (same idea as Reactions'
// per-node addedArrows/addedCircles, just for a plain list instead of a
// tree). `historyIndex` counts moves played, same meaning as the editor's
// own state of that name (0 = the starting position).
export function faceAnnotationsAt(face: BoardFace, historyIndex: number): { arrows: Arrow[]; circles: Circle[] } {
  if (historyIndex <= 0) return { arrows: face.arrows, circles: face.circles };
  const move = face.moves[historyIndex - 1];
  return move ? { arrows: move.arrowsAfter, circles: move.circlesAfter } : { arrows: face.arrows, circles: face.circles };
}

// The annotations on a face's current (i.e. final) position — what Study
// actually quizzes on for Others/Plan, regardless of how many moves built
// up to it.
export function faceAnnotations(face: BoardFace): { arrows: Arrow[]; circles: Circle[] } {
  return faceAnnotationsAt(face, face.moves.length);
}

// Returns `face` with its position-`historyIndex` annotations replaced —
// the write side of `faceAnnotationsAt`.
export function withFaceAnnotationsAt(face: BoardFace, historyIndex: number, arrows: Arrow[], circles: Circle[]): BoardFace {
  if (historyIndex <= 0) return { ...face, arrows, circles };
  return {
    ...face,
    moves: face.moves.map((m, i) => (i === historyIndex - 1 ? { ...m, arrowsAfter: arrows, circlesAfter: circles } : m))
  };
}

// Which face holds "the" single description for a mode that isn't Others
// (Others keeps two independent ones): Reactions shows it throughout
// Study, Plan alongside the plan — both live on the board editor's single
// Description field, just backed by a different face internally.
export function descriptionFace(mode: CardMode): 'front' | 'back' {
  return mode === 'plan' ? 'back' : 'front';
}

// The auto-generated overview text (see Card.overviewText) — every board's
// own description, numbered in board order. A board with no description of
// its own still gets a line (a bare "N)"), so the numbering never silently
// skips one and leaves you unsure which board a later entry refers to.
export function defaultOverviewText(mode: CardMode, boards: ReactionBoard[]): string {
  const face = descriptionFace(mode);
  return [...boards]
    .sort((a, b) => a.order - b.order)
    .map((board, i) => `${i + 1}) ${board[face].text.trim()}`.trim())
    .join('\n');
}

export function newReactionBoard(id: string, order: number): ReactionBoard {
  return {
    id,
    order,
    pieces: startingPosition(),
    turn: 'w',
    castling: { wK: true, wQ: true, bK: true, bQ: true },
    enPassant: null,
    arrows: [],
    circles: [],
    setupMoves: [],
    recording: [],
    front: freshFace(),
    back: freshFace()
  };
}

// Same as `newReactionBoard`, but starting from an opening's own starting
// position (see types.ts's OpeningStartPosition) instead of the plain one —
// falls back to `newReactionBoard` when the opening has none set.
export function newReactionBoardFromStart(id: string, order: number, start: OpeningStartPosition | undefined): ReactionBoard {
  if (!start) return newReactionBoard(id, order);
  const face: BoardFace = {
    pieces: { ...start.pieces },
    turn: start.turn,
    castling: { ...start.castling },
    enPassant: start.enPassant,
    arrows: [],
    circles: [],
    text: '',
    moves: []
  };
  return {
    id,
    order,
    pieces: { ...start.pieces },
    turn: start.turn,
    castling: { ...start.castling },
    enPassant: start.enPassant,
    arrows: [],
    circles: [],
    setupMoves: start.setupMoves.map((m) => ({ ...m, piecesAfter: { ...m.piecesAfter }, castlingAfter: { ...m.castlingAfter } })),
    recording: [],
    front: cloneBoardFace(face),
    back: cloneBoardFace(face)
  };
}

// Wraps a plain BoardState (legacy card data, from before boards had a
// front/back split) into a full board entry — both faces start out
// identical to that old single board, matching how "Others" behaved then.
export function boardStateToReactionBoard(bs: BoardState, id: string, order: number): ReactionBoard {
  const face: BoardFace = {
    pieces: { ...bs.pieces },
    turn: 'w',
    castling: { wK: true, wQ: true, bK: true, bQ: true },
    enPassant: null,
    arrows: bs.arrows.map((a) => ({ ...a })),
    circles: (bs.circles ?? []).map((c) => ({ ...c })),
    text: '',
    moves: []
  };
  return {
    id,
    order,
    pieces: { ...face.pieces },
    turn: face.turn,
    castling: { ...face.castling },
    enPassant: face.enPassant,
    arrows: face.arrows.map((a) => ({ ...a })),
    circles: face.circles.map((c) => ({ ...c })),
    setupMoves: [],
    recording: [],
    front: cloneBoardFace(face),
    back: cloneBoardFace(face)
  };
}

export function cloneReactionBoard(board: ReactionBoard, id: string): ReactionBoard {
  return {
    id,
    order: board.order,
    pieces: { ...board.pieces },
    turn: board.turn,
    castling: { ...board.castling },
    enPassant: board.enPassant,
    arrows: board.arrows.map((a) => ({ ...a })),
    circles: board.circles.map((c) => ({ ...c })),
    setupMoves: (board.setupMoves ?? []).map((m) => ({ ...m })),
    recording: board.recording.map(cloneMoveNode),
    front: cloneBoardFace(board.front),
    back: cloneBoardFace(board.back)
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

// FEN's board field lists rank 8 first, file a-to-h within each rank — the
// reverse of nothing in particular here since `pieces` is just square ->
// piece, but worth noting since it's the one place rank order is fixed.
// Move counters are hardcoded (0 halfmove, 1 fullmove) since nothing in
// this app tracks them and the engine only needs a legal position to
// search from, not a full game record.
export function toFen(
  pieces: Partial<Record<string, PieceCode>>,
  turn: 'w' | 'b',
  castling: CastlingRights,
  enPassant: string | null
): string {
  const rows: string[] = [];
  for (let rank = 8; rank >= 1; rank--) {
    let row = '';
    let empty = 0;
    for (const file of FILES) {
      const piece = pieces[file + rank];
      if (!piece) {
        empty += 1;
        continue;
      }
      if (empty > 0) {
        row += empty;
        empty = 0;
      }
      row += piece[0] === 'w' ? piece[1] : piece[1].toLowerCase();
    }
    if (empty > 0) row += empty;
    rows.push(row);
  }
  let castlingField = `${castling.wK ? 'K' : ''}${castling.wQ ? 'Q' : ''}${castling.bK ? 'k' : ''}${castling.bQ ? 'q' : ''}`;
  if (!castlingField) castlingField = '-';
  return `${rows.join('/')} ${turn} ${castlingField} ${enPassant ?? '-'} 0 1`;
}

// squareIndex/squareFromIndex stay in White's canonical orientation (used
// for actual game logic); this is the display-only 180° rotation applied
// wherever a board is rendered/touched from Black's side, so a-file/rank-1
// end up in the bottom-right instead of top-left.
export function flipIndex(i: number, flipped: boolean): number {
  return flipped ? 7 - i : i;
}

