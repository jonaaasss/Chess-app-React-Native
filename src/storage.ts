import AsyncStorage from '@react-native-async-storage/async-storage';
import { boardStateToReactionBoard, cloneReactionBoard } from './chess';
import type { Card, GroupId, Opening, Repertoire } from './types';

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
      front?: { board?: import('./types').BoardState | null };
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
    const has = s.repertoires.some((r) => r.group === group);
    if (!has) {
      s.repertoires.push({ id: uid(), group, name: 'Main Repertoire', order: 0 });
      changed = true;
    }
  }
  if (changed) await persist();
}

// ---------- Repertoires ----------

export async function getRepertoires(group: GroupId): Promise<Repertoire[]> {
  const s = await load();
  return s.repertoires.filter((r) => r.group === group).sort((a, b) => a.order - b.order);
}

export async function getRepertoire(id: string): Promise<Repertoire | undefined> {
  const s = await load();
  return s.repertoires.find((r) => r.id === id);
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
    front: { text: '', board: null },
    back: { text: '', board: null },
    boards: []
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
      front: { text: card.front.text, board: null },
      back: { text: card.back.text, board: null },
      boards: card.boards.map((rb) => cloneReactionBoard(rb, uid()))
    };
    s.cards.push(newCard);
  }
  await persist();
}

// ---------- Aggregate stats ----------

export async function getGroupStats(group: GroupId): Promise<{ repertoires: number; openings: number; cards: number }> {
  const reps = await getRepertoires(group);
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
