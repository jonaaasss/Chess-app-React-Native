import type { Arrow, ArrowColor, Circle } from './types';

// Summary threats: an opponent threat ("opp", purple, "!A") or one of your
// own ("mine", teal, "★A"), each identified by a capital letter.
export type ThreatKind = 'opp' | 'mine';
export interface ThreatRef {
  kind: ThreatKind;
  letter: string;
}

export const THREAT_COLOR = { opp: 'purple', mine: 'teal' } as const satisfies Record<ThreatKind, ArrowColor>;

export function threatOfArrow(a: Arrow): ThreatRef | null {
  if (a.notes?.threat) return { kind: 'opp', letter: a.notes.threat };
  if (a.notes?.myThreat) return { kind: 'mine', letter: a.notes.myThreat };
  return null;
}

export function threatOfCircle(c: Circle): ThreatRef | null {
  if (c.threat) return { kind: 'opp', letter: c.threat };
  if (c.myThreat) return { kind: 'mine', letter: c.myThreat };
  return null;
}

export function sameThreat(a: ThreatRef | null, b: ThreatRef | null): boolean {
  return !!a && !!b && a.kind === b.kind && a.letter === b.letter;
}

// The fields that tag an arrow's notes or a circle as part of a threat.
export function threatFields(t: ThreatRef): { threat?: string; myThreat?: string } {
  return t.kind === 'opp' ? { threat: t.letter } : { myThreat: t.letter };
}
