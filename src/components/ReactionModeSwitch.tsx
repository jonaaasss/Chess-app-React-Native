// "Play myself" / "Auto-play" for Reactions cards: one remembered choice,
// shared by the switch in the fixed bottom bar (Study and the link viewer)
// and the ReactionStudy that follows it.
import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, radius, touchTarget } from '../theme';
import { getReactionAutoPlay, getReactionAutoPlayCached, setReactionAutoPlay } from '../storage';

const listeners = new Set<(v: boolean) => void>();

export function setAutoPlayMode(v: boolean) {
  void setReactionAutoPlay(v);
  listeners.forEach((l) => l(v));
}

export function useAutoPlayMode(): boolean {
  const [auto, setAuto] = useState(() => getReactionAutoPlayCached() ?? false);
  useEffect(() => {
    listeners.add(setAuto);
    if (getReactionAutoPlayCached() === null) getReactionAutoPlay().then(setAuto);
    return () => {
      listeners.delete(setAuto);
    };
  }, []);
  return auto;
}

export function ReactionModeSwitch() {
  const auto = useAutoPlayMode();
  return (
    <View style={styles.row} accessibilityRole="radiogroup">
      {([false, true] as const).map((v) => (
        <Pressable
          key={String(v)}
          onPress={() => v !== auto && setAutoPlayMode(v)}
          accessibilityRole="radio"
          accessibilityState={{ selected: auto === v }}
          style={[styles.btn, auto === v && styles.btnOn]}
        >
          <Text style={[styles.text, auto === v && styles.textOn]}>{v ? 'Auto-play' : 'Play myself'}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.panel2, padding: 2 },
  btn: { minHeight: touchTarget, paddingHorizontal: 12, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  btnOn: { backgroundColor: '#E2E8F0' },
  text: { color: colors.textDim, fontSize: 13, fontWeight: '600' },
  textOn: { color: colors.bg, fontWeight: '700' }
});
