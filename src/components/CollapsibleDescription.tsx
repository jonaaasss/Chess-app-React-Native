// A board's Description in Study and the link viewer, collapsible like the
// lines overview. Collapsing or opening it is remembered for every card.
import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { MoveText } from './MoveText';
import { colors, touchTarget } from '../theme';
import { getDescriptionCollapsed, getDescriptionCollapsedCached, setDescriptionCollapsed } from '../storage';

// With `onEdit`, a pencil at the bottom right of the opened text (also when
// there is no text yet, to add one).
export function CollapsibleDescription({ text, onEdit }: { text: string; onEdit?: () => void }) {
  const [collapsed, setCollapsed] = useState(() => getDescriptionCollapsedCached() ?? false);
  useEffect(() => {
    if (getDescriptionCollapsedCached() === null) getDescriptionCollapsed().then(setCollapsed);
  }, []);
  if (!text.trim() && !onEdit) return null;
  const toggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    void setDescriptionCollapsed(next);
  };
  return (
    <View style={styles.box}>
      <Pressable onPress={toggle} style={styles.head} accessibilityLabel={collapsed ? 'Show the description' : 'Hide the description'}>
        <Text style={styles.headText}>{`Description ${collapsed ? '▾' : '▴'}`}</Text>
      </Pressable>
      {!collapsed && (text.trim() ? <MoveText text={text} style={styles.text} /> : <Text style={styles.empty}>No description yet.</Text>)}
      {!collapsed && onEdit && (
        <Pressable onPress={onEdit} style={styles.pencil} accessibilityLabel="Edit the description">
          <Svg width={20} height={20} viewBox="0 0 24 24">
            <Path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z" fill={colors.text} />
          </Svg>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { alignSelf: 'stretch', marginHorizontal: 12, borderRadius: 10, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.panel2, overflow: 'hidden' },
  head: { minHeight: touchTarget, justifyContent: 'center', paddingHorizontal: 14 },
  headText: { color: colors.text, fontSize: 14, fontWeight: '600' },
  empty: { color: colors.textDim, fontSize: 14, textAlign: 'center', paddingBottom: 12 },
  pencil: { alignSelf: 'flex-end', width: touchTarget, height: touchTarget, alignItems: 'center', justifyContent: 'center' },
  text: { color: colors.text, fontSize: 15, lineHeight: 22, textAlign: 'center', paddingHorizontal: 12, paddingBottom: 12 }
});
