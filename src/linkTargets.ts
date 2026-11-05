import { descriptionFace } from './chess';
import type { Card } from './types';

// What a Summary arrow can link to: another card of the opening, and
// optionally one board of it (cards with 2+ boards).
export interface LinkTarget {
  id: string;
  name: string;
  boards: { id: string; label: string }[];
}

export function toLinkTarget(card: Card): LinkTarget {
  const boards = [...card.boards].sort((a, b) => a.order - b.order);
  return {
    id: card.id,
    name: card.name || 'Untitled card',
    boards: boards.map((b, i) => {
      const first = b[descriptionFace(card.mode)].text.trim().split('\n')[0] ?? '';
      const short = first.length > 40 ? `${first.slice(0, 39)}…` : first;
      return { id: b.id, label: short ? `Board ${i + 1}: ${short}` : `Board ${i + 1}` };
    })
  };
}
