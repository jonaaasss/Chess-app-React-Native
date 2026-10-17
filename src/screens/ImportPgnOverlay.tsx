// The "Import PGN" screen behind Add opening: one big field to paste the
// import text into (for now written by Claude from a PGN — later a language
// model inside the app will do that step). "Import" checks the text with
// `parseOpeningImport` and only closes with a result when every move and
// arrow is valid; otherwise the problem is shown right under the field and
// nothing is created. Cancel (and the back button) ask before throwing away text.
import React, { useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { confirmDialog, showOverlay, useOverlayBack } from '../overlay';
import { parseOpeningImport, type ParsedImport } from '../importOpening';
import { colors, type } from '../theme';

export interface ImportPgnResult {
  value: ParsedImport;
  boardCount: number;
}

function ImportPgnOverlay({ close }: { close: (result: ImportPgnResult | null) => void }) {
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function handleCancel() {
    if (text.trim()) {
      const ok = await confirmDialog('Discard the pasted text?', { confirmLabel: 'Discard', cancelLabel: 'Keep editing' });
      if (!ok) return;
    }
    close(null);
  }
  useOverlayBack(handleCancel);

  function handleImport() {
    const result = parseOpeningImport(text);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    close({ value: result.value, boardCount: result.boardCount });
  }

  return (
    <SafeAreaView style={styles.overlay}>
      <View style={styles.header}>
        <Pressable onPress={handleCancel} style={styles.headerCancel}>
          <Text style={styles.headerCancelText}>Cancel</Text>
        </Pressable>
        <Text style={styles.title}>Import PGN</Text>
        <Pressable onPress={handleImport} style={styles.headerSave}>
          <Text style={styles.headerSaveText}>Import</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.hint}>Paste the import text here. All the cards are created at once, and every move is checked first.</Text>
        <TextInput
          style={styles.input}
          value={text}
          onChangeText={(t) => {
            setText(t);
            if (error) setError(null);
          }}
          multiline
          autoFocus
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="Paste here…"
          placeholderTextColor={colors.textDim}
        />
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

// Resolves to the checked import (nothing has been created yet), or null when cancelled.
export function openImportPgnDialog(): Promise<ImportPgnResult | null> {
  return showOverlay<ImportPgnResult | null>((close) => <ImportPgnOverlay close={close} />);
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
    minHeight: 280,
    textAlignVertical: 'top'
  },
  error: { color: colors.dangerText, fontSize: 14, lineHeight: 20 }
});
