import type { Arrow, ArrowNotes } from './types';

// Trims every part and drops what's left empty (a response needs its text —
// a trigger alone says nothing). Returns undefined when nothing's left, so
// "all fields cleared" and "never had a note" are the same thing.
export function cleanArrowNotes(notes: ArrowNotes | undefined): ArrowNotes | undefined {
  if (!notes) return undefined;
  const reason = notes.reason?.trim();
  const next = notes.next?.trim();
  const responses = (notes.responses ?? [])
    .map((r) => ({ ...r, trigger: r.trigger.trim(), text: r.text.trim() }))
    .filter((r) => r.text.length > 0);
  if (!reason && !next && responses.length === 0) return undefined;
  return {
    ...(reason ? { reason } : {}),
    ...(next ? { next } : {}),
    ...(responses.length > 0 ? { responses } : {})
  };
}

export function hasArrowNotes(arrow: Arrow): boolean {
  return cleanArrowNotes(arrow.notes) !== undefined;
}
