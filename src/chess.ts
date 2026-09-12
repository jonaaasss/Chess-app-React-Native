import type { BoardFace, BoardState, MoveNode, PieceCode, ReactionBoard } from './types';

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
    moves: face.moves.map((m) => ({ ...m, piecesAfter: { ...m.piecesAfter }, castlingAfter: { ...m.castlingAfter } }))
  };
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
    recording: [],
    front: freshFace(),
    back: freshFace()
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

// squareIndex/squareFromIndex stay in White's canonical orientation (used
// for actual game logic); this is the display-only 180° rotation applied
// wherever a board is rendered/touched from Black's side, so a-file/rank-1
// end up in the bottom-right instead of top-left.
export function flipIndex(i: number, flipped: boolean): number {
  return flipped ? 7 - i : i;
}

