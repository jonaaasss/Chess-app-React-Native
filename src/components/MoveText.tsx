import React from 'react';
import { Text, StyleSheet, type StyleProp, type TextStyle } from 'react-native';
import { colors } from '../theme';

// Chess moves in free text (Ne5, Bxc6, exd5, Qxd5+, O-O, e4, e8=Q) — found
// with a plain regex, then kept only when not glued to other letters/digits,
// so words like "knight" or "e pawn" never match. Squares on their own (h3)
// match too, which suits "bishop sees h3".
// A "!" glued to the front of a move ("!Nf3") marks it as a move to avoid: it
// is shown in red and without the "!" (the text field itself keeps the "!").
const MOVE_RE = /(!?)(O-O-O|O-O|0-0-0|0-0|[KQRBN]?[a-h]?[1-8]?x?[a-h][1-8](?:=[QRBN])?[+#]?)/g;

function isWordChar(ch: string | undefined): boolean {
  return ch !== undefined && /[A-Za-z0-9]/.test(ch);
}

// Plain text with every chess move picked out (bold, monospace, logo gold) —
// shared by the arrow notes and the opening summary so notation looks the
// same everywhere. `blurred` hides the text behind a soft glow instead of
// swapping it for a placeholder: the glyphs go transparent and only their
// text-shadow is drawn, a pure-JS blur (no native blur dependency).
export function MoveText({
  text,
  style,
  blurred,
  numberOfLines
}: {
  text: string;
  style?: StyleProp<TextStyle>;
  blurred?: boolean;
  numberOfLines?: number;
}) {
  const parts: React.ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  MOVE_RE.lastIndex = 0;
  while ((m = MOVE_RE.exec(text)) !== null) {
    const start = m.index;
    const end = start + m[0].length;
    if (m[0].length === 0) {
      MOVE_RE.lastIndex++;
      continue;
    }
    if (isWordChar(text[start - 1]) || isWordChar(text[end])) continue;
    if (start > last) parts.push(text.slice(last, start));
    const avoid = m[1] === '!';
    const moveStyle = avoid ? (blurred ? styles.avoidBlurred : styles.avoid) : blurred ? styles.moveBlurred : styles.move;
    parts.push(
      <Text key={start} style={moveStyle}>
        {m[2]}
      </Text>
    );
    last = end;
  }
  if (last < text.length) parts.push(text.slice(last));
  return (
    <Text style={[style, blurred && styles.blurred]} numberOfLines={numberOfLines}>
      {parts}
    </Text>
  );
}

const styles = StyleSheet.create({
  move: { color: colors.logoGold, fontWeight: '700', fontFamily: 'monospace' },
  blurred: {
    color: 'transparent',
    textShadowColor: 'rgba(255,255,255,0.85)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 7
  },
  avoid: { color: colors.dangerText, fontWeight: '700', fontFamily: 'monospace' },
  avoidBlurred: {
    color: 'transparent',
    fontWeight: '700',
    fontFamily: 'monospace',
    textShadowColor: colors.dangerText,
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 7
  },
  moveBlurred: {
    color: 'transparent',
    fontWeight: '700',
    fontFamily: 'monospace',
    textShadowColor: colors.logoGold,
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 7
  }
});
