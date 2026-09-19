import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import type { CardMode } from '../types';
import { colors, radius } from '../theme';

// The step-by-step "how does this mode work" text, shared by the card editor
// (always shown) and the board editor (closable) so the two can't drift.
export const MODE_TIPS: Record<CardMode, string> = {
  reactions:
    '1) Set up your starting position.\n2) Press "Play" and play out the moves you want to study (you can practice multiple variations by going back to a move and playing a different move).\n3) While studying, the opponent\'s moves will be played automatically and you have to find the move you recorded.',
  plan:
    '1) Set up your position.\n2) Draw arrows which is the general plan in the position.\n3) While studying, you will find the exact position but without arrows which you will have to draw yourself.',
  others:
    '1) Set up your position on the front side.\n2) Flip to back and make some moves and/or draw arrows.\n3) While studying, you will see the front side. Once you tap the card, it will flip to the back and you mark whether you were correct or not.'
};

// Pass `onClose` to get the ✕ that hides it; without it the tip is
// permanent (the card editor's).
export function ModeTip({ mode, onClose }: { mode: CardMode; onClose?: () => void }) {
  return (
    <View style={styles.tip}>
      <Text style={styles.icon}>ⓘ</Text>
      <Text style={styles.text}>{MODE_TIPS[mode]}</Text>
      {onClose && (
        <Pressable onPress={onClose} hitSlop={10} style={styles.close}>
          <Svg width={14} height={14} viewBox="0 0 24 24">
            <Path d="M6 6l12 12M18 6L6 18" stroke={colors.textDim} strokeWidth={3} strokeLinecap="round" />
          </Svg>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  tip: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: colors.panel2,
    borderWidth: 1,
    borderColor: colors.border,
    borderLeftWidth: 3,
    borderLeftColor: colors.accent,
    borderRadius: radius.md,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginBottom: 12
  },
  icon: { color: colors.accent, fontSize: 13, fontWeight: '700' },
  text: { color: colors.text, fontSize: 12.5, fontWeight: '500', flex: 1, lineHeight: 17 },
  close: { paddingTop: 2 }
});
