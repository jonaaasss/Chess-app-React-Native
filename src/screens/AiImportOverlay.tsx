// "Import PGN with AI" (behind Add opening): paste a PGN, an AI model turns it
// into cards, and the same checker as the manual import verifies every move
// before anything can be created. Nothing is saved here; the screen only
// returns the checked result. The API key is typed in once and kept on this
// phone (testing only, see aiImport.ts).
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, StyleSheet, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { confirmDialog, promptDialog, showOverlay, useOverlayBack } from '../overlay';
import { generateImportFromPgn, getGeminiKey, setGeminiKey, MAX_PGN_CHARS, type AiSide } from '../aiImport';
import type { ImportPgnResult } from './ImportPgnOverlay';
import { colors, type } from '../theme';

async function askForKey(): Promise<string | null> {
  const k = await promptDialog('Gemini API key', '', 'Paste your key');
  if (k && k.trim()) {
    await setGeminiKey(k);
    return k.trim();
  }
  return null;
}

function AiImportOverlay({ side, close }: { side: AiSide; close: (result: ImportPgnResult | null) => void }) {
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [keySet, setKeySet] = useState<boolean | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    getGeminiKey().then((k) => setKeySet(k !== null));
  }, []);

  async function handleCancel() {
    if (busy) {
      abortRef.current?.abort();
      close(null);
      return;
    }
    if (text.trim()) {
      const ok = await confirmDialog('Discard the pasted PGN?', { confirmLabel: 'Discard', cancelLabel: 'Keep editing' });
      if (!ok) return;
    }
    close(null);
  }
  useOverlayBack(handleCancel);

  async function handleChangeKey() {
    if (busy) return;
    const k = await askForKey();
    if (k) setKeySet(true);
  }

  async function handleGenerate() {
    if (busy) return;
    const pgn = text.trim();
    if (!pgn) {
      setError('Paste a PGN first.');
      return;
    }
    if (pgn.length > MAX_PGN_CHARS) {
      setError(`This PGN is too long (${pgn.length} characters). The limit is ${MAX_PGN_CHARS}. Import it in parts.`);
      return;
    }
    let key = await getGeminiKey();
    if (!key) {
      key = await askForKey();
      if (!key) return;
      setKeySet(true);
    }
    const controller = new AbortController();
    abortRef.current = controller;
    setError(null);
    setStatus('Asking the AI…');
    setBusy(true);
    const result = await generateImportFromPgn(pgn, side, key, setStatus, controller.signal);
    abortRef.current = null;
    if (controller.signal.aborted) return; // cancelled: the screen is already closing
    setBusy(false);
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
        <Text style={styles.title}>Import with AI</Text>
        <Pressable onPress={handleGenerate} disabled={busy} style={[styles.headerSave, busy && { opacity: 0.4 }]}>
          <Text style={styles.headerSaveText}>Generate</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.hint}>
          Paste a PGN (variations are fine, arrows are not needed). The AI makes the cards for {side}; every move is checked before anything is created.
        </Text>
        <TextInput
          style={styles.input}
          value={text}
          onChangeText={(t) => {
            setText(t);
            if (error) setError(null);
          }}
          editable={!busy}
          multiline
          autoFocus
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="Paste the PGN here…"
          placeholderTextColor={colors.textDim}
        />
        {busy ? (
          <View style={styles.statusRow}>
            <ActivityIndicator size="small" color={colors.textDim} />
            <Text style={styles.status}>{status} This can take up to a minute.</Text>
          </View>
        ) : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <View style={styles.keyRow}>
          <Text style={styles.hint}>{keySet === null ? '' : keySet ? 'API key saved on this phone.' : 'No API key yet.'}</Text>
          <Pressable onPress={handleChangeKey} disabled={busy} style={styles.keyButton}>
            <Text style={styles.keyButtonText}>API key</Text>
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

// Resolves to the checked import (nothing has been created yet), or null when cancelled.
export function openAiImportDialog(side: AiSide): Promise<ImportPgnResult | null> {
  return showOverlay<ImportPgnResult | null>((close) => <AiImportOverlay side={side} close={close} />);
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
  hint: { color: colors.textDim, fontSize: 12.5, lineHeight: 18, flexShrink: 1 },
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
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  status: { color: colors.textDim, fontSize: 14, lineHeight: 20, flexShrink: 1 },
  error: { color: colors.dangerText, fontSize: 14, lineHeight: 20 },
  keyRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  keyButton: { minHeight: 44, paddingHorizontal: 14, justifyContent: 'center' },
  keyButtonText: { color: colors.primary, ...type.bodyStrong }
});
