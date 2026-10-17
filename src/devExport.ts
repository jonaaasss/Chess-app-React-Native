// Temporary developer aid — see storage.ts's `getDevExportEnabled` and
// Settings' "Developer" section. Dumps a repertoire's content as plain text
// so it can be copied out of the app and handed over to turn into
// exampleContent.ts, without hand-typing move lists from scratch.
import { sansForBoardMoves } from './chessEngine';
import { faceAnnotations, toFen } from './chess';
import { getCards, getOpenings, getRepertoire } from './storage';
import type { Arrow, Circle, MoveNode } from './types';

function arrowsText(arrows: Arrow[]): string {
  if (arrows.length === 0) return 'none';
  return arrows.map((a) => `${a.from}->${a.to} (${a.color})`).join(', ');
}

function circlesText(circles: Circle[]): string {
  if (circles.length === 0) return 'none';
  return circles.map((c) => `${c.square} (${c.color})`).join(', ');
}

// Plain-text mirror of the Notation component's rendering in
// ReactionBoardEditorOverlay.tsx: the main line reads left to right, and
// each variation (a node that isn't its parent's first child) gets its own
// indented "(...)" line.
function renderLine(startNode: MoveNode, moveNumberStart: number, startsWithWhite: boolean, depth: number): string {
  const mainParts: string[] = [];
  const variationLines: string[] = [];
  let moveNumber = moveNumberStart;
  let whiteToMove = startsWithWhite;
  let node: MoveNode | undefined = startNode;
  let first = true;
  while (node) {
    const current: MoveNode = node;
    const prefix = whiteToMove ? `${moveNumber}. ` : first ? `${moveNumber}... ` : '';
    mainParts.push(prefix + current.san);
    if (!whiteToMove) moveNumber += 1;
    whiteToMove = !whiteToMove;
    first = false;
    for (let v = 1; v < current.children.length; v++) {
      const indent = '  '.repeat(depth + 1);
      variationLines.push(`${indent}(${renderLine(current.children[v], moveNumber, current.turnAfter === 'w', depth + 1)})`);
    }
    node = current.children[0];
  }
  return [mainParts.join(' '), ...variationLines].join('\n');
}

function renderRecording(recording: MoveNode[]): string {
  if (recording.length === 0) return '(no recording)';
  const startsWithWhite = recording[0].turnAfter === 'b';
  const lines = [renderLine(recording[0], 1, startsWithWhite, 0)];
  for (let i = 1; i < recording.length; i++) {
    lines.push(`(${renderLine(recording[i], 1, startsWithWhite, 1)})`);
  }
  return lines.join('\n');
}

export async function buildRepertoireExportText(repertoireId: string): Promise<string> {
  const rep = await getRepertoire(repertoireId);
  if (!rep) return '(repertoire not found)';
  const openings = await getOpenings(repertoireId);
  const lines: string[] = [`Repertoire: ${rep.name} (${rep.group})`];

  for (const opening of openings) {
    lines.push('', `=== Opening: ${opening.name} ===`);
    const cards = await getCards(opening.id);
    for (const card of cards) {
      lines.push('', `--- Card: ${card.name || '(untitled)'} [${card.mode}] ---`);
      const board = card.boards[0];
      if (!board) {
        lines.push('(no board)');
        continue;
      }
      if (card.mode === 'reactions') {
        lines.push(`Front text: ${board.front.text || '(none)'}`);
        lines.push(`Setup FEN (position before Play): ${toFen(board.pieces, board.turn, board.castling, board.enPassant)}`);
        lines.push(`Recording: ${renderRecording(board.recording)}`);
      } else if (card.mode === 'others') {
        const front = faceAnnotations(board.front);
        const back = faceAnnotations(board.back);
        lines.push('Front:');
        lines.push(`  Moves: ${sansForBoardMoves(board.front.moves).join(' ') || '(start position)'}`);
        lines.push(`  Arrows: ${arrowsText(front.arrows)}`);
        lines.push(`  Circles: ${circlesText(front.circles)}`);
        lines.push(`  Text: ${board.front.text || '(none)'}`);
        lines.push('Back:');
        lines.push(`  Moves: ${sansForBoardMoves(board.back.moves).join(' ') || '(start position)'}`);
        lines.push(`  Arrows: ${arrowsText(back.arrows)}`);
        lines.push(`  Circles: ${circlesText(back.circles)}`);
        lines.push(`  Text: ${board.back.text || '(none)'}`);
      } else {
        // plan — only `back` matters, `front` is unused (descriptionFace).
        const back = faceAnnotations(board.back);
        lines.push(`Moves: ${sansForBoardMoves(board.back.moves).join(' ') || '(start position)'}`);
        lines.push(`Plan arrows: ${arrowsText(back.arrows)}`);
        lines.push(`Plan circles: ${circlesText(back.circles)}`);
        lines.push(`Text: ${board.back.text || '(none)'}`);
      }
    }
    if (cards.length === 0) lines.push('(no cards)');
  }
  if (openings.length === 0) lines.push('', '(no openings)');

  return lines.join('\n');
}
