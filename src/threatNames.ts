// Names of threats ("!C Nd5"): the move of a threat's first arrow, with the
// piece found on its start square or at the start of a chain of arrows.
import type { Arrow, PieceCode } from './types';
import { arrowIsOpponent } from './components/ChessBoard';
import { threatOfArrow, sameThreat, type ThreatKind } from './threats';

// The piece making the move: the one on its start square, else the one at
// the start of a chain of arrows ending there (Nc3 then c3→d5 = Nd5).
export function pieceOf(square: string, pieces: Partial<Record<string, PieceCode>> | undefined, arrows: Arrow[], seen = new Set<string>()): PieceCode | undefined {
  const piece = pieces?.[square];
  if (piece) return piece;
  if (seen.has(square)) return undefined;
  seen.add(square);
  for (const b of arrows) {
    if (b.to !== square) continue;
    const p = pieceOf(b.from, pieces, arrows, seen);
    if (p) return p;
  }
  return undefined;
}

export function sanLike(a: Arrow, pieces: Partial<Record<string, PieceCode>> | undefined, arrows: Arrow[] = []): string {
  const piece = pieceOf(a.from, pieces, arrows.filter((b) => b !== a));
  const kind = piece ? piece[1] : '';
  const capture = pieces?.[a.to] ? 'x' : '';
  if (kind === 'P' || !kind) return capture ? `${a.from[0]}x${a.to}` : a.to;
  return `${kind}${capture}${a.to}`;
}


// The move a threat starts with: the opponent's first move for an opponent
// threat, your first move for one of yours.
export function threatMoveName(
  kind: ThreatKind,
  letter: string,
  arrows: Arrow[],
  pieces: Partial<Record<string, PieceCode>> | undefined,
  yourColor: 'w' | 'b'
): string {
  const all = arrows.filter((a) => sameThreat(threatOfArrow(a), { kind, letter }));
  const isOpp = (a: Arrow) => arrowIsOpponent(a, pieces, yourColor, arrows);
  const lead = kind === 'opp' ? all.find(isOpp) : all.find((a) => !isOpp(a));
  return lead ? sanLike(lead, pieces, arrows) : '';
}
