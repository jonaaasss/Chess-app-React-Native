// Temporary developer aid — see storage.ts's `getDevExportEnabled` and
// Settings' "Developer" section. Dumps a repertoire's content as plain text
// so it can be copied out of the app and handed over to turn into
// exampleContent.ts, without hand-typing move lists from scratch.
import { sansForBoardMoves } from './chessEngine';
import { faceAnnotations, toFen } from './chess';
import { getCards, getOpenings, getRepertoire } from './storage';
import type { Arrow, Circle, MoveNode } from './types';

// Each arrow with its notes (and, for Summary arrows, the linked card's name).
function arrowsText(arrows: Arrow[], cardNames?: Map<string, string>): string {
  if (arrows.length === 0) return 'none';
  return arrows
    .map((a) => {
      const n = a.notes;
      const extra: string[] = [];
      if (n?.threat) extra.push(`threat ${n.threat}`);
      if (n?.myThreat) extra.push(`my threat ${n.myThreat}`);
      if (n?.linkCardId) extra.push(`link: ${cardNames?.get(n.linkCardId) ?? '(missing card)'}${n.linkBoardId ? ' (one board)' : ''}`);
      if (n?.reason) extra.push(`reason: ${n.reason}`);
      if (n?.next) extra.push(`next: ${n.next}`);
      for (const r of n?.responses ?? []) extra.push(`${r.kind} ${r.trigger}: ${r.text}`);
      return `${a.from}->${a.to} (${a.color})${extra.length ? ` {${extra.join(' | ')}}` : ''}`;
    })
    .join(', ');
}

function circlesText(circles: Circle[]): string {
  if (circles.length === 0) return 'none';
  return circles.map((c) => `${c.square} (${c.color})${c.threat ? ` {threat ${c.threat}}` : c.myThreat ? ` {my threat ${c.myThreat}}` : ''}`).join(', ');
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
    if (opening.summary?.trim()) lines.push('Opening summary text:', opening.summary.trim());
    const cardNames = new Map(cards.map((c) => [c.id, c.name || '(untitled)']));
    for (const card of cards) {
      lines.push('', `--- Card: ${card.name || '(untitled)'} [${card.mode}]${card.fastRevision ? ' [fast revision]' : ''} ---`);
      if (card.overviewText?.trim()) lines.push(`Overview: ${card.overviewText.trim()}`);
      const boards = [...card.boards].sort((a, b) => a.order - b.order);
      if (boards.length === 0) {
        lines.push('(no board)');
        continue;
      }
      // Every board, not just the first — a card can hold up to 6.
      boards.forEach((board, bi) => {
        if (boards.length > 1) lines.push(`[Board ${bi + 1} of ${boards.length}]`);
        if (card.mode === 'reactions') {
          lines.push(`Front text: ${board.front.text || '(none)'}`);
          lines.push(`Setup moves: ${sansForBoardMoves(board.setupMoves).join(' ') || '(none)'}`);
          lines.push(`Setup FEN (position before Play): ${toFen(board.pieces, board.turn, board.castling, board.enPassant)}`);
          lines.push(`Arrows at setup: ${arrowsText(board.arrows, cardNames)}`);
          lines.push(`Circles at setup: ${circlesText(board.circles)}`);
          lines.push(`Recording: ${renderRecording(board.recording)}`);
        } else if (card.mode === 'others') {
          const front = faceAnnotations(board.front);
          const back = faceAnnotations(board.back);
          lines.push('Front:');
          lines.push(`  Moves: ${sansForBoardMoves(board.front.moves).join(' ') || '(start position)'}`);
          lines.push(`  Arrows: ${arrowsText(front.arrows, cardNames)}`);
          lines.push(`  Circles: ${circlesText(front.circles)}`);
          lines.push(`  Text: ${board.front.text || '(none)'}`);
          lines.push('Back:');
          lines.push(`  Moves: ${sansForBoardMoves(board.back.moves).join(' ') || '(start position)'}`);
          lines.push(`  Arrows: ${arrowsText(back.arrows, cardNames)}`);
          lines.push(`  Circles: ${circlesText(back.circles)}`);
          lines.push(`  Text: ${board.back.text || '(none)'}`);
        } else {
          // plan / summary — only `back` matters, `front` is unused (descriptionFace).
          const back = faceAnnotations(board.back);
          lines.push(`Moves: ${sansForBoardMoves(board.back.moves).join(' ') || '(start position)'}`);
          lines.push(`Plan arrows: ${arrowsText(back.arrows, cardNames)}`);
          lines.push(`Plan circles: ${circlesText(back.circles)}`);
          lines.push(`Text: ${board.back.text || '(none)'}`);
        }
      });
    }
    if (cards.length === 0) lines.push('(no cards)');
  }
  if (openings.length === 0) lines.push('', '(no openings)');

  return lines.join('\n');
}
