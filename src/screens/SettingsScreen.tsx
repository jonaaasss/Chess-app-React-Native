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
import { boardStyles, colors, touchTarget, type } from '../theme';
import { Screen, TopBar } from '../components/Common';

const SHUFFLE_DESCRIPTION =
  'Shuffles the cards within each opening while you study. In a whole-repertoire session the openings are always shuffled.';

const MULTIPLE_REPERTOIRES_DESCRIPTION =
  'Always show the list of repertoires per side, so you can add a second one. Off: you go straight to your only repertoire.';

const FIRST_OPENING_DESCRIPTION =
  'The two orange buttons on Home: one walks you through two example cards, the other helps you make your first card.';

// One name per entry in `boardStyles`, in the same order.
const BOARD_STYLE_NAMES = ['Green', 'Brown', 'Slate'];

// The whole row is the switch: tapping the label or its description toggles
// too, not just the small switch itself.
function ToggleRow({
  label,
  value,
  onToggle,
  description
}: {
  label: string;
  value: boolean;
  onToggle: () => void;
  description: string;
}) {
  return (
    <Pressable
      onPress={onToggle}
      accessibilityRole="switch"
      accessibilityState={{ checked: value }}
      style={({ pressed }) => [styles.toggleRow, pressed && styles.toggleRowPressed]}
    >
      <View style={{ flex: 1 }}>
        <Text style={styles.label}>{label}</Text>
        <Text style={styles.description}>{description}</Text>
      </View>
      <View style={[styles.toggle, value && styles.toggleOn]}>
        <View style={[styles.toggleThumb, value && styles.toggleThumbOn]} />
      </View>
    </Pressable>
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
      <ToggleRow label="Shuffle cards" value={shuffleOn} onToggle={toggleShuffle} description={SHUFFLE_DESCRIPTION} />
      <ToggleRow
        label="Show multiple repertoires"
        value={showMultiple}
        onToggle={toggleShowMultiple}
        description={MULTIPLE_REPERTOIRES_DESCRIPTION}
      />
      <ToggleRow
        label="Show beginner guide buttons"
        value={showGuide}
        onToggle={toggleShowGuide}
        description={FIRST_OPENING_DESCRIPTION}
      />

      <Text style={[styles.label, { marginTop: 8 }]}>Board style</Text>
      <Text style={styles.boardStyleHint}>Applies to every board's chessboard, everywhere in the app.</Text>
      <View style={styles.swatchRow}>
        {boardStyles.map((s, idx) => (
          <Pressable key={idx} onPress={() => pickBoardStyle(idx)} style={styles.swatchItem}>
            <View style={[styles.styleSwatch, boardStyle === idx && styles.styleSwatchActive]}>
              {[0, 1, 2, 3].map((cell) => {
                const isLight = cell === 0 || cell === 3;
                return <View key={cell} style={{ width: '50%', height: '50%', backgroundColor: isLight ? s.light : s.dark }} />;
              })}
            </View>
            <Text style={[styles.swatchName, boardStyle === idx && styles.swatchNameActive]}>
              {BOARD_STYLE_NAMES[idx] ?? `Style ${idx + 1}`}
            </Text>
          </Pressable>
        ))}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 56,
    paddingVertical: 10,
    marginBottom: 12,
    borderRadius: 10
  },
  toggleRowPressed: { opacity: 0.7 },
  label: { color: colors.text, ...type.bodyStrong, fontSize: 16 },
  description: { color: colors.textDim, ...type.caption, marginTop: 3 },
  toggle: { width: 46, height: 26, borderRadius: 13, backgroundColor: colors.border, justifyContent: 'center' },
  toggleOn: { backgroundColor: colors.accent },
  toggleThumb: { width: 20, height: 20, borderRadius: 10, backgroundColor: 'white', marginLeft: 3 },
  toggleThumbOn: { marginLeft: 23 },
  boardStyleHint: { color: colors.textDim, ...type.caption, marginTop: 2, marginBottom: 10 },
  swatchRow: { flexDirection: 'row', gap: 16 },
  swatchItem: { alignItems: 'center', gap: 6, minHeight: touchTarget },
  styleSwatch: {
    width: touchTarget,
    height: touchTarget,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: 'transparent',
    overflow: 'hidden',
    flexDirection: 'row',
    flexWrap: 'wrap'
  },
  styleSwatchActive: { borderColor: colors.accent },
  swatchName: { color: colors.textDim, ...type.caption },
  swatchNameActive: { color: colors.text }
});
