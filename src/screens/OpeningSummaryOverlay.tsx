// The form behind an opening's optional Summary (Cards screen) — one big
// multi-line text field. Save with nothing in it removes the summary; Cancel
// (and the back button) leave it untouched, same rules as the arrow notes.
import React, { useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { confirmDialog, showOverlay, useOverlayBack } from '../overlay';
import { colors, type } from '../theme';

function OpeningSummaryOverlay({
  initial,
  close
}: {
  initial: string | undefined;
  close: (result: { summary: string | undefined } | null) => void;
}) {
  const [text, setText] = useState(initial ?? '');
  const clean = (t: string) => t.trim();

  async function handleCancel() {
    if (clean(text) !== clean(initial ?? '')) {
      const ok = await confirmDialog('Discard your changes?', { confirmLabel: 'Discard', cancelLabel: 'Keep editing' });
      if (!ok) return;
    }
    close(null);
  }
  useOverlayBack(handleCancel);

  return (
    <SafeAreaView style={styles.overlay}>
      <View style={styles.header}>
        <Pressable onPress={handleCancel} style={styles.headerCancel}>
          <Text style={styles.headerCancelText}>Cancel</Text>
        </Pressable>
        <Text style={styles.title}>Summary</Text>
        <Pressable onPress={() => close({ summary: clean(text) || undefined })} style={styles.headerSave}>
          <Text style={styles.headerSaveText}>Save</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.hint}>
          Shown first when you study this opening, blurred until you press Show. Moves like Nf3 or Bxc6 are picked out automatically.
        </Text>
        <TextInput
          style={styles.input}
          value={text}
          onChangeText={setText}
          multiline
          autoFocus={!initial}
          placeholder="Describe the opening in your own words…"
          placeholderTextColor={colors.textDim}
        />
      </ScrollView>
    </SafeAreaView>
  );
}

// Resolves to the new summary (`undefined` inside means "none — remove it"),
// or null when cancelled.
export function openOpeningSummaryDialog(initial: string | undefined): Promise<{ summary: string | undefined } | null> {
  return showOverlay<{ summary: string | undefined } | null>((close) => <OpeningSummaryOverlay initial={initial} close={close} />);
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.border
  },
  headerCancel: { minHeight: 48, minWidth: 64, justifyContent: 'center' },
  headerCancelText: { color: colors.textDim, ...type.body },
  title: { color: colors.text, ...type.h2 },
  headerSave: {
    minHeight: 48,
    minWidth: 84,
    paddingHorizontal: 22,
    borderRadius: 999,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center'
  },
  headerSaveText: { color: colors.onPrimary, ...type.bodyStrong },
  content: { padding: 16, paddingBottom: 48, gap: 12 },
  hint: { color: colors.textDim, fontSize: 12.5, lineHeight: 18 },
  input: {
    backgroundColor: colors.panel2,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    color: colors.text,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 15,
    lineHeight: 21,
    minHeight: 220,
    textAlignVertical: 'top'
  }
});
