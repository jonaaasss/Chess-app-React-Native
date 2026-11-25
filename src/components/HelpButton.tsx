// The (i) button next to a screen's title, and the help window it opens: one
// or more topics (helpContent.ts), with a "Simple" / "Technical" switch at
// the top. The choice is remembered for every help window.
import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { showOverlay, useOverlayBack } from '../overlay';
import { colors, radius, touchTarget } from '../theme';
import { InfoIcon } from './InfoIcon';
import type { HelpTopic } from '../helpContent';

type Level = 'simple' | 'technical';
const LEVEL_KEY = 'help.level';
const LEVELS: { level: Level; label: string }[] = [
  { level: 'simple', label: 'Simple' },
  { level: 'technical', label: 'Technical' }
];

function HelpWindow({ topics, close }: { topics: HelpTopic[]; close: () => void }) {
  const [level, setLevel] = useState<Level>('simple');
  useOverlayBack(close);

  useEffect(() => {
    AsyncStorage.getItem(LEVEL_KEY)
      .then((v) => {
        if (v === 'technical') setLevel('technical');
      })
      .catch(() => undefined);
  }, []);

  function choose(l: Level) {
    setLevel(l);
    AsyncStorage.setItem(LEVEL_KEY, l).catch(() => undefined);
  }

  return (
    <View style={styles.backdrop}>
      <View style={styles.box}>
        <View style={styles.switch} accessibilityRole="radiogroup">
          {LEVELS.map(({ level: l, label }) => (
            <Pressable
              key={l}
              onPress={() => choose(l)}
              style={[styles.switchBtn, level === l && styles.switchBtnOn]}
              accessibilityRole="radio"
              accessibilityState={{ selected: level === l }}
            >
              <Text style={[styles.switchText, level === l && styles.switchTextOn]}>{label}</Text>
            </Pressable>
          ))}
        </View>
        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
          {topics.map((t) => (
            <View key={t.title} style={styles.topic}>
              <Text style={styles.title}>{t.title}</Text>
              {level === 'simple' ? (
                <Text style={styles.body}>{t.simple}</Text>
              ) : (
                t.technical.map((line) => (
                  <View key={line} style={styles.item}>
                    <View style={styles.dot} />
                    <Text style={[styles.body, styles.itemText]}>{line}</Text>
                  </View>
                ))
              )}
            </View>
          ))}
        </ScrollView>
        <Pressable onPress={close} style={styles.closeBtn}>
          <Text style={styles.closeText}>Close</Text>
        </Pressable>
      </View>
    </View>
  );
}

export function openHelp(topics: HelpTopic[]): Promise<void> {
  return showOverlay<void>((close) => <HelpWindow topics={topics} close={() => close()} />);
}

export function HelpButton({ topics, color = colors.textDim }: { topics: HelpTopic[]; color?: string }) {
  return (
    <Pressable onPress={() => openHelp(topics)} style={styles.button} accessibilityRole="button" accessibilityLabel="How this works">
      <InfoIcon size={20} color={color} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: { width: touchTarget, height: touchTarget, alignItems: 'center', justifyContent: 'center' },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', padding: 20 },
  box: { maxHeight: '90%', backgroundColor: colors.surface, borderRadius: radius.lg, padding: 16, borderWidth: 1, borderColor: colors.border, gap: 12 },
  switch: { flexDirection: 'row', gap: 6 },
  switchBtn: { flex: 1, minHeight: touchTarget, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  switchBtnOn: { backgroundColor: '#E2E8F0', borderColor: '#E2E8F0' },
  switchText: { color: colors.textDim, fontSize: 14, fontWeight: '600' },
  switchTextOn: { color: colors.bg, fontWeight: '700' },
  scroll: { flexShrink: 1 },
  scrollContent: { gap: 16 },
  topic: { gap: 6 },
  title: { color: colors.text, fontSize: 16, fontWeight: '700' },
  body: { color: colors.textSecondary, fontSize: 14, lineHeight: 20 },
  item: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  dot: { width: 5, height: 5, borderRadius: 3, backgroundColor: colors.textDim, marginTop: 8 },
  itemText: { flex: 1 },
  closeBtn: { minHeight: touchTarget, borderRadius: radius.pill, backgroundColor: colors.panel2, alignItems: 'center', justifyContent: 'center' },
  closeText: { color: colors.text, fontSize: 15, fontWeight: '600' }
});
