// Generate plan's reactions (planMaker.ts, `Arrow.belongsTo`): a small square
// badge (round ones are arrow numbers) at the top right of a plan arrow's
// destination square, in the arrow's dark tint, with how many reactions
// belong to it. A tap shows them on the board
// (the badge turns light), another tap hides them again. Used in the board
// editor and in Study; the reactions are never drawn by you.
import React from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { flipIndex, squareIndex } from '../chess';
import type { Arrow } from '../types';

export interface RevealTarget {
  key: string; // "from+to" of the plan arrow
  to: string;
  count: number;
  color: string; // the dark tint, as a colour value
  open: boolean;
}

export const REVEAL_BADGE = 20;

export function revealBadgeCenter(to: string, size: number, flipped: boolean): { x: number; y: number } {
  const cell = size / 8;
  const raw = squareIndex(to);
  const x = (flipIndex(raw.file, flipped) + 1) * cell - REVEAL_BADGE / 2 - 1;
  const y = flipIndex(raw.rank, flipped) * cell + REVEAL_BADGE / 2 + 1;
  return { x, y };
}

// The arrows that belong to a plan arrow on the board, by its "from+to";
// an arrow whose plan arrow is gone counts as an ordinary arrow.
export function linkedArrows(arrows: Arrow[]): Map<string, Arrow[]> {
  const owners = new Set(arrows.filter((a) => !a.belongsTo).map((a) => `${a.from}${a.to}`));
  const out = new Map<string, Arrow[]>();
  for (const a of arrows) {
    if (!a.belongsTo || !owners.has(a.belongsTo)) continue;
    out.set(a.belongsTo, [...(out.get(a.belongsTo) ?? []), a]);
  }
  return out;
}

export function isHiddenLinked(a: Arrow, linked: Map<string, Arrow[]>, open: Set<string>): boolean {
  return !!a.belongsTo && linked.has(a.belongsTo) && !open.has(a.belongsTo);
}

export function RevealBadges({
  targets,
  size,
  flipped,
  onToggle
}: {
  targets: RevealTarget[];
  size: number;
  flipped: boolean;
  onToggle: (key: string) => void;
}) {
  return (
    <>
      {targets.map((t) => {
        const c = revealBadgeCenter(t.to, size, flipped);
        return (
          <Pressable
            key={t.key}
            onPress={() => onToggle(t.key)}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel={t.open ? 'Hide the reactions to this plan move' : `Show the ${t.count} reactions to this plan move`}
            style={[
              styles.badge,
              { left: c.x - REVEAL_BADGE / 2, top: c.y - REVEAL_BADGE / 2 },
              t.open ? { backgroundColor: '#F8FAFC', borderColor: t.color } : { backgroundColor: t.color, borderColor: '#F8FAFC' }
            ]}
          >
            <Text style={[styles.text, { color: t.open ? t.color : '#FFFFFF' }]}>{t.open ? '×' : t.count}</Text>
          </Pressable>
        );
      })}
    </>
  );
}

const styles = StyleSheet.create({
  badge: {
    position: 'absolute',
    width: REVEAL_BADGE,
    height: REVEAL_BADGE,
    borderRadius: 5,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center'
  },
  text: { fontSize: 11, fontWeight: '800', lineHeight: 13 }
});
