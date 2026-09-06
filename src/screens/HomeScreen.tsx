import React, { useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { getGroupStats, getSetting, setSetting } from '../storage';
import type { GroupId } from '../types';
import { colors, radius } from '../theme';
import { Screen } from '../components/Common';

const SHUFFLE_TOOLTIP =
  'When enabled, the cards within each opening are shuffled during study — the order of openings in a full repertoire session is always randomized.';

const GROUPS: { id: GroupId; label: string; icon: string }[] = [
  { id: 'white', label: 'White', icon: '♔' },
  { id: 'black', label: 'Black', icon: '♚' }
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
        <Pressable onPress={() => setShowTooltip((v) => !v)} style={{ padding: 6 }}>
          <Text style={{ color: colors.textDim, fontSize: 16 }}>ⓘ</Text>
        </Pressable>
        <Pressable onPress={toggleShuffle} style={[styles.toggle, shuffleOn && styles.toggleOn]}>
          <View style={[styles.toggleThumb, shuffleOn && styles.toggleThumbOn]} />
        </Pressable>
      </View>

      {showTooltip && (
        <View style={styles.tooltip}>
          <Text style={styles.tooltipText}>{SHUFFLE_TOOLTIP}</Text>
        </View>
      )}

      {GROUPS.map((g) => {
        const s = stats[g.id];
        const tileBg = g.id === 'white' ? colors.tileWhiteBg : colors.tileBlackBg;
        return (
          <Pressable
            key={g.id}
            onPress={() => onOpenGroup(g.id)}
            style={({ pressed }) => [
              styles.tile,
              { backgroundColor: tileBg },
              pressed && { opacity: 0.85 }
            ]}
          >
            <Text style={styles.tileIcon}>{g.icon}</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.tileTitle}>{g.label}</Text>
              <Text style={styles.tileSub}>
                {s.repertoires} repertoire{s.repertoires === 1 ? '' : 's'} · {s.openings} opening
                {s.openings === 1 ? '' : 's'} · {s.cards} card{s.cards === 1 ? '' : 's'}
              </Text>
            </View>
            <Text style={styles.tileChevron}>›</Text>
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
  shuffleLabel: { color: colors.text, fontWeight: '600', fontSize: 15.5, flex: 1 },
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
  tooltipText: { color: colors.textDim, fontSize: 12.5 },
  tile: {
    borderRadius: radius + 4,
    padding: 20,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    marginBottom: 12
  },
  tileIcon: { fontSize: 32, color: colors.text },
  tileTitle: { color: colors.text, fontSize: 19, fontWeight: '700' },
  tileSub: { color: colors.textDim, fontSize: 13, marginTop: 4 },
  tileChevron: { color: colors.textDim, fontSize: 22 }
});
