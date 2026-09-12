import AsyncStorage from '@react-native-async-storage/async-storage';
import { boardStateToReactionBoard, cloneBoardFace, cloneReactionBoard, newReactionBoard } from './chess';
import { buildExampleContent } from './exampleContent';
import type { Card, GroupId, Opening, Repertoire } from './types';

const EXAMPLE_HIDDEN_KEY = 'exampleRepertoireHidden';
const SHOW_MULTIPLE_REPERTOIRES_KEY = 'showMultipleRepertoires';
const BOARD_STYLE_KEY = 'boardStyle';

const STORAGE_KEY = 'chess-flashcards-data';

interface Store {
  repertoires: Repertoire[];
  openings: Opening[];
  cards: Card[];
  settings: Record<string, unknown>;
}

function emptyStore(): Store {
  return { repertoires: [], openings: [], cards: [], settings: {} };
}

let store: Store | null = null;

// Backfills fields added after cards were first persisted, so data saved
// before "Reactions" mode existed keeps loading and behaving exactly as
// "Others" mode (no board-editing behavior changes for existing cards).
function migrate(s: Store): void {
  for (const card of s.cards) {
    const legacy = card as unknown as {
      mode?: string;
      name?: string;
      reactionBoards?: Card['boards'];
      boards?: Card['boards'];
      front?: { text?: string; board?: import('./types').BoardState | null };
      back?: { text?: string };
    };
    if (!card.mode) card.mode = 'others';
    if (card.name === undefined) card.name = '';
    if (!card.boards) {
      if (legacy.reactionBoards && legacy.reactionBoards.length > 0) {
        card.boards = legacy.reactionBoards;
      } else if (legacy.front?.board) {
        card.boards = [boardStateToReactionBoard(legacy.front.board, uid(), 0)];
      } else {
        card.boards = [];
      }
    }
    delete legacy.reactionBoards;

    // Backfills boards saved before the front/back split — both sides
    // start out identical to whatever the single board used to be, so
    // nothing about existing Others/Plan boards visibly changes on load.
    for (const board of card.boards) {
      const legacyBoard = board as unknown as { front?: unknown; back?: unknown };
      if (!legacyBoard.front || !legacyBoard.back) {
        const face = {
          pieces: { ...board.pieces },
          turn: board.turn,
          castling: { ...board.castling },
          enPassant: board.enPassant,
          arrows: board.arrows.map((a) => ({ ...a })),
          circles: board.circles.map((c) => ({ ...c })),
          text: '',
          moves: []
        };
        board.front = cloneBoardFace(face);
        board.back = cloneBoardFace(face);
      }
    }

    // Backfills faces saved before `text`/`moves` existed on BoardFace.
    for (const board of card.boards) {
      for (const face of [board.front, board.back]) {
        const legacyFace = face as unknown as { text?: string; moves?: unknown };
        if (legacyFace.text === undefined) legacyFace.text = '';
        if (!legacyFace.moves) legacyFace.moves = [];
      }
    }

    // Text used to live on the card itself (one front/back pair for the
    // whole card) — it now lives per-board. Reactions/Others keep using the
    // old front→front, back→back mapping; a Plan card only shows a single
    // description (on the board's `back`), so its old front and back text
    // are merged there rather than half of it silently becoming invisible.
    // A card always has at least one board going forward, so one is
    // created here if this old card had none.
    if (legacy.front || legacy.back) {
      if (card.boards.length === 0) {
        card.boards = [newReactionBoard(uid(), 0)];
      }
      const first = card.boards[0];
      if (card.mode === 'plan') {
        const planText = legacy.back?.text || legacy.front?.text || '';
        if (planText) first.back.text = planText;
      } else {
        if (legacy.front?.text) first.front.text = legacy.front.text;
        if (legacy.back?.text) first.back.text = legacy.back.text;
      }
      delete legacy.front;
      delete legacy.back;
    } else if (card.boards.length === 0) {
      card.boards = [newReactionBoard(uid(), 0)];
    }
  }
}

async function load(): Promise<Store> {
  if (store) return store;
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  store = raw ? (JSON.parse(raw) as Store) : emptyStore();
  migrate(store);
  return store;
}

async function persist(): Promise<void> {
  if (!store) return;
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(store));
}

export function uid(): string {
  // React Native has no built-in Web Crypto by default, so we generate
  // a random v4-shaped id manually instead of relying on crypto.randomUUID.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export async function ensureSeeded(): Promise<void> {
  const s = await load();
  const groups: GroupId[] = ['white', 'black'];
  let changed = false;
  for (const group of groups) {
    const hasOwn = s.repertoires.some((r) => r.group === group && !r.isExample);
    if (!hasOwn) {
      const order = s.repertoires.filter((r) => r.group === group).length;
      s.repertoires.push({ id: uid(), group, name: 'Main Repertoire', order, isExample: false });
      changed = true;
    }
    const hasExample = s.repertoires.some((r) => r.group === group && r.isExample);
    if (!hasExample) {
      const order = s.repertoires.filter((r) => r.group === group).length;
      const exampleId = uid();
      s.repertoires.push({ id: exampleId, group, name: 'Example Repertoire', order, isExample: true });
      const { openings, cards } = buildExampleContent(group, exampleId, uid);
      s.openings.push(...openings);
      s.cards.push(...cards);
      changed = true;
    }
  }
  if (changed) await persist();
}

// ---------- Repertoires ----------

export async function getRepertoires(group: GroupId): Promise<Repertoire[]> {
  const s = await load();
  // The example always sorts first, regardless of its stored `order` — a
  // fixed, predictable landmark rather than something that could drift
  // depending on when it happened to be seeded relative to the user's own.
  return s.repertoires
    .filter((r) => r.group === group)
    .sort((a, b) => Number(!!b.isExample) - Number(!!a.isExample) || a.order - b.order);
}

export async function getRepertoire(id: string): Promise<Repertoire | undefined> {
  const s = await load();
  return s.repertoires.find((r) => r.id === id);
}

// The list a group's repertoires actually show as — excludes the example
// when it's hidden. Fetching a specific repertoire by id (above) is
// unaffected: hiding only changes what's listed, not what's reachable once
// you already have its id.
export async function getVisibleRepertoires(group: GroupId): Promise<Repertoire[]> {
  const all = await getRepertoires(group);
  const hidden = await getExampleRepertoireHidden();
  return hidden ? all.filter((r) => !r.isExample) : all;
}

// Whether tapping into this group should skip straight to its one
// repertoire's openings instead of showing the repertoire list — true
// almost always, since most people never use more than one.
export async function resolveGroupEntry(group: GroupId): Promise<{ skipToRepertoireId?: string }> {
  const showMultiple = await getShowMultipleRepertoires();
  if (showMultiple) return {};
  const visible = await getVisibleRepertoires(group);
  return visible.length === 1 ? { skipToRepertoireId: visible[0].id } : {};
}

export async function restoreExampleRepertoire(repertoireId: string): Promise<void> {
  const s = await load();
  const rep = s.repertoires.find((r) => r.id === repertoireId && r.isExample);
  if (!rep) return;
  const openingIds = s.openings.filter((o) => o.repertoireId === repertoireId).map((o) => o.id);
  s.cards = s.cards.filter((c) => !openingIds.includes(c.openingId));
  s.openings = s.openings.filter((o) => o.repertoireId !== repertoireId);
  const { openings, cards } = buildExampleContent(rep.group, repertoireId, uid);
  s.openings.push(...openings);
  s.cards.push(...cards);
  await persist();
}

export async function addRepertoire(group: GroupId, name: string): Promise<Repertoire> {
  const s = await load();
  const existing = await getRepertoires(group);
  const rep: Repertoire = { id: uid(), group, name, order: existing.length };
  s.repertoires.push(rep);
  await persist();
  return rep;
}

export async function renameRepertoire(id: string, name: string): Promise<void> {
  const s = await load();
  const rep = s.repertoires.find((r) => r.id === id);
  if (!rep) return;
  rep.name = name;
  await persist();
}

export async function deleteRepertoire(id: string): Promise<void> {
  const s = await load();
  const openings = s.openings.filter((o) => o.repertoireId === id);
  for (const o of openings) {
    await deleteOpening(o.id);
  }
  s.repertoires = s.repertoires.filter((r) => r.id !== id);
  await persist();
}

// ---------- Openings ----------

export async function getOpenings(repertoireId: string): Promise<Opening[]> {
  const s = await load();
  return s.openings.filter((o) => o.repertoireId === repertoireId).sort((a, b) => a.order - b.order);
}

export async function getOpening(id: string): Promise<Opening | undefined> {
  const s = await load();
  return s.openings.find((o) => o.id === id);
}

export async function addOpening(repertoireId: string, name: string): Promise<Opening> {
  const s = await load();
  const existing = await getOpenings(repertoireId);
  const opening: Opening = { id: uid(), repertoireId, name, order: existing.length };
  s.openings.push(opening);
  await persist();
  return opening;
}

export async function renameOpening(id: string, name: string): Promise<void> {
  const s = await load();
  const o = s.openings.find((x) => x.id === id);
  if (!o) return;
  o.name = name;
  await persist();
}

export async function deleteOpening(id: string): Promise<void> {
  const s = await load();
  s.cards = s.cards.filter((c) => c.openingId !== id);
  s.openings = s.openings.filter((o) => o.id !== id);
  await persist();
}

// ---------- Cards ----------

export async function getCards(openingId: string): Promise<Card[]> {
  const s = await load();
  return s.cards.filter((c) => c.openingId === openingId).sort((a, b) => a.order - b.order);
}

export async function getCard(id: string): Promise<Card | undefined> {
  const s = await load();
  return s.cards.find((c) => c.id === id);
}

export async function addCard(openingId: string, name = ''): Promise<Card> {
  const s = await load();
  const existing = await getCards(openingId);
  const card: Card = {
    id: uid(),
    openingId,
    order: existing.length,
    name,
    mode: 'others',
    boards: [newReactionBoard(uid(), 0)]
  };
  s.cards.push(card);
  await persist();
  return card;
}

export async function renameCard(id: string, name: string): Promise<void> {
  const s = await load();
  const c = s.cards.find((x) => x.id === id);
  if (!c) return;
  c.name = name;
  await persist();
}

export async function saveCard(card: Card): Promise<void> {
  const s = await load();
  const idx = s.cards.findIndex((c) => c.id === card.id);
  if (idx >= 0) {
    s.cards[idx] = card;
  } else {
    s.cards.push(card);
  }
  await persist();
}

export async function deleteCard(id: string): Promise<void> {
  const s = await load();
  s.cards = s.cards.filter((c) => c.id !== id);
  await persist();
}

export async function reorderCards(_openingId: string, orderedIds: string[]): Promise<void> {
  const s = await load();
  orderedIds.forEach((id, i) => {
    const c = s.cards.find((x) => x.id === id);
    if (c) c.order = i;
  });
  await persist();
}

export async function moveOrDuplicateCard(
  cardId: string,
  targetOpeningId: string,
  mode: 'move' | 'duplicate'
): Promise<void> {
  const s = await load();
  const card = s.cards.find((c) => c.id === cardId);
  if (!card) return;
  const targetCards = await getCards(targetOpeningId);
  if (mode === 'move') {
    card.openingId = targetOpeningId;
    card.order = targetCards.length;
  } else {
    const newCard: Card = {
      id: uid(),
      openingId: targetOpeningId,
      order: targetCards.length,
      name: card.name,
      mode: card.mode,
      boards: card.boards.map((rb) => cloneReactionBoard(rb, uid()))
    };
    s.cards.push(newCard);
  }
  await persist();
}

// ---------- Aggregate stats ----------

export async function getGroupStats(group: GroupId): Promise<{ repertoires: number; openings: number; cards: number }> {
  const reps = await getVisibleRepertoires(group);
  let openingsCount = 0;
  let cardsCount = 0;
  for (const r of reps) {
    const openings = await getOpenings(r.id);
    openingsCount += openings.length;
    for (const o of openings) {
      const cards = await getCards(o.id);
      cardsCount += cards.length;
    }
  }
  return { repertoires: reps.length, openings: openingsCount, cards: cardsCount };
}

export async function getRepertoireStats(repertoireId: string): Promise<{ openings: number; cards: number }> {
  const openings = await getOpenings(repertoireId);
  let cardsCount = 0;
  for (const o of openings) {
    const cards = await getCards(o.id);
    cardsCount += cards.length;
  }
  return { openings: openings.length, cards: cardsCount };
}

// ---------- Settings ----------

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const s = await load();
  return key in s.settings ? (s.settings[key] as T) : fallback;
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  const s = await load();
  s.settings[key] = value;
  await persist();
}

export async function getExampleRepertoireHidden(): Promise<boolean> {
  return getSetting<boolean>(EXAMPLE_HIDDEN_KEY, false);
}

export async function setExampleRepertoireHidden(hidden: boolean): Promise<void> {
  await setSetting(EXAMPLE_HIDDEN_KEY, hidden);
}

export async function getShowMultipleRepertoires(): Promise<boolean> {
  return getSetting<boolean>(SHOW_MULTIPLE_REPERTOIRES_KEY, false);
}

export async function getBoardStyle(): Promise<number> {
  return getSetting<number>(BOARD_STYLE_KEY, 0);
}

export async function setBoardStyle(style: number): Promise<void> {
  await setSetting(BOARD_STYLE_KEY, style);
}

export async function setShowMultipleRepertoires(show: boolean): Promise<void> {
  await setSetting(SHOW_MULTIPLE_REPERTOIRES_KEY, show);
}
