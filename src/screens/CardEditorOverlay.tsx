import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { cloneBoardState, newBoardState } from '../chess';
import { deleteCard, getCard, saveCard } from '../storage';
import { confirmDialog, showOverlay } from '../overlay';
import type { Card, Side } from '../types';
import { colors } from '../theme';
import { ChessBoardView } from '../components/ChessBoard';
import { openBoardEditorFullscreen } from './BoardEditorOverlay';
import { openMoveDuplicateDialog } from './MoveDuplicateOverlay';

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

  function patchFace(patch: Partial<Card['front']>, syncToBack: boolean) {
    setCard((prev) => {
      if (!prev) return prev;
      const next: Card = { ...prev, [side]: { ...prev[side], ...patch } };
      if (side === 'front' && syncToBack && patch.board !== undefined) {
        next.back = { ...next.back, board: patch.board ? cloneBoardState(patch.board) : next.back.board };
      }
      return next;
    });
  }

  async function handleSave() {
    if (!card) return;
    await saveCard(card);
    close({ changed: true, deleted: false });
  }

  function handleCancel() {
    close({ changed: changedRef.current, deleted: false });
  }

  function handleAddBoard() {
    const fresh = newBoardState(0);
    patchFace({ board: fresh }, true);
  }

  function handleResetBoard() {
    if (!face.board) return;
    const fresh = newBoardState(face.board.style);
    patchFace({ board: fresh }, true);
  }

  function handleRemoveBoard() {
    patchFace({ board: null }, false);
  }

  async function handleEditBoard() {
    if (!face.board) return;
    const updated = await openBoardEditorFullscreen(face.board);
    if (!updated) return;
    patchFace({ board: updated }, true);
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
          onChangeText={(t) => patchFace({ text: t }, false)}
          multiline
          placeholder="Type the card text..."
          placeholderTextColor={colors.textDim}
        />

        <Text style={styles.fieldLabel}>Board (optional)</Text>
        {!face.board ? (
          <Pressable onPress={handleAddBoard} style={styles.addBoardBtn}>
            <Text style={styles.addBoardText}>+ Add board</Text>
          </Pressable>
        ) : (
          <View>
            <View style={styles.boardIconRow}>
              <Pressable onPress={handleAddBoard} style={styles.iconBtn}>
                <Text style={styles.iconBtnText}>+</Text>
              </Pressable>
              <Pressable onPress={handleResetBoard} style={styles.iconBtn}>
                <Text style={styles.iconBtnText}>↻</Text>
              </Pressable>
              <Pressable onPress={handleRemoveBoard} style={styles.iconBtn}>
                <Text style={styles.iconBtnText}>✖</Text>
              </Pressable>
            </View>
            <Pressable onPress={handleEditBoard} style={{ alignSelf: 'center' }}>
              <ChessBoardView board={face.board} size={280} />
            </Pressable>
            {side === 'front' && (
              <Text style={styles.hint}>Editing this board also resets the back board to match.</Text>
            )}
          </View>
        )}

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
  topBarBtn: { color: colors.textDim, fontSize: 15 },
  saveBtn: { color: colors.accentHover, fontWeight: '600' },
  title: { color: colors.text, fontWeight: '600', fontSize: 15 },
  tabs: {
    flexDirection: 'row',
    gap: 24,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    marginBottom: 16
  },
  tabBtn: { paddingVertical: 10, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabBtnActive: { borderBottomColor: colors.accent },
  tabText: { color: colors.textDim, fontWeight: '600', fontSize: 15 },
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
  addBoardBtn: {
    backgroundColor: colors.panel2,
    borderWidth: 1,
    borderColor: colors.border,
    borderStyle: 'dashed',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 14,
    alignSelf: 'flex-start'
  },
  addBoardText: { color: colors.textDim, fontSize: 14 },
  boardIconRow: { flexDirection: 'row', gap: 16, marginBottom: 10 },
  iconBtn: { padding: 6 },
  iconBtnText: { color: colors.textDim, fontSize: 20 },
  hint: { color: colors.textDim, fontSize: 12, marginTop: 8, textAlign: 'center' },
  blockBtn: { width: '100%', borderRadius: 10, paddingVertical: 13, alignItems: 'center', marginTop: 12 },
  secondaryBtn: { backgroundColor: colors.panel2, borderWidth: 1, borderColor: colors.border },
  secondaryBtnText: { color: colors.text },
  dangerBtn: { backgroundColor: colors.danger },
  blockBtnText: { color: 'white', fontSize: 15, fontWeight: '600' }
});
