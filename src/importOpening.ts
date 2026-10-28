// Turns a pasted "import text" (JSON, see FORMAT below) into a whole opening
// full of Plan cards. Nothing in here trusts the text: every move is played
// through the real chess engine (so an illegal move is an error, never a
// broken board) and every arrow/note is checked before anything is saved.
//
// FORMAT (version 1) — later a language model is meant to produce this from a
// PGN, but it can just as well be written by hand:
// {
//   "format": "chess-playbook-import", "version": 1,
//   "opening": { "summary": "optional text" },
//   "cards": [
//     { "name": "Qd8", "mode": "plan", "boards": [
//       { "moves": "e4 d5 exd5 Qxd5 Nc3 Qd8",      // SAN from the standard start position
//         "text": "description",
//         "arrows": [ { "from": "d2", "to": "d4", "color": "green",
//                       "notes": { "reason": "…", "next": "…",
//                                  "responses": [ { "trigger": "Nf6", "text": "…", "kind": "reaction" } ] } } ],
//         "circles": [ { "square": "e5", "color": "red" } ] } ] } ]
// }
// A "reactions" card instead records a game per board: "moves" is the setup
// (where the board starts) and "line" the recorded moves after it, with
// variations in brackets as in PGN — "d4 exd4 cxd4 Bb4+ Bd2 (Nc3 Nxe4) Bxd2+"
// makes Nc3 Nxe4 a branch instead of Bd2 Bxd2+. Arrows are not needed there.
import { startingPosition } from './chess';
import { allLegalMoves, createGameState, isPromotionMove, makeMove, type GameState } from './chessEngine';
import { cleanArrowNotes } from './arrowNotes';
import { addOpening, deleteOpening, saveCard, setOpeningSummary, uid } from './storage';
import type { Arrow, ArrowColor, ArrowNotes, ArrowResponse, BoardFace, BoardMove, Card, Circle, MoveNode, Opening, PromotionPiece, ReactionBoard } from './types';

const MAX_BOARDS_PER_CARD = 6;
const MAX_CARDS = 60;
const MAX_ARROWS_PER_BOARD = 40;
const SQUARE = /^[a-h][1-8]$/;
const COLORS: ArrowColor[] = ['green', 'orange', 'red', 'blue'];

class ImportError extends Error {
  readonly isImportError = true;
}
function fail(message: string): never {
  throw new ImportError(message);
}
function isImportError(e: unknown): e is ImportError {
  return typeof e === 'object' && e !== null && 'isImportError' in e;
}

// One recorded move of a Reactions line; `children[0]` is the main line.
interface LineMove {
  san: string;
  from: string;
  to: string;
  promotion?: PromotionPiece;
  after: GameState;
  children: LineMove[];
}
interface ParsedBoard {
  history: BoardMove[];
  final: GameState;
  text: string;
  arrows: Arrow[];
  circles: Circle[];
  line: LineMove[]; // Reactions boards only; empty for Plan boards
}
interface ParsedCard {
  name: string;
  mode: 'plan' | 'reactions';
  boards: ParsedBoard[];
}
export interface ParsedImport {
  summary?: string;
  cards: ParsedCard[];
}
export type ParseResult = { ok: true; value: ParsedImport; boardCount: number } | { ok: false; error: string };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
function optStr(v: unknown, where: string): string | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'string') fail(`${where} must be text.`);
  return v;
}

function stripFences(text: string): string {
  return text
    .trim()
    .replace(/^```[a-zA-Z]*\s*/, '')
    .replace(/\s*```$/, '')
    .trim();
}

// SAN comparison ignores check/mate marks, !/? and 0-0 vs O-O.
function normSan(s: string): string {
  return s.replace(/[+#!?]/g, '').replace(/0/g, 'O').replace(/e\.p\./g, '');
}

function sanTokens(moves: string): string[] {
  return moves
    .split(/\s+/)
    .map((t) => t.replace(/^\d+\.+/, ''))
    .filter((t) => t.length > 0 && !/^(\d+\.*|\*|1-0|0-1|1\/2-1\/2)$/.test(t));
}

function resolveSan(state: GameState, token: string): { from: string; to: string; promotion?: PromotionPiece } | null {
  const want = normSan(token);
  const castle = want === 'OO' || want === 'O-O' ? 'k' : want === 'OOO' || want === 'O-O-O' ? 'q' : null;
  const dest = castle ? null : (/([a-h][1-8])(?:=[QRBN])?$/.exec(want)?.[1] ?? null);
  if (!castle && !dest) return null;
  for (const m of allLegalMoves(state, state.turn)) {
    const piece = state.pieces[m.from];
    if (!piece) continue;
    if (castle) {
      if (piece[1] !== 'K') continue;
      const diff = m.to.charCodeAt(0) - m.from.charCodeAt(0);
      if (castle === 'k' ? diff !== 2 : diff !== -2) continue;
    } else if (m.to !== dest) {
      continue;
    }
    const promos: (PromotionPiece | undefined)[] = isPromotionMove(state, m.from, m.to) ? ['Q', 'R', 'B', 'N'] : [undefined];
    for (const promotion of promos) {
      const result = makeMove(state, m.from, m.to, promotion);
      const got = normSan(result.san);
      if (got === want || (castle && got === (castle === 'k' ? 'OO' : 'OOO'))) return { from: m.from, to: m.to, promotion };
    }
  }
  return null;
}

function playMoves(movesText: string, where: string): { history: BoardMove[]; final: GameState } {
  let state = createGameState(startingPosition(), 'w');
  const history: BoardMove[] = [];
  const played: string[] = [];
  for (const token of sanTokens(movesText)) {
    const found = resolveSan(state, token);
    if (!found) {
      fail(`${where}: the move "${token}" is not legal here${played.length > 0 ? ` (after ${played.join(' ')})` : ''}.`);
    }
    const result = makeMove(state, found.from, found.to, found.promotion);
    history.push({
      from: found.from,
      to: found.to,
      promotion: found.promotion,
      piecesAfter: { ...result.next.pieces },
      turnAfter: result.next.turn,
      castlingAfter: { ...result.next.castling },
      enPassantAfter: result.next.enPassant,
      arrowsAfter: [],
      circlesAfter: []
    });
    played.push(token);
    state = result.next;
  }
  return { history, final: state };
}

// Parses a Reactions line like "d4 exd4 cxd4 Bb4+ Bd2 (Nc3 Nxe4) Bxd2+" from
// `start`. A bracketed variation is an alternative to the move just before it,
// as in PGN, and variations can be nested.
function parseLine(lineText: string, start: GameState, where: string): LineMove[] {
  if (lineText.includes('{')) fail(`${where}: comments in { } are not supported in "line".`);
  const tokens = lineText.replace(/\(/g, ' ( ').replace(/\)/g, ' ) ').split(/\s+/).filter((t) => t.length > 0);
  const root: LineMove[] = [];
  interface Point {
    children: LineMove[];
    state: GameState;
  }
  let attach: Point = { children: root, state: start };
  let beforeLast: Point | null = null; // where the last move was played from
  const stack: { attach: Point; beforeLast: Point | null }[] = [];
  for (const raw of tokens) {
    if (raw === '(') {
      if (!beforeLast) fail(`${where}: a variation "(" must come right after a move.`);
      stack.push({ attach, beforeLast });
      attach = beforeLast;
      beforeLast = null;
      continue;
    }
    if (raw === ')') {
      const top = stack.pop();
      if (!top) fail(`${where}: there is a ")" without a matching "(".`);
      attach = top.attach;
      beforeLast = top.beforeLast;
      continue;
    }
    const token = raw.replace(/^\d+\.+/, '');
    if (token.length === 0 || /^(\d+\.*|\*|1-0|0-1|1\/2-1\/2)$/.test(token)) continue;
    const found = resolveSan(attach.state, token);
    if (!found) fail(`${where}: the move "${token}" in "line" is not legal here.`);
    const result = makeMove(attach.state, found.from, found.to, found.promotion);
    const node: LineMove = { san: result.san, from: found.from, to: found.to, promotion: found.promotion, after: result.next, children: [] };
    attach.children.push(node);
    beforeLast = attach;
    attach = { children: node.children, state: result.next };
  }
  if (stack.length > 0) fail(`${where}: a "(" in "line" is never closed.`);
  if (root.length === 0) fail(`${where}: a Reactions board needs a "line" with at least one move.`);
  return root;
}

function parseColor(v: unknown, where: string): ArrowColor {
  if (v === undefined) return 'green';
  if (v === 'yellow') return 'orange';
  if (typeof v === 'string' && (COLORS as string[]).includes(v)) return v as ArrowColor;
  return fail(`${where}: colour must be green, orange, red or blue.`);
}

function parseNotes(v: unknown, where: string): ArrowNotes | undefined {
  if (v === undefined || v === null) return undefined;
  if (!isRecord(v)) fail(`${where}: "notes" must be an object.`);
  const responses: ArrowResponse[] = [];
  if (v.responses !== undefined) {
    if (!Array.isArray(v.responses)) fail(`${where}: "responses" must be a list.`);
    v.responses.forEach((r: unknown, i: number) => {
      const w = `${where}, response ${i + 1}`;
      if (!isRecord(r)) return fail(`${w} must be an object.`);
      if (typeof r.text !== 'string') return fail(`${w} needs a "text".`);
      const kind = r.kind === undefined ? 'reaction' : r.kind;
      if (kind !== 'reaction' && kind !== 'exception') return fail(`${w}: "kind" must be "reaction" or "exception".`);
      responses.push({ trigger: optStr(r.trigger, `${w} trigger`) ?? '', text: r.text, kind });
    });
  }
  return cleanArrowNotes({
    reason: optStr(v.reason, `${where} reason`),
    next: optStr(v.next, `${where} next`),
    responses
  });
}

function parseArrow(v: unknown, where: string): Arrow {
  if (!isRecord(v)) return fail(`${where} must be an object.`);
  if (typeof v.from !== 'string' || !SQUARE.test(v.from) || typeof v.to !== 'string' || !SQUARE.test(v.to)) {
    return fail(`${where} needs "from" and "to" squares like "e2" and "e4".`);
  }
  if (v.from === v.to) return fail(`${where}: "from" and "to" are the same square.`);
  const notes = parseNotes(v.notes, where);
  return { from: v.from, to: v.to, color: parseColor(v.color, where), ...(notes ? { notes } : {}) };
}

function parseCircle(v: unknown, where: string): Circle {
  if (!isRecord(v)) return fail(`${where} must be an object.`);
  if (typeof v.square !== 'string' || !SQUARE.test(v.square)) return fail(`${where} needs a "square" like "e5".`);
  return { square: v.square, color: parseColor(v.color, where) };
}

function parseBoard(v: unknown, where: string, mode: 'plan' | 'reactions'): ParsedBoard {
  if (!isRecord(v)) return fail(`${where} must be an object.`);
  const movesText = v.moves === undefined ? '' : v.moves;
  if (typeof movesText !== 'string') return fail(`${where}: "moves" must be text like "e4 e5 Nf3".`);
  const { history, final } = playMoves(movesText, where);
  const arrowsRaw = v.arrows === undefined ? [] : v.arrows;
  if (!Array.isArray(arrowsRaw)) return fail(`${where}: "arrows" must be a list.`);
  if (mode === 'plan' && arrowsRaw.length === 0) return fail(`${where}: a Plan board needs at least one arrow.`);
  if (arrowsRaw.length > MAX_ARROWS_PER_BOARD) return fail(`${where}: at most ${MAX_ARROWS_PER_BOARD} arrows per board.`);
  const arrows = arrowsRaw.map((a: unknown, i: number) => parseArrow(a, `${where}, arrow ${i + 1}`));
  const circlesRaw = v.circles === undefined ? [] : v.circles;
  if (!Array.isArray(circlesRaw)) return fail(`${where}: "circles" must be a list.`);
  const circles = circlesRaw.map((c: unknown, i: number) => parseCircle(c, `${where}, circle ${i + 1}`));
  let line: LineMove[] = [];
  if (mode === 'reactions') {
    if (typeof v.line !== 'string') return fail(`${where}: a Reactions board needs a "line" like "d4 exd4 cxd4".`);
    line = parseLine(v.line, final, where);
  }
  return { history, final, text: optStr(v.text, `${where} text`) ?? '', arrows, circles, line };
}

export function parseOpeningImport(raw: string): ParseResult {
  try {
    const text = stripFences(raw);
    if (!text) fail('Paste the import text first.');
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      return fail('This is not valid import text. Paste the whole text exactly as you received it, starting with { and ending with }.');
    }
    if (!isRecord(data)) return fail('The import text must start with { and end with }.');
    if (data.format !== undefined && data.format !== 'chess-playbook-import') return fail('This text is not in the Chess Playbook import format.');
    if (data.version !== undefined && data.version !== 1) return fail('This import text is a newer version than the app understands.');
    if (!Array.isArray(data.cards) || data.cards.length === 0) return fail('The import text has no cards.');
    if (data.cards.length > MAX_CARDS) return fail(`At most ${MAX_CARDS} cards per import.`);
    let summary: string | undefined;
    if (data.opening !== undefined) {
      if (!isRecord(data.opening)) return fail('"opening" must be an object.');
      summary = optStr(data.opening.summary, '"opening.summary"')?.trim() || undefined;
    }
    let boardCount = 0;
    const cards = data.cards.map((c: unknown, ci: number): ParsedCard => {
      const where = `Card ${ci + 1}`;
      if (!isRecord(c)) return fail(`${where} must be an object.`);
      const name = typeof c.name === 'string' ? c.name.trim() : '';
      if (!name) return fail(`${where} needs a "name".`);
      if (c.mode !== undefined && c.mode !== 'plan' && c.mode !== 'reactions') {
        return fail(`${where} "${name}": "mode" must be "plan" or "reactions".`);
      }
      const mode = c.mode === 'reactions' ? 'reactions' : 'plan';
      if (!Array.isArray(c.boards) || c.boards.length === 0) return fail(`${where} "${name}" has no boards.`);
      if (c.boards.length > MAX_BOARDS_PER_CARD) return fail(`${where} "${name}" has more than ${MAX_BOARDS_PER_CARD} boards.`);
      const boards = c.boards.map((b: unknown, bi: number) => parseBoard(b, `${where} "${name}", board ${bi + 1}`, mode));
      boardCount += boards.length;
      return { name, mode, boards };
    });
    return { ok: true, value: { summary, cards }, boardCount };
  } catch (e) {
    if (isImportError(e)) return { ok: false, error: e.message };
    return { ok: false, error: 'Something went wrong while reading the import text.' };
  }
}

function cloneArrows(arrows: Arrow[]): Arrow[] {
  return JSON.parse(JSON.stringify(arrows)) as Arrow[];
}

// Plan boards keep one position and one move history on both faces (see
// types.ts): `back` carries the plan's arrows/circles/text — drawn on the
// last move's `arrowsAfter` when there is a history, on the face itself when
// the board is still the starting position — `front` just mirrors the position.
function buildBoard(order: number, pb: ParsedBoard): ReactionBoard {
  const last = pb.history.length;
  const faceFor = (isBack: boolean): BoardFace => ({
    pieces: { ...pb.final.pieces },
    turn: pb.final.turn,
    castling: { ...pb.final.castling },
    enPassant: pb.final.enPassant,
    arrows: isBack && last === 0 ? cloneArrows(pb.arrows) : [],
    circles: isBack && last === 0 ? pb.circles.map((c) => ({ ...c })) : [],
    text: isBack ? pb.text : '',
    moves: pb.history.map((m, i) => ({
      ...m,
      piecesAfter: { ...m.piecesAfter },
      castlingAfter: { ...m.castlingAfter },
      arrowsAfter: isBack && i === last - 1 ? cloneArrows(pb.arrows) : [],
      circlesAfter: isBack && i === last - 1 ? pb.circles.map((c) => ({ ...c })) : []
    }))
  });
  return {
    id: uid(),
    order,
    pieces: { ...pb.final.pieces },
    turn: pb.final.turn,
    castling: { ...pb.final.castling },
    enPassant: pb.final.enPassant,
    arrows: [],
    circles: [],
    setupMoves: [],
    recording: [],
    front: faceFor(false),
    back: faceFor(true)
  };
}

function buildMoveNode(m: LineMove): MoveNode {
  return {
    id: uid(),
    san: m.san,
    from: m.from,
    to: m.to,
    promotion: m.promotion,
    piecesAfter: { ...m.after.pieces },
    turnAfter: m.after.turn,
    castlingAfter: { ...m.after.castling },
    enPassantAfter: m.after.enPassant,
    addedArrows: [],
    addedCircles: [],
    removedArrows: [],
    removedCircles: [],
    children: m.children.map(buildMoveNode)
  };
}

// Reactions boards start at the setup position (its moves kept as
// `setupMoves`, like a board set up in the editor) with the line as the
// recorded game tree; the description lives on `front` (see descriptionFace).
function buildReactionsBoard(order: number, pb: ParsedBoard): ReactionBoard {
  const faceFor = (isFront: boolean): BoardFace => ({
    pieces: { ...pb.final.pieces },
    turn: pb.final.turn,
    castling: { ...pb.final.castling },
    enPassant: pb.final.enPassant,
    arrows: [],
    circles: [],
    text: isFront ? pb.text : '',
    moves: []
  });
  return {
    id: uid(),
    order,
    pieces: { ...pb.final.pieces },
    turn: pb.final.turn,
    castling: { ...pb.final.castling },
    enPassant: pb.final.enPassant,
    arrows: cloneArrows(pb.arrows),
    circles: pb.circles.map((c) => ({ ...c })),
    setupMoves: pb.history.map((m) => ({ ...m, piecesAfter: { ...m.piecesAfter }, castlingAfter: { ...m.castlingAfter } })),
    recording: pb.line.map(buildMoveNode),
    front: faceFor(true),
    back: faceFor(false)
  };
}

function buildCard(openingId: string, order: number, pc: ParsedCard): Card {
  return {
    id: uid(),
    openingId,
    order,
    name: pc.name,
    mode: pc.mode,
    boards: pc.boards.map((b, i) => (pc.mode === 'reactions' ? buildReactionsBoard(i, b) : buildBoard(i, b)))
  };
}

// Creates the opening and all its cards. If anything fails halfway the
// half-made opening is removed again, so an import is all-or-nothing.
export async function importOpening(repertoireId: string, name: string, spec: ParsedImport): Promise<Opening> {
  const opening = await addOpening(repertoireId, name);
  try {
    if (spec.summary) await setOpeningSummary(opening.id, spec.summary);
    for (let i = 0; i < spec.cards.length; i++) {
      await saveCard(buildCard(opening.id, i, spec.cards[i]));
    }
  } catch (e) {
    await deleteOpening(opening.id);
    throw e;
  }
  return opening;
}
