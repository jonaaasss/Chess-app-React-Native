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
  const linkCardId = notes.linkCardId || undefined;
  // Older data stored `threat: true`; that is threat A.
  const raw = notes.threat as unknown;
  const threat = raw === true ? 'A' : typeof raw === 'string' && /^[A-Z]$/.test(raw) ? raw : undefined;
  if (!reason && !next && responses.length === 0 && !linkCardId && !threat) return undefined;
  return {
    ...(linkCardId ? { linkCardId } : {}),
    ...(threat ? { threat } : {}),
    ...(reason ? { reason } : {}),
    ...(next ? { next } : {}),
    ...(responses.length > 0 ? { responses } : {})
  };
}

// Something filled in on the notes screen (a threat letter alone is not a note).
export function hasArrowNotes(arrow: Arrow): boolean {
  const n = cleanArrowNotes(arrow.notes);
  return !!n && Object.keys(n).some((k) => k !== 'threat');
}
