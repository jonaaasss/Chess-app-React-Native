// A board's Description in Study and the link viewer, collapsible like the
// lines overview. Collapsing or opening it is remembered for every card.
import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { MoveText } from './MoveText';
import { colors, touchTarget } from '../theme';
import { getDescriptionCollapsed, getDescriptionCollapsedCached, setDescriptionCollapsed } from '../storage';

export function CollapsibleDescription({ text }: { text: string }) {
  const [collapsed, setCollapsed] = useState(() => getDescriptionCollapsedCached() ?? false);
  useEffect(() => {
    if (getDescriptionCollapsedCached() === null) getDescriptionCollapsed().then(setCollapsed);
  }, []);
  if (!text.trim()) return null;
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
      {!collapsed && <MoveText text={text} style={styles.text} />}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { alignSelf: 'stretch', marginHorizontal: 12, borderRadius: 10, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.panel2, overflow: 'hidden' },
  head: { minHeight: touchTarget, justifyContent: 'center', paddingHorizontal: 14 },
  headText: { color: colors.text, fontSize: 14, fontWeight: '600' },
  text: { color: colors.text, fontSize: 15, lineHeight: 22, textAlign: 'center', paddingHorizontal: 12, paddingBottom: 12 }
});
