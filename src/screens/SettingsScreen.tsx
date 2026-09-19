import React, { useCallback, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import {
  getSetting,
  setSetting,
  getShowMultipleRepertoires,
  setShowMultipleRepertoires,
  getBoardStyle,
  setBoardStyle,
  getShowFirstOpeningGuide,
  setShowFirstOpeningGuide
} from '../storage';
import { boardStyles, colors, type } from '../theme';
import { Screen, TopBar } from '../components/Common';

const SHUFFLE_TOOLTIP =
  'When enabled, the cards within each opening are shuffled during study — the order of openings in a full repertoire session is always randomized.';

const MULTIPLE_REPERTOIRES_TOOLTIP =
  'Almost nobody needs more than one repertoire per side, so that list is skipped by default. Turn this on to always see it — useful once you actually have more than one.';

const FIRST_OPENING_TOOLTIP =
  'The two orange beginner buttons on the home screen: one walks you through two example cards (a Reactions card and a Plan card) of the Italian Game, the other guides you through making your own first card. You can hide them there once you no longer need them, and bring them back here.';

function ToggleRow({
  label,
  value,
  onToggle,
  tooltip
}: {
  label: string;
  value: boolean;
  onToggle: () => void;
  tooltip: string;
}) {
  const [showTooltip, setShowTooltip] = useState(false);
  return (
    <View style={{ marginBottom: 20 }}>
      <View style={styles.row}>
        <Text style={styles.label}>{label}</Text>
        <Pressable onPress={() => setShowTooltip((v) => !v)} hitSlop={12} style={{ padding: 6 }}>
          <Text style={{ color: colors.textDim, fontSize: 16 }}>ⓘ</Text>
        </Pressable>
        <Pressable onPress={onToggle} hitSlop={10} style={[styles.toggle, value && styles.toggleOn]}>
          <View style={[styles.toggleThumb, value && styles.toggleThumbOn]} />
        </Pressable>
      </View>
      {showTooltip && (
        <View style={styles.tooltip}>
          <Text style={styles.tooltipText}>{tooltip}</Text>
        </View>
      )}
    </View>
  );
}

export function SettingsScreen({ onBack }: { onBack: () => void }) {
  const [shuffleOn, setShuffleOn] = useState(false);
  const [showMultiple, setShowMultiple] = useState(false);
  const [showGuide, setShowGuide] = useState(true);
  const [boardStyle, setBoardStyleState] = useState(0);

  const load = useCallback(async () => {
    setShuffleOn(await getSetting<boolean>('shuffle', false));
    setShowGuide(await getShowFirstOpeningGuide());
    setShowMultiple(await getShowMultipleRepertoires());
    setBoardStyleState(await getBoardStyle());
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  async function toggleShuffle() {
    const next = !shuffleOn;
    setShuffleOn(next);
    await setSetting('shuffle', next);
  }

  async function toggleShowMultiple() {
    const next = !showMultiple;
    setShowMultiple(next);
    await setShowMultipleRepertoires(next);
  }

  async function toggleShowGuide() {
    const next = !showGuide;
    setShowGuide(next);
    await setShowFirstOpeningGuide(next);
  }

  async function pickBoardStyle(idx: number) {
    setBoardStyleState(idx);
    await setBoardStyle(idx);
  }

  return (
    <Screen>
      <TopBar title="Settings" onBack={onBack} />
      <ToggleRow label="Shuffle" value={shuffleOn} onToggle={toggleShuffle} tooltip={SHUFFLE_TOOLTIP} />
      <ToggleRow
        label="Show multiple repertoires"
        value={showMultiple}
        onToggle={toggleShowMultiple}
        tooltip={MULTIPLE_REPERTOIRES_TOOLTIP}
      />
      <ToggleRow
        label="Show beginner guide buttons"
        value={showGuide}
        onToggle={toggleShowGuide}
        tooltip={FIRST_OPENING_TOOLTIP}
      />

      <Text style={styles.label}>Board style</Text>
      <Text style={styles.boardStyleHint}>Applies to every board's chessboard, everywhere in the app.</Text>
      <View style={styles.swatchRow}>
        {boardStyles.map((s, idx) => (
          <Pressable
            key={idx}
            onPress={() => pickBoardStyle(idx)}
            hitSlop={6}
            style={[styles.styleSwatch, boardStyle === idx && styles.styleSwatchActive]}
          >
            {[0, 1, 2, 3].map((cell) => {
              const isLight = cell === 0 || cell === 3;
              return <View key={cell} style={{ width: '50%', height: '50%', backgroundColor: isLight ? s.light : s.dark }} />;
            })}
          </Pressable>
        ))}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  label: { color: colors.text, ...type.bodyStrong, fontSize: 16, flex: 1 },
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
    marginTop: 8
  },
  tooltipText: { color: colors.textDim, ...type.caption },
  boardStyleHint: { color: colors.textDim, ...type.caption, marginTop: -4, marginBottom: 10 },
  swatchRow: { flexDirection: 'row', gap: 10 },
  styleSwatch: {
    width: 40,
    height: 40,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: 'transparent',
    overflow: 'hidden',
    flexDirection: 'row',
    flexWrap: 'wrap'
  },
  styleSwatchActive: { borderColor: colors.accent }
});
