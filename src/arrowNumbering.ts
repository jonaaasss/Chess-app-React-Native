import { arrowIsOpponent, effectiveArrowColor, isOpponentArrow, type NumberedArrow } from './components/ChessBoard';
import { threatOfArrow } from './threats';
import { arrowColors } from './theme';
import type { Arrow, PieceCode } from './types';

// Same thick-arrow-with-side-offset-badge treatment used by Study's variant
// callouts, so the editor's own arrows look identical. Only same-colored
// arrows are numbered against each other (2+ of a color) — a lone arrow of
// its color needs no badge to disambiguate. Arrows from an opponent piece
// (drawn dashed and darker, see isOpponentArrow) are numbered separately,
// among themselves, so they never shift your own arrows' numbers.
export function toEditorNumberedArrows(arrows: Arrow[], pieces: Partial<Record<string, PieceCode>>, yourColor: 'w' | 'b'): NumberedArrow[] {
  // Threat arrows (Summary only) show their letter instead: "!A" on the
  // opponent's move, "A1", "A2" on your answers, and stay out of the numbering.
  const groupOf = (a: Arrow) => `${isOpponentArrow(a.from, pieces, yourColor) ? 'opp' : 'own'}-${a.color}`;
  // Your own threats: "★A" on your threatening move, "A1", "A2" on the
  // follow-up, no badge on the opponent's replies.
  const numbered = arrows.filter((a) => !threatOfArrow(a));
  const threatSeen = new Map<string, number>();
  const countByGroup = new Map<string, number>();
  for (const a of numbered) countByGroup.set(groupOf(a), (countByGroup.get(groupOf(a)) ?? 0) + 1);
  const seenByGroup = new Map<string, number>();
  return arrows.map((a, i) => {
    const base = {
      id: `${a.from}-${a.to}-${a.color}-${i}`,
      from: a.from,
      to: a.to,
      color: arrowColors[effectiveArrowColor(a, pieces, yourColor, arrows)],
      opponent: arrowIsOpponent(a, pieces, yourColor, arrows)
    };
    const t = threatOfArrow(a);
    if (t) {
      const opp = base.opponent;
      if (t.kind === 'opp' && opp) return { ...base, label: `!${t.letter}` };
      if (t.kind === 'mine' && opp) return base;
      const key = `${t.kind}:${t.letter}`;
      const n = (threatSeen.get(key) ?? 0) + 1;
      threatSeen.set(key, n);
      if (t.kind === 'mine') return { ...base, label: n === 1 ? `★${t.letter}` : `${t.letter}${n - 1}` };
      return { ...base, label: `${t.letter}${n}` };
    }
    const seen = (seenByGroup.get(groupOf(a)) ?? 0) + 1;
    seenByGroup.set(groupOf(a), seen);
    return { ...base, number: (countByGroup.get(groupOf(a)) ?? 0) > 1 ? seen : undefined };
  });
}
