import React, { useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { getGroupStats, getSetting, setSetting } from '../storage';
import type { GroupId, PieceCode } from '../types';
import { colors, radius, spacing, type } from '../theme';
import { Screen } from '../components/Common';
import { PieceGlyph } from '../components/ChessBoard';

const SHUFFLE_TOOLTIP =
  'When enabled, the cards within each opening are shuffled during study — the order of openings in a full repertoire session is always randomized.';

const BADGE_SIZE = 68;

const GROUPS: { id: GroupId; label: string; piece: PieceCode }[] = [
  { id: 'white', label: 'White', piece: 'wK' },
  { id: 'black', label: 'Black', piece: 'bK' }
];

export function HomeScreen({ onOpenGroup }: { onOpenGroup: (group: GroupId) => void }) {
  const [shuffleOn, setShuffleOn] = useState(false);
  const [showTooltip, setShowTooltip] = useState(false);
  const [stats, setStats] = useState<Record<GroupId, { repertoires: number; openings: number; cards: number }>>({
    white: { repertoires: 0, openings: 0, cards: 0 },
    black: { repertoires: 0, openings: 0, cards: 0 }
  });

  async function load() {
    const on = await getSetting<boolean>('shuffle', false);
    setShuffleOn(on);
    const white = await getGroupStats('white');
    const black = await getGroupStats('black');
    setStats({ white, black });
  }

  useEffect(() => {
    load();
  }, []);

  async function toggleShuffle() {
    const next = !shuffleOn;
    setShuffleOn(next);
    await setSetting('shuffle', next);
  }

  return (
    <Screen>
      <View style={styles.shuffleRow}>
        <Text style={styles.shuffleLabel}>Shuffle</Text>
        <Pressable onPress={() => setShowTooltip((v) => !v)} hitSlop={12} style={{ padding: 6 }}>
          <Text style={{ color: colors.textDim, fontSize: 16 }}>ⓘ</Text>
        </Pressable>
        <Pressable onPress={toggleShuffle} hitSlop={10} style={[styles.toggle, shuffleOn && styles.toggleOn]}>
          <View style={[styles.toggleThumb, shuffleOn && styles.toggleThumbOn]} />
        </Pressable>
      </View>

      {showTooltip && (
        <View style={styles.tooltip}>
          <Text style={styles.tooltipText}>{SHUFFLE_TOOLTIP}</Text>
        </View>
      )}

      <Text style={styles.sectionLabel}>Choose a side</Text>
      {GROUPS.map((g) => {
        const s = stats[g.id];
        return (
          <Pressable
            key={g.id}
            onPress={() => onOpenGroup(g.id)}
            style={({ pressed }) => [styles.tile, pressed && styles.tilePressed]}
          >
            <View style={styles.badge}>
              <PieceGlyph code={g.piece} cell={BADGE_SIZE * 0.92} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.tileTitle}>{g.label}</Text>
              <Text style={styles.tileSub}>
                {s.repertoires} repertoire{s.repertoires === 1 ? '' : 's'} · {s.openings} opening
                {s.openings === 1 ? '' : 's'} · {s.cards} card{s.cards === 1 ? '' : 's'}
              </Text>
            </View>
            <View style={styles.chevronCircle}>
              <Text style={styles.tileChevron}>›</Text>
            </View>
          </Pressable>
        );
      })}
    </Screen>
  );
}

const styles = StyleSheet.create({
  shuffleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 6,
    marginBottom: 20
  },
  shuffleLabel: { color: colors.text, ...type.bodyStrong, fontSize: 16, flex: 1 },
  toggle: { width: 46, height: 26, borderRadius: 13, backgroundColor: colors.border, justifyContent: 'center' },
  toggleOn: { backgroundColor: colors.accent },
  toggleThumb: { width: 20, height: 20, borderRadius: 10, backgroundColor: 'white', marginLeft: 3 },
  toggleThumbOn: { marginLeft: 23 },
  tooltip: {
    backgroundColor: colors.panel2,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    padding: 12,
    marginBottom: 16
  },
  tooltipText: { color: colors.textDim, ...type.caption },
  sectionLabel: {
    color: colors.textDim,
    ...type.micro,
    textTransform: 'uppercase',
    marginBottom: spacing.md
  },
  tile: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl + 4,
    borderWidth: 1.5,
    borderColor: colors.border,
    padding: spacing.xl,
    minHeight: 108,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    marginBottom: spacing.lg
  },
  tilePressed: { opacity: 0.9, transform: [{ scale: 0.99 }] },
  badge: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: colors.pieceBadgeBg,
    alignItems: 'center',
    justifyContent: 'center'
  },
  tileTitle: { color: colors.text, ...type.h1, fontSize: 22 },
  tileSub: { color: colors.textDim, ...type.caption, marginTop: 5 },
  chevronCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center'
  },
  tileChevron: { color: colors.text, fontSize: 18 }
});
