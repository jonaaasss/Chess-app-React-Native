import React, { forwardRef } from 'react';
import { View, Text, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { cleanArrowNotes } from '../arrowNotes';
import { colors } from '../theme';
import { MoveText } from './MoveText';
import type { ArrowNotes, ArrowResponse } from '../types';

function responseKind(r: ArrowResponse): string {
  return r.kind === 'reaction' ? 'Reaction' : 'Exception';
}

// Every filled-in part of an arrow's notes, each as its own block under a
// bold label with a stripe in the arrow's colour — one shared component for
// the note panel and the list rows under the board, so both read identically.
export const ArrowNoteBody = forwardRef<View, { notes: ArrowNotes | undefined; accent?: string; compact?: boolean; style?: StyleProp<ViewStyle> }>(
  function ArrowNoteBody({ notes, accent, compact, style }, ref) {
    const cleaned = cleanArrowNotes(notes);
    const text = compact ? styles.textCompact : styles.text;
    const label = compact ? styles.labelCompact : styles.label;
    const part = [styles.part, { borderLeftColor: accent ?? colors.border }];
    return (
      <View ref={ref} collapsable={false} style={[styles.wrap, style]}>
        {cleaned?.reason ? (
          <View style={part}>
            <Text style={label}>Reason</Text>
            <MoveText text={cleaned.reason} style={text} />
          </View>
        ) : null}
        {cleaned?.next ? (
          <View style={part}>
            <Text style={label}>Follow-up plan</Text>
            <MoveText text={cleaned.next} style={text} />
          </View>
        ) : null}
        {cleaned?.responses?.map((r, i) => (
          <View key={i} style={part}>
            <Text style={[label, r.kind === 'exception' && styles.labelException]}>{responseKind(r)}</Text>
            {r.trigger ? <MoveText text={`if ${r.trigger}`} style={styles.trigger} /> : null}
            <MoveText text={r.text} style={text} />
          </View>
        ))}
      </View>
    );
  }
);

const styles = StyleSheet.create({
  wrap: { gap: 12 },
  part: { gap: 3, borderLeftWidth: 3, paddingLeft: 10 },
  label: { color: colors.text, fontSize: 15, fontWeight: '700' },
  labelCompact: { color: colors.text, fontSize: 14, fontWeight: '700' },
  labelException: { color: colors.gold },
  trigger: { color: colors.textDim, fontSize: 13, lineHeight: 19 },
  text: { color: colors.text, fontSize: 14, lineHeight: 20 },
  textCompact: { color: colors.text, fontSize: 13, lineHeight: 19 }
});
