// Temporary developer aid — see storage.ts's `getDevExportEnabled`. Lets you
// pick a repertoire and shows its content as plain, selectable text so it
// can be long-pressed and copied out of the app.
import React, { useEffect, useState } from 'react';
import { ScrollView, Text, View, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { buildRepertoireExportText } from '../devExport';
import { getRepertoires } from '../storage';
import { showOverlay, simpleMenu, useOverlayBack } from '../overlay';
import { BackCircleButton } from '../components/Common';
import type { GroupId } from '../types';
import { colors, radius, type } from '../theme';

function DevExportOverlay({ close }: { close: () => void }) {
  const [text, setText] = useState<string | null>(null);
  useOverlayBack(close);

  useEffect(() => {
    (async () => {
      const group = (await simpleMenu(['White', 'Black'])) as 'White' | 'Black' | null;
      if (!group) {
        close();
        return;
      }
      const groupId: GroupId = group === 'White' ? 'white' : 'black';
      const repertoires = await getRepertoires(groupId);
      const name = await simpleMenu(repertoires.map((r) => r.name));
      const rep = repertoires.find((r) => r.name === name);
      if (!rep) {
        close();
        return;
      }
      setText(await buildRepertoireExportText(rep.id));
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <SafeAreaView style={styles.overlay}>
      <View style={styles.topBar}>
        <BackCircleButton onPress={close} />
        <Text style={styles.title}>Export repertoire</Text>
      </View>
      {text === null ? null : (
        <>
          <Text style={styles.hint}>Long-press the text below, then Select All and Copy.</Text>
          <ScrollView style={styles.textBox}>
            <Text selectable style={styles.text}>
              {text}
            </Text>
          </ScrollView>
        </>
      )}
    </SafeAreaView>
  );
}

export function openDevExportDialog(): Promise<void> {
  return showOverlay<void>((close) => <DevExportOverlay close={close} />);
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: colors.bg, padding: 16 },
  topBar: { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 14 },
  title: { color: colors.text, ...type.h1 },
  hint: { color: colors.textDim, ...type.caption, marginBottom: 10 },
  textBox: {
    flex: 1,
    backgroundColor: colors.panel,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 12
  },
  text: { color: colors.text, fontSize: 13, fontFamily: 'monospace', lineHeight: 19 }
});
