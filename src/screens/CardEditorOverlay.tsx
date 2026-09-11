import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { deleteCard, getCard, saveCard } from '../storage';
import { confirmDialog, showOverlay } from '../overlay';
import type { Card, CardMode, Side } from '../types';
import { colors, type } from '../theme';
import { openMoveDuplicateDialog } from './MoveDuplicateOverlay';
import { BoardsGrid } from './BoardsGrid';

export interface CardEditorResult {
  changed: boolean;
  deleted: boolean;
}

function CardEditorOverlay({
  cardId,
  close
}: {
  cardId: string;
  close: (result: CardEditorResult) => void;
}) {
  const [card, setCard] = useState<Card | null>(null);
  const [side, setSide] = useState<Side>('front');
  const changedRef = useRef(false);

  useEffect(() => {
    (async () => {
      const original = await getCard(cardId);
      if (!original) {
        close({ changed: false, deleted: false });
        return;
      }
      setCard(JSON.parse(JSON.stringify(original)) as Card);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cardId]);

  if (!card) {
    return <SafeAreaView style={styles.overlay} />;
  }

  const face = card[side];

  function patchText(text: string) {
    setCard((prev) => (prev ? { ...prev, [side]: { ...prev[side], text } } : prev));
  }

  async function handleSave() {
    if (!card) return;
    await saveCard(card);
    close({ changed: true, deleted: false });
  }

  function handleCancel() {
    close({ changed: changedRef.current, deleted: false });
  }

  // Both modes share `card.boards`; only the editor each board opens and
  // whether `recording` is used differ. Switching to Others discards the
  // recorded lines (with a warning) but keeps every board's position,
  // arrows and circles.
  async function handleSetMode(next: CardMode) {
    if (!card || next === card.mode) return;
    if (next === 'others') {
      const hasRecording = card.boards.some((b) => b.recording.length > 0);
      if (hasRecording) {
        const ok = await confirmDialog(
          "Switching to Others deletes all recorded moves/notation on this card's boards. Each board's position, arrows, and circles are kept. Continue?"
        );
        if (!ok) return;
      }
      setCard((prev) =>
        prev ? { ...prev, mode: 'others', boards: prev.boards.map((b) => ({ ...b, recording: [] })) } : prev
      );
      return;
    }
    setCard((prev) => (prev ? { ...prev, mode: next } : prev));
  }

  async function handleMoveDuplicate() {
    if (!card) return;
    await saveCard(card);
    const result = await openMoveDuplicateDialog(card);
    if (result === 'moved') {
      close({ changed: true, deleted: false });
    } else if (result === 'duplicated') {
      changedRef.current = true;
    }
  }

  async function handleDelete() {
    if (!card) return;
    const ok = await confirmDialog('Delete this card? This cannot be undone.');
    if (ok) {
      await deleteCard(card.id);
      close({ changed: true, deleted: true });
    }
  }

  return (
    <SafeAreaView style={styles.overlay}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.topBar}>
          <Pressable onPress={handleCancel}>
            <Text style={styles.topBarBtn}>Cancel</Text>
          </Pressable>
          <Text style={styles.title}>Edit card</Text>
          <Pressable onPress={handleSave}>
            <Text style={[styles.topBarBtn, styles.saveBtn]}>Save</Text>
          </Pressable>
        </View>

        <View style={styles.tabs}>
          {(['front', 'back'] as Side[]).map((s) => (
            <Pressable
              key={s}
              onPress={() => setSide(s)}
              style={[styles.tabBtn, side === s && styles.tabBtnActive]}
            >
              <Text style={[styles.tabText, side === s && styles.tabTextActive]}>
                {s === 'front' ? 'Front' : 'Back'}
              </Text>
            </Pressable>
          ))}
        </View>

        <Text style={styles.fieldLabel}>Text</Text>
        <TextInput
          style={styles.textArea}
          value={face.text}
          onChangeText={patchText}
          multiline
          placeholder="Type the card text..."
          placeholderTextColor={colors.textDim}
        />

        <View style={styles.modeHeaderRow}>
          <Text style={[styles.fieldLabel, { marginTop: 0, marginBottom: 0 }]}>Boards</Text>
          <View style={styles.modeToggle}>
            <Pressable
              onPress={() => handleSetMode('reactions')}
              style={[styles.modeBtn, card.mode === 'reactions' && styles.modeBtnActive]}
            >
              <Text style={[styles.modeBtnText, card.mode === 'reactions' && styles.modeBtnTextActive]}>Reactions</Text>
            </Pressable>
            <Pressable onPress={() => handleSetMode('others')} style={[styles.modeBtn, card.mode === 'others' && styles.modeBtnActive]}>
              <Text style={[styles.modeBtnText, card.mode === 'others' && styles.modeBtnTextActive]}>Others</Text>
            </Pressable>
          </View>
        </View>

        <BoardsGrid
          mode={card.mode}
          boards={card.boards}
          onChange={(boards) => setCard((prev) => (prev ? { ...prev, boards } : prev))}
        />

        <Pressable onPress={handleMoveDuplicate} style={[styles.blockBtn, styles.secondaryBtn]}>
          <Text style={[styles.blockBtnText, styles.secondaryBtnText]}>Move / duplicate card</Text>
        </Pressable>
        <Pressable onPress={handleDelete} style={[styles.blockBtn, styles.dangerBtn]}>
          <Text style={styles.blockBtnText}>Delete card</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

export function openCardEditor(cardId: string): Promise<CardEditorResult> {
  return showOverlay<CardEditorResult>((close) => <CardEditorOverlay cardId={cardId} close={close} />);
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, paddingBottom: 32 },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  topBarBtn: { color: colors.textDim, ...type.body },
  saveBtn: { color: colors.accentHover, ...type.bodyStrong },
  title: { color: colors.text, ...type.h2 },
  tabs: {
    flexDirection: 'row',
    gap: 24,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    marginBottom: 16
  },
  tabBtn: { paddingVertical: 10, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabBtnActive: { borderBottomColor: colors.accent },
  tabText: { color: colors.textDim, ...type.bodyStrong },
  tabTextActive: { color: colors.text },
  fieldLabel: { color: colors.textDim, fontSize: 12.5, marginBottom: 6, marginTop: 14 },
  textArea: {
    backgroundColor: colors.panel2,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    color: colors.text,
    padding: 12,
    fontSize: 15,
    minHeight: 110,
    textAlignVertical: 'top'
  },
  modeHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 14, marginBottom: 6 },
  modeToggle: { flexDirection: 'row', backgroundColor: colors.panel2, borderRadius: 8, padding: 2, borderWidth: 1, borderColor: colors.border },
  modeBtn: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 6 },
  modeBtnActive: { backgroundColor: colors.accent },
  modeBtnText: { color: colors.textDim, fontSize: 13, fontWeight: '600' },
  modeBtnTextActive: { color: colors.onPrimary },
  blockBtn: { width: '100%', borderRadius: 10, paddingVertical: 13, alignItems: 'center', marginTop: 12 },
  secondaryBtn: { backgroundColor: colors.panel2, borderWidth: 1, borderColor: colors.border },
  secondaryBtnText: { color: colors.text },
  dangerBtn: { backgroundColor: colors.danger },
  blockBtnText: { color: 'white', fontSize: 15, fontWeight: '600' }
});
