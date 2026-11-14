// Edits made from Study or the link viewer (a board's Description, a move
// replaced on the board): saved into the stored card by board id, so a
// viewer that shows only one board of the card never drops the others.
import { getCard, saveCard } from './storage';
import type { Card, ReactionBoard } from './types';

export async function saveStudyBoard(cardId: string, board: ReactionBoard): Promise<Card | null> {
  const full = await getCard(cardId);
  if (!full) return null;
  const updated: Card = { ...full, boards: full.boards.map((b) => (b.id === board.id ? board : b)) };
  await saveCard(updated);
  return updated;
}
