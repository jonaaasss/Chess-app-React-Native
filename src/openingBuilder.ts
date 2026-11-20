// Turns an Opening map scan into cards in the style of Jonas's Italian:
// - Summary (at the first split): your general plan in light colours; per
//   opponent choice at the split its move and your answer in one dark tint,
//   linked to its card; single-move reactions as threats (!A, !B …).
// - Specific line (Reactions) for a forcing choice (captures and checks).
// - Reaction: !X (Plan) for a quiet choice that changes three or more of
//   your moves; smaller differences stay as the dark pair on the Summary.
// - Reactions: first move (Plan, one board per reaction, at most 6): red
//   circle on the opponent's piece, green arrow with your answer.
// - The opening summary tables (Start, Reply, Piece).
// Plain data only (no storage), so it can be tested on its own; the Opening
// map screen turns it into cards.
import type { GameState } from './chessEngine';
import type { ExplorerResult } from './lichessExplorer';
import type { LineMove } from './importOpening';
import { groupLine, isForcing, moveLabel, type MapGroup, type MapMove, type MapNode, type MapResult, type MapSplit } from './openingMap';
import { DEFAULT_PLAN_OPTIONS, generatePlan, planDescription, type Move, type PlanReaction } from './planGenerator';
import type { Arrow, ArrowColor, Circle } from './types';

const COLORS: ArrowColor[] = ['green', 'orange', 'red', 'blue'];
const DARK: Record<string, ArrowColor> = { green: 'darkGreen', orange: 'darkOrange', red: 'darkRed', blue: 'darkBlue' };
const LETTERS = 'ABCDEFGHIJ';
const MAX_REACTIONS = 6;

export type BoardSpec =
  | { id: string; kind: 'plan'; path: Move[]; final: GameState; text: string; arrows: Arrow[]; circles: Circle[] }
  | { id: string; kind: 'reactions'; path: Move[]; start: GameState; text: string; line: LineMove[] };

export type CardKind = 'summary' | 'line' | 'firstMove' | 'reaction';

export interface CardSpec {
  id: string;
  kind: CardKind;
  name: string;
  info: string; // one line for the list on screen
  boards: BoardSpec[];
}

export interface BuiltOpening {
  cards: CardSpec[]; // in their order: Summary, Specific lines, Reactions: first move, Reaction: !X
  openingSummary: string; // the opening's summary tables
}

interface Reaction extends PlanReaction {
  fullPath: Move[]; // from the opening's start up to and including the trigger
}

const keyOf = (m: { from: string; to: string }) => `${m.from}${m.to}`;
const KIND_ORDER: Record<CardKind, number> = { summary: 0, line: 1, firstMove: 2, reaction: 3 };

export async function buildOpening(args: {
  result: MapResult;
  yourColor: 'w' | 'b';
  setup: Move[]; // the opening's setup moves from the standard start (with SAN)
  fetcher: (fen: string) => Promise<ExplorerResult>;
  source: string; // e.g. "Lichess explorer (Lichess 2200–2500)"
  newId: () => string;
  onProgress?: (text: string) => void;
  cancelled?: () => boolean;
}): Promise<BuiltOpening> {
  const { result, yourColor, setup, fetcher, source, newId, onProgress, cancelled } = args;
  const startPly = setup.length;
  // The Summary is at the opening's start, so every branch is on it; the
  // groups are those of the first split in each branch (e.g. after 4.c3 Nf6
  // and after 4.d3 Nf6 when 4.c3, 4.d3 and 4.O-O all get ...Nf6).
  const at: MapNode = result.root;
  const groups: { split: MapSplit; g: MapGroup }[] = result.splits.flatMap((split) => split.groups.map((g) => ({ split, g })));
  const label = (m: MapMove) => moveLabel(m, startPly);

  onProgress?.('Summary: reading the explorer…');
  const rootPlan = await generatePlan(at.state, yourColor, fetcher, { ...DEFAULT_PLAN_OPTIONS, depth: 5 }, (t) => onProgress?.(`Summary: ${t}`), undefined, cancelled);

  // A forcing try gets its own recorded line (a Specific line card).
  const lines = groups.map(({ split, g }) => groupLine(split, g));
  const forcing = lines.map(isForcing);
  const forcingOpp = new Set<string>();
  const collectOpp = (list: LineMove[]) =>
    list.forEach((n) => {
      if (n.after.turn === yourColor) forcingOpp.add(keyOf(n));
      collectOpp(n.children);
    });
  lines.forEach((l, i) => forcing[i] && collectOpp(l));
  const forcingGroupMoves = groups.flatMap(({ g }, i) => (forcing[i] ? g.moves.map((m) => m.move) : []));
  const groupMoves = groups.flatMap(({ g }) => g.moves.map((m) => m.move));

  const cards: CardSpec[] = [];
  const groupReactions: string[] = [];
  const replyRows: string[] = [];
  const reactions: Reaction[] = rootPlan.reactions.map((r) => ({ ...r, fullPath: [...at.path, ...r.path] }));
  const onCards = new Set<string>(); // "trigger>answer" pairs drawn on a group's own card
  const draws: { moves: Move[]; reply?: Move; extra: Move[]; link?: string; family: number }[] = [];
  // Per group with its own card: your moves on it ("from+to").
  const groupOwn: Set<string>[] = [];
  // Your moves already played on the way to a node.
  const playedBefore = (n: MapNode) => n.path.filter((m) => (m.ply % 2 === 0) === (at.state.turn === yourColor)).map(keyOf);
  const usedNames = new Set<string>();
  const uniqueName = (base: string, split: MapSplit) => {
    const name = usedNames.has(base) && split.at.path.length ? `${base} (after ${label(split.at.path[split.at.path.length - 1])})` : base;
    usedNames.add(name);
    return name;
  };

  // The first opponent decision when it is no split (all its moves get the
  // same plan): one merged Reply row, "4. !c3 / !d3 / !O-O | Nf6 d6".
  let first: MapNode = result.root;
  while (first.mine && first.children.length > 0) first = first.children[0].node;
  const merged = !first.mine && first.children.length > 0 && !result.splits.some((sp) => sp.at === first) ? first.children.map((c) => c.move) : [];

  for (const [i, { split, g }] of groups.entries()) {
    if (cancelled?.()) break;
    const opp = g.moves[0].move;
    const reply = g.main.mine ? g.main.children[0]?.move : undefined;
    const names = g.moves.map((m) => `!${m.move.san}`).join(' / ');
    const pct = `${Math.round(g.main.weight * 100)}% of all games`;
    let link: string | undefined;
    let extra: Move[] = [];
    let rowMoves = reply?.san ?? '';
    let rowExcept: string[] = [];

    const line = lines[i];
    if (forcing[i]) {
      // A forcing try: its own recorded line with the variations.
      const { own, variations } = describeLine(line, yourColor);
      link = newId();
      cards.push({
        id: link,
        kind: 'line',
        name: uniqueName(`Specific line: ${label(opp)}`, split),
        info: `Forcing line (captures and checks), ${pct}`,
        boards: [
          {
            id: newId(),
            kind: 'reactions',
            path: split.at.path,
            start: split.at.state,
            text: [own.length ? `Key moves: ${own.join(' ')}` : '', variations.length ? `Key reactions: ${variations.join(', ')}` : '', `Source: ${source}`].filter(Boolean).join('\n'),
            line
          }
        ]
      });
      rowMoves = own.slice(0, 6).join(' ');
      rowExcept = variations.map(toExcept);
      groupOwn.push(new Set([...playedBefore(split.at), ...ownKeysIn(line, yourColor)]));
    } else {
      onProgress?.(`Plan after ${label(opp)}: reading the explorer…`);
      const gPlan = await generatePlan(g.main.state, yourColor, fetcher, { ...DEFAULT_PLAN_OPTIONS, depth: 4 }, (t) => onProgress?.(`Plan after ${label(opp)}: ${t}`), undefined, cancelled);
      const weight = g.main.weight;
      gPlan.reactions.forEach((r) => reactions.push({ ...r, share: r.share * weight, fullPath: [...g.main.path, ...r.path] }));
      const diff = gPlan.ownKeys.filter((k) => !rootPlan.ownKeys.includes(k) && k !== (reply ? keyOf(reply) : ''));
      if (!gPlan.problem && diff.length >= 3) {
        // A quiet try that changes your plan: its own Plan card.
        link = newId();
        cards.push({
          id: link,
          kind: 'reaction',
          name: uniqueName(`Reaction: ${names}`, split),
          info: `${diff.length} of your moves differ from the main plan, ${pct}`,
          boards: [{ id: newId(), kind: 'plan', path: g.main.path, final: g.main.state, text: planDescription(gPlan, source), arrows: gPlan.arrows, circles: [] }]
        });
        gPlan.pairs.forEach((p) => p.answers.forEach((a) => onCards.add(`${keyOf(p.trigger)}>${keyOf(a)}`)));
        groupOwn.push(new Set([...playedBefore(g.main), ...gPlan.ownKeys, ...(reply ? [keyOf(reply)] : [])]));
        rowMoves = gPlan.keyMoves.join(' ');
        rowExcept = gPlan.keyReactions.map(toExcept);
      } else {
        // A small difference: only the dark pair on the Summary.
        extra = diff.slice(0, 2).map((k) => ({ from: k.slice(0, 2), to: k.slice(2, 4), san: gPlan.ownSan[k] ?? k }));
        rowMoves = [reply?.san, ...extra.map((m) => m.san)].filter(Boolean).join(' ');
        rowExcept = g.splits.flatMap((sp) => sp.groups.slice(1).map((sg) => `?${sg.main.children[0]?.move.san ?? '…'} after !${sg.moves[0].move.san}`));
      }
    }
    draws.push({ moves: g.moves.map((m) => m.move), reply, extra, link, family: i });
    groupReactions.push(`${names} => ${rowMoves || '…'}`);
    replyRows.push(`${moveNumber(startPly + opp.ply)} ${names} | ${rowMoves} | ${rowExcept.join('\\n')}`);
  }

  // The root plan's pairs stay, in their colour family, unless the opponent
  // move is a move of a split or of the first decision (its group has the
  // pair), inside a forcing line (its Specific line has it), or the pair is
  // on a group's own card.
  const skip = new Set([...groupMoves, ...merged].map(keyOf));
  const rootPairs = rootPlan.pairs.filter(
    (p) => !skip.has(keyOf(p.trigger)) && !forcingOpp.has(keyOf(p.trigger)) && !p.answers.some((a) => onCards.has(`${keyOf(p.trigger)}>${keyOf(a)}`))
  );
  // Light moves keep their exceptions, except for an opponent move that has
  // its own row (a move of a split or of the first decision).
  const skipSans = new Set([...groupMoves, ...merged].map((m) => `!${m.san}`));
  // Your plan in light colours: the root plan's light moves that you also
  // play in every branch with its own card (Nxe4 in the Berlin is no
  // general move when 4.d3 gets its own plan; it becomes 4.O-O's answer).
  const general = rootPlan.arrows.filter((a) => !a.color.startsWith('dark') && groupOwn.every((own) => own.has(keyOf(a))));
  const generalKeys = new Set(general.map(keyOf));
  const keyMoves = general.map((a) => rootPlan.ownSan[keyOf(a)] ?? keyOf(a));
  if (merged.length > 0) replyRows.unshift(`${moveNumber(startPly + first.path.length)} ${merged.map((m) => `!${m.san}`).join(' / ')} | ${keyMoves.join(' ')} | `);
  const summaryArrows: Arrow[] = general.map((a) => {
      const responses = a.notes?.responses?.filter((r) => !skipSans.has(r.trigger));
      if (!a.notes?.responses || responses?.length === a.notes.responses.length) return a;
      const { responses: _r, ...rest } = a.notes;
      const notes = responses?.length ? { ...rest, responses } : rest;
      return Object.keys(notes).length ? { ...a, notes } : { from: a.from, to: a.to, color: a.color };
    });
  for (const p of rootPairs) [p.trigger, ...p.answers].forEach((m) => summaryArrows.push({ from: m.from, to: m.to, color: p.color }));
  // Each group's pair: the opponent's move and your answer in one dark tint.
  const usedFamilies = new Set(rootPairs.map((p) => COLORS.findIndex((c) => DARK[c] === p.color)));
  const answersOf = (d: (typeof draws)[number]) => [...(d.reply && !generalKeys.has(keyOf(d.reply)) ? [d.reply] : []), ...d.extra];
  for (const d of draws) {
    // A move you play anyway is already on the Summary in a light colour.
    if (!d.link && answersOf(d).length === 0) continue;
    let fam = d.family % COLORS.length;
    for (let k = 0; k < COLORS.length && usedFamilies.has(fam); k++) fam = (fam + 1) % COLORS.length;
    usedFamilies.add(fam);
    const dark = DARK[COLORS[fam]];
    d.moves.forEach((m, j) => summaryArrows.push({ from: m.from, to: m.to, color: dark, ...(d.link && j === 0 ? { notes: { linkCardId: d.link } } : {}) }));
    answersOf(d).forEach((m) => summaryArrows.push({ from: m.from, to: m.to, color: dark }));
  }
  // "Key reactions": the groups, the root pairs kept, and the exceptions of
  // its light moves (not for an opponent move that is already named).
  const pairTriggers = new Set(rootPlan.pairs.map((p) => `!${p.trigger.san}`));
  const exceptions = rootPlan.keyReactions.filter((r) => {
    const t = r.split(' => ')[0];
    return !pairTriggers.has(t) && !skipSans.has(t);
  });
  const keyReactions = [...groupReactions, ...rootPairs.map((p) => `!${p.trigger.san} => ${p.answers.map((a) => a.san).join(' ')}`), ...exceptions];

  // Single-move reactions → "Reactions: first move" and threats on the
  // Summary; not the ones already drawn as a pair.
  const drawn = new Set([...onCards, ...rootPairs.flatMap((p) => p.answers.map((a) => `${keyOf(p.trigger)}>${keyOf(a)}`)), ...draws.flatMap((d) => d.moves.flatMap((m) => answersOf(d).map((a) => `${keyOf(m)}>${keyOf(a)}`)))]);
  const picked: Reaction[] = [];
  for (const r of [...reactions].sort((a, b) => b.share - a.share)) {
    const ply = r.fullPath.length - 1;
    if (groupMoves.some((m) => m.ply === ply && m.san === r.trigger.san)) continue; // a group of a split already
    if (forcingGroupMoves.some((m) => r.fullPath[m.ply] && keyOf(r.fullPath[m.ply]) === keyOf(m))) continue; // inside a forcing line
    if (drawn.has(`${keyOf(r.trigger)}>${keyOf(r.answer)}`)) continue;
    if (picked.some((p) => p.trigger.san === r.trigger.san || keyOf(p.answer) === keyOf(r.answer))) continue;
    picked.push(r);
    if (picked.length >= MAX_REACTIONS) break;
  }
  const pieceRows: string[] = [];
  if (picked.length > 0) {
    const cardId = newId();
    const boards: BoardSpec[] = picked.map((r) => ({
      id: newId(),
      kind: 'plan',
      path: r.fullPath,
      final: r.after,
      text: `If !${r.trigger.san} => ${r.answer.san}`,
      arrows: [{ from: r.answer.from, to: r.answer.to, color: 'green' }],
      circles: [{ square: r.trigger.to, color: 'red' }]
    }));
    cards.push({
      id: cardId,
      kind: 'firstMove',
      name: 'Reactions: first move',
      info: picked.map((r) => `!${r.trigger.san} => ${r.answer.san}`).join(', '),
      boards
    });
    picked.forEach((r, k) => {
      const letter = LETTERS[k];
      summaryArrows.push({ from: r.trigger.from, to: r.trigger.to, color: 'purple', notes: { threat: letter, linkCardId: cardId, linkBoardId: boards[k].id } });
      summaryArrows.push({ from: r.answer.from, to: r.answer.to, color: 'purple', notes: { threat: letter } });
      pieceRows.push(`${pieceName(r, setup)} | ?${r.answer.san} | !${r.trigger.san}`);
    });
  }

  const summaryText = [
    keyMoves.length ? `Key moves: ${keyMoves.join(' ')}` : '',
    keyReactions.length ? `Key reactions: ${keyReactions.join(', ')}` : '',
    rootPlan.problem && groups.length === 0 ? `No plan could be made here: ${rootPlan.problem}` : '',
    `Source: ${source}`
  ]
    .filter(Boolean)
    .join('\n');
  cards.push({
    id: newId(),
    kind: 'summary',
    name: 'Summary',
    info: ['Your plan', groups.length ? `${groups.length} opponent choices` : '', picked.length ? `${picked.length} threats` : ''].filter(Boolean).join(', '),
    boards: [{ id: newId(), kind: 'plan', path: at.path, final: at.state, text: summaryText, arrows: summaryArrows, circles: [] }]
  });
  cards.sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind]);

  // The opening summary tables.
  const startSans = [...setup, ...at.path].map((m) => m.san);
  const startCell = startSans.map((san, i) => `${i % 2 === 0 ? `${i / 2 + 1}. ` : ''}${(i % 2 === 0 ? 'w' : 'b') !== yourColor ? '!' : ''}${san}`).join(' ');
  const tables = [`# Start | Moves\nOpening | ${startCell}`];
  if (replyRows.length) tables.push(`# Reply | Moves | Except\n${replyRows.join('\n')}`);
  if (pieceRows.length) tables.push(`# Piece | Move | If\n${pieceRows.join('\n')}`);
  return { cards, openingSummary: tables.join('\n\n') };
}

// "4." for White's move, "4..." for Black's (ply counted from the standard start).
function moveNumber(ply: number): string {
  return `${Math.floor(ply / 2) + 1}.${ply % 2 === 0 ? '' : '..'}`;
}

// "!exd5 => cxd5 Be7" → "?cxd5 Be7 after !exd5"
function toExcept(r: string): string {
  const [t, m] = r.split(' => ');
  return `?${m ?? '…'} after ${t}`;
}

// Your moves along the main line, and the opponent's alternatives on the way
// with your first answer ("!Bd3 => d5").
function describeLine(line: LineMove[], yourColor: 'w' | 'b'): { own: string[]; variations: string[] } {
  const own: string[] = [];
  const variations: string[] = [];
  const alt = (siblings: LineMove[]) =>
    siblings.slice(1).forEach((s) => {
      if (s.after.turn === yourColor) variations.push(`!${s.san} => ${s.children[0]?.san ?? '…'}`);
    });
  alt(line);
  for (let n: LineMove | undefined = line[0]; n; n = n.children[0]) {
    if (n.after.turn !== yourColor) own.push(n.san);
    alt(n.children);
  }
  return { own, variations };
}

// Your moves anywhere in a recorded line ("from+to").
function ownKeysIn(line: LineMove[], yourColor: 'w' | 'b'): Set<string> {
  const out = new Set<string>();
  const walk = (list: LineMove[]) =>
    list.forEach((n) => {
      if (n.after.turn !== yourColor) out.add(keyOf(n));
      walk(n.children);
    });
  walk(line);
  return out;
}

// Jonas's piece names: NQ/NK (the knight from the queen- or kingside), BB/BW
// (dark- or light-squared bishop), Q, R, K, P; "later" when the piece has
// moved before.
function pieceName(r: Reaction, setup: Move[]): string {
  const kind = r.after.pieces[r.answer.from]?.[1] ?? 'P';
  const history = [...setup, ...r.fullPath];
  let sq = r.answer.from;
  for (let i = history.length - 1; i >= 0; i--) if (history[i].to === sq) sq = history[i].from;
  const moved = sq !== r.answer.from;
  let code: string = kind;
  if (kind === 'N') code = sq[0] <= 'd' ? 'NQ' : 'NK';
  if (kind === 'B') code = (sq.charCodeAt(0) - 97 + Number(sq[1])) % 2 === 1 ? 'BB' : 'BW';
  return moved && kind !== 'P' ? `${code} later` : code;
}
