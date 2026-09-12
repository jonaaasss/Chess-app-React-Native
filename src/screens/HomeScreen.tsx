import React, { useCallback, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { getExampleRepertoireHidden, getGroupStats, setExampleRepertoireHidden } from '../storage';
import type { GroupId, PieceCode } from '../types';
import { colors, radius, spacing, type } from '../theme';
import { Screen, SettingsCircleButton } from '../components/Common';
import { PieceGlyph } from '../components/ChessBoard';

const BADGE_SIZE = 68;

const GROUPS: { id: GroupId; label: string; piece: PieceCode }[] = [
  { id: 'white', label: 'White', piece: 'wK' },
  { id: 'black', label: 'Black', piece: 'bK' }
];

export function HomeScreen({
  onOpenGroup,
  onOpenSettings
}: {
  onOpenGroup: (group: GroupId) => void;
  onOpenSettings: () => void;
}) {
  const [exampleHidden, setExampleHiddenState] = useState(false);
  const [stats, setStats] = useState<Record<GroupId, { repertoires: number; openings: number; cards: number }>>({
    white: { repertoires: 0, openings: 0, cards: 0 },
    black: { repertoires: 0, openings: 0, cards: 0 }
  });

  const load = useCallback(async () => {
    setExampleHiddenState(await getExampleRepertoireHidden());
    const white = await getGroupStats('white');
    const black = await getGroupStats('black');
    setStats({ white, black });
  }, []);

  // The native stack keeps this screen mounted while a repertoire/opening/
  // card gets added deeper in the stack, so a mount-only load would leave
  // these counts stale after navigating back — reload on every focus.
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  async function toggleExampleHidden() {
    const next = !exampleHidden;
    setExampleHiddenState(next);
    await setExampleRepertoireHidden(next);
    // The example counts toward each side's totals when shown, so the
    // tile subtitles need to reflect the new state right away.
    const white = await getGroupStats('white');
    const black = await getGroupStats('black');
    setStats({ white, black });
  }

  return (
    <Screen>
      <View style={styles.topRow}>
        <SettingsCircleButton onPress={onOpenSettings} />
      </View>

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

      <Pressable onPress={toggleExampleHidden} style={styles.exampleBtn}>
        <Text style={styles.exampleBtnText}>{exampleHidden ? 'Show Example Repertoire' : 'Hide Example Repertoire'}</Text>
      </Pressable>
    </Screen>
  );
}

const styles = StyleSheet.create({
  topRow: { flexDirection: 'row', justifyContent: 'flex-end', marginBottom: 8 },
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
  tileChevron: { color: colors.text, fontSize: 18 },
  exampleBtn: { alignItems: 'center', paddingVertical: 14, marginTop: spacing.md },
  exampleBtnText: { color: colors.textDim, ...type.caption, textDecorationLine: 'underline' }
});
