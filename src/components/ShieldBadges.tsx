// Shields on the board (src/shields.ts): a small shield at the bottom right of
// one of your attacked pieces or pawns, with the piece that takes back on it.
// A shield you chose yourself has a gold edge. In the board editor a tap on a
// shield lets you change it (`onPress`); in Study it is only shown.
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Svg, { G, Path } from 'react-native-svg';
import { flipIndex, squareIndex } from '../chess';
import { colors } from '../theme';
import { PieceArt } from './pieceArt';
import type { PieceCode } from '../types';

export interface ShownShield {
  square: string;
  piece: PieceCode; // the piece that takes back
  manual: boolean;
  off?: boolean; // removed by you: a faint outline in the editor, to bring it back
}

const SHIELD = 'M12 1.5 L21 4.8 V11 C21 16.6 17.2 20.8 12 22.5 C6.8 20.8 3 16.6 3 11 V4.8 Z';

function ShieldIcon({ piece, manual, off, size }: { piece: PieceCode; manual: boolean; off?: boolean; size: number }) {
  if (off) {
    return (
      <Svg width={size} height={size} viewBox="0 0 24 24" opacity={0.55}>
        <Path d={SHIELD} fill="none" stroke={colors.gold} strokeWidth={1.6} strokeDasharray="2.5 2" />
      </Svg>
    );
  }
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {/* Light behind a black piece, dark behind a white one, so the piece stands out. */}
      <Path d={SHIELD} fill={piece[0] === 'b' ? '#E2E8F0' : '#1E293B'} stroke={manual ? colors.gold : piece[0] === 'b' ? '#0F172A' : '#F8FAFC'} strokeWidth={manual ? 2.2 : 1.6} />
      {/* The piece art is drawn on 45×45; scaled into the shield's middle. */}
      <G transform="translate(5.4 4.6) scale(0.293)">
        <PieceArt code={piece} />
      </G>
    </Svg>
  );
}

export function ShieldBadges({
  shields,
  size,
  flipped = false,
  onPress
}: {
  shields: ShownShield[];
  size: number;
  flipped?: boolean;
  onPress?: (square: string) => void;
}) {
  const cell = size / 8;
  const badge = Math.max(18, Math.round(cell * 0.52));
  return (
    <>
      {shields.map((s) => {
        const raw = squareIndex(s.square);
        const left = (flipIndex(raw.file, flipped) + 1) * cell - badge;
        const top = (flipIndex(raw.rank, flipped) + 1) * cell - badge;
        const icon = <ShieldIcon piece={s.piece} manual={s.manual} off={s.off} size={badge} />;
        return onPress ? (
          <Pressable
            key={s.square}
            onPress={() => onPress(s.square)}
            hitSlop={8}
            style={[styles.badge, { left, top, width: badge, height: badge }]}
            accessibilityRole="button"
            accessibilityLabel={`Shield on ${s.square}: change who takes back`}
          >
            {icon}
          </Pressable>
        ) : (
          <View key={s.square} pointerEvents="none" style={[styles.badge, { left, top, width: badge, height: badge }]}>
            {icon}
          </View>
        );
      })}
    </>
  );
}

const styles = StyleSheet.create({
  badge: { position: 'absolute' }
});
