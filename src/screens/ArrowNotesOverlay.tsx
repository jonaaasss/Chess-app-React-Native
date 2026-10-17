// The form behind a Plan arrow's "+"/note badge — a few optional, labelled
// fields instead of one free-text box (see types.ts's ArrowNotes). Save with
// everything empty removes the note; Cancel (and the back button) leave it
// untouched, same rules the old single text dialog had.
import React, { useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { cleanArrowNotes } from '../arrowNotes';
import { confirmDialog, showOverlay, useOverlayBack, CloseCircleButton } from '../overlay';
import { colors, radius, touchTarget, type } from '../theme';
import type { ArrowNotes, ArrowResponse } from '../types';

function ArrowNotesOverlay({
  initial,
  close
}: {
  initial: ArrowNotes | undefined;
  close: (result: { notes: ArrowNotes | undefined } | null) => void;
}) {
  const [reason, setReason] = useState(initial?.reason ?? '');
  const [next, setNext] = useState(initial?.next ?? '');
  const [responses, setResponses] = useState<ArrowResponse[]>(initial?.responses ?? []);

  const current = () => cleanArrowNotes({ reason, next, responses });
  const initialCleaned = JSON.stringify(cleanArrowNotes(initial) ?? null);

  async function handleCancel() {
    if (JSON.stringify(current() ?? null) !== initialCleaned) {
      const ok = await confirmDialog('Discard your changes?', { confirmLabel: 'Discard', cancelLabel: 'Keep editing' });
      if (!ok) return;
    }
    close(null);
  }
  useOverlayBack(handleCancel);

  function updateResponse(i: number, patch: Partial<ArrowResponse>) {
    setResponses((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }

  return (
    <SafeAreaView style={styles.overlay}>
      <View style={styles.header}>
        <Pressable onPress={handleCancel} style={styles.headerCancel}>
          <Text style={styles.headerCancelText}>Cancel</Text>
        </Pressable>
        <Text style={styles.title}>Notes</Text>
        <Pressable onPress={() => close({ notes: current() })} style={styles.headerSave}>
          <Text style={styles.headerSaveText}>Save</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.label}>Reason</Text>
        <TextInput
          style={styles.input}
          value={reason}
          onChangeText={setReason}
          multiline
          placeholder="Why this move? Why not another? When not to play it?"
          placeholderTextColor={colors.textDim}
        />

        <Text style={styles.label}>Follow-up plan</Text>
        <TextInput
          style={styles.input}
          value={next}
          onChangeText={setNext}
          multiline
          placeholder="What's the follow-up plan?"
          placeholderTextColor={colors.textDim}
        />

        <Text style={styles.label}>If…</Text>
        {responses.map((r, i) => (
          <View key={i} style={styles.responseCard}>
            <View style={styles.responseTop}>
              <TextInput
                style={[styles.input, styles.triggerInput]}
                value={r.trigger}
                onChangeText={(trigger) => updateResponse(i, { trigger })}
                placeholder="Nf6, or a condition, e.g. bishop sees h3"
                placeholderTextColor={colors.textDim}
                autoCapitalize="none"
              />
              <CloseCircleButton onPress={() => setResponses((prev) => prev.filter((_, idx) => idx !== i))} />
            </View>
            <TextInput
              style={styles.input}
              value={r.text}
              onChangeText={(text) => updateResponse(i, { text })}
              multiline
              placeholder="What do you do?"
              placeholderTextColor={colors.textDim}
            />
            <View style={styles.kindToggle}>
              {(['reaction', 'exception'] as const).map((kind) => (
                <Pressable
                  key={kind}
                  onPress={() => updateResponse(i, { kind })}
                  style={[styles.kindBtn, r.kind === kind && styles.kindBtnActive]}
                >
                  <Text style={[styles.kindBtnText, r.kind === kind && styles.kindBtnTextActive]}>
                    {kind === 'reaction' ? 'After this move' : 'Instead of this move'}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
        ))}
        <Pressable
          onPress={() => setResponses((prev) => [...prev, { trigger: '', text: '', kind: 'reaction' }])}
          style={styles.addBtn}
        >
          <Text style={styles.addBtnText}>+ Add</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

// Resolves to the new notes (`undefined` inside means "none — remove it"),
// or null when cancelled.
export function openArrowNotesDialog(initial: ArrowNotes | undefined): Promise<{ notes: ArrowNotes | undefined } | null> {
  return showOverlay<{ notes: ArrowNotes | undefined } | null>((close) => <ArrowNotesOverlay initial={initial} close={close} />);
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
  content: { padding: 16, paddingBottom: 48, gap: 8 },
  label: { color: colors.textDim, fontSize: 12.5, marginTop: 10 },
  input: {
    backgroundColor: colors.panel2,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    color: colors.text,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    minHeight: 44,
    maxHeight: 140,
    textAlignVertical: 'top'
  },
  responseCard: {
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: 12,
    gap: 10
  },
  responseTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  triggerInput: { flex: 1 },
  kindToggle: { flexDirection: 'row', gap: 8 },
  kindBtn: {
    flex: 1,
    minHeight: touchTarget,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.panel2,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8
  },
  kindBtnActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  kindBtnText: { color: colors.textDim, fontSize: 12.5, fontWeight: '600', textAlign: 'center' },
  kindBtnTextActive: { color: colors.onPrimary },
  addBtn: {
    alignSelf: 'flex-start',
    minHeight: touchTarget,
    justifyContent: 'center',
    paddingHorizontal: 16,
    borderRadius: radius.md,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.border
  },
  addBtnText: { color: colors.textDim, fontSize: 14 }
});
