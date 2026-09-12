import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { deleteCard, getBoardStyle, getCard, getOpening, getRepertoire, saveCard } from '../storage';
import { confirmDialog, showOverlay } from '../overlay';
import type { BoardFace, Card, CardMode, ReactionBoard } from '../types';
import { colors, type } from '../theme';
import { openMoveDuplicateDialog } from './MoveDuplicateOverlay';
import { BoardsGrid } from './BoardsGrid';

export interface CardEditorResult {
  changed: boolean;
  deleted: boolean;
}

// Which face holds "the" single description for a mode that isn't Others
// (Others keeps two independent ones): Reactions shows it throughout
// Study, Plan alongside the plan — both live on the board editor's single
// Description field, just backed by a different face internally.
function descriptionFace(mode: CardMode): 'front' | 'back' {
  return mode === 'plan' ? 'back' : 'front';
}

// Reconciles a board's data when the card's mode changes:
//  - Reactions → Others/Plan: both faces' positions/annotations start out
//    identical to the Reactions board's pre-Play position — their own text
//    (and, for Plan, the shared-position sync below) is left untouched.
//  - Others/Plan → Reactions: the front becomes the new (only) position;
//    the back's independent position is dropped since Reactions has none,
//    but front/back keep their own text either way (spread through as-is).
//  - Others → Plan: Plan's shared-position rule kicks in immediately —
//    the back's position AND move history are synced to match the front's
//    (its arrows and circles are left alone).
// Any recording is always cleared — none of Others/Plan/the other side of
// a mode switch can make sense of a Reactions move tree. Whichever mode is
// switched TO, if its single description face (see above) is empty but the
// other face already has text, that text is carried over rather than left
// stranded somewhere the new mode never shows it.
function migrateBoardForMode(board: ReactionBoard, fromMode: CardMode, toMode: CardMode): ReactionBoard {
  const fromReactions = fromMode === 'reactions';
  const toReactions = toMode === 'reactions';

  let next: ReactionBoard;

  if (fromReactions && !toReactions) {
    const position = {
      pieces: { ...board.pieces },
      castling: { ...board.castling },
      turn: board.turn,
      enPassant: board.enPassant,
      arrows: board.arrows.map((a) => ({ ...a })),
      circles: board.circles.map((c) => ({ ...c })),
      moves: [] as BoardFace['moves']
    };
    next = {
      ...board,
      recording: [],
      front: { ...board.front, ...position, arrows: [...position.arrows], circles: [...position.circles] },
      back: { ...board.back, ...position, arrows: [...position.arrows], circles: [...position.circles] }
    };
  } else if (!fromReactions && toReactions) {
    next = {
      ...board,
      pieces: { ...board.front.pieces },
      turn: board.front.turn,
      castling: { ...board.front.castling },
      enPassant: board.front.enPassant,
      arrows: board.front.arrows.map((a) => ({ ...a })),
      circles: board.front.circles.map((c) => ({ ...c })),
      recording: []
    };
  } else if (!fromReactions && !toReactions && toMode === 'plan') {
    next = {
      ...board,
      recording: [],
      back: {
        ...board.back,
        pieces: { ...board.front.pieces },
        turn: board.front.turn,
        castling: { ...board.front.castling },
        enPassant: board.front.enPassant,
        moves: board.front.moves.map((m) => ({ ...m, piecesAfter: { ...m.piecesAfter }, castlingAfter: { ...m.castlingAfter } }))
      }
    };
  } else {
    next = { ...board, recording: [] };
  }

  if (toMode !== 'others') {
    const face = descriptionFace(toMode);
    const other = face === 'front' ? 'back' : 'front';
    if (!next[face].text && next[other].text) {
      next = { ...next, [face]: { ...next[face], text: next[other].text } };
    }
  }

  return next;
}

function CardEditorOverlay({
  cardId,
  close
}: {
  cardId: string;
  close: (result: CardEditorResult) => void;
}) {
  const [card, setCard] = useState<Card | null>(null);
  // Which color this card's repertoire plays — drives both the board
  // orientation and which side's moves get highlighted in the editor.
  const [yourColor, setYourColor] = useState<'w' | 'b'>('w');
  // Board style is a single global setting now (Settings screen) — fetched
  // once here and threaded down to every board preview/editor.
  const [boardStyle, setBoardStyle] = useState(0);
  const changedRef = useRef(false);

  useEffect(() => {
    (async () => {
      const original = await getCard(cardId);
      if (!original) {
        close({ changed: false, deleted: false });
        return;
      }
      setCard(JSON.parse(JSON.stringify(original)) as Card);
      const opening = await getOpening(original.openingId);
      const rep = opening ? await getRepertoire(opening.repertoireId) : undefined;
      setYourColor(rep?.group === 'black' ? 'b' : 'w');
      setBoardStyle(await getBoardStyle());
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cardId]);

  if (!card) {
    return <SafeAreaView style={styles.overlay} />;
  }

  async function handleSave() {
    if (!card) return;
    await saveCard(card);
    close({ changed: true, deleted: false });
  }

  function handleCancel() {
    close({ changed: changedRef.current, deleted: false });
  }

  // All three modes share `card.boards`; migrateBoardForMode reconciles the
  // Reactions-only fields against the Others/Plan front/back split.
  async function handleSetMode(next: CardMode) {
    if (!card || next === card.mode) return;
    const hasRecording = card.mode === 'reactions' && next !== 'reactions' && card.boards.some((b) => b.recording.length > 0);
    if (hasRecording) {
      const modeName = next === 'others' ? 'Others' : 'Plan';
      const ok = await confirmDialog(
        `Switching to ${modeName} deletes all recorded moves/notation on this card's boards. Each board's position, arrows, and circles are kept as its front and back. Continue?`
      );
      if (!ok) return;
    }
    setCard((prev) =>
      prev ? { ...prev, mode: next, boards: prev.boards.map((b) => migrateBoardForMode(b, prev.mode, next)) } : prev
    );
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

        <View style={styles.modeHeaderRow}>
          <Text style={[styles.fieldLabel, { marginTop: 0, marginBottom: 0 }]}>Boards</Text>
          <View style={styles.modeToggle}>
            <Pressable
              onPress={() => handleSetMode('reactions')}
              style={[styles.modeBtn, card.mode === 'reactions' && styles.modeBtnActive]}
            >
              <Text style={[styles.modeBtnText, card.mode === 'reactions' && styles.modeBtnTextActive]}>Reactions</Text>
            </Pressable>
            <Pressable onPress={() => handleSetMode('plan')} style={[styles.modeBtn, card.mode === 'plan' && styles.modeBtnActive]}>
              <Text style={[styles.modeBtnText, card.mode === 'plan' && styles.modeBtnTextActive]}>Plan</Text>
            </Pressable>
            <Pressable onPress={() => handleSetMode('others')} style={[styles.modeBtn, card.mode === 'others' && styles.modeBtnActive]}>
              <Text style={[styles.modeBtnText, card.mode === 'others' && styles.modeBtnTextActive]}>Others</Text>
            </Pressable>
          </View>
        </View>

        <BoardsGrid
          mode={card.mode}
          boards={card.boards}
          yourColor={yourColor}
          boardStyle={boardStyle}
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
  fieldLabel: { color: colors.textDim, fontSize: 12.5, marginBottom: 6, marginTop: 14 },
  modeHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 0, marginBottom: 6 },
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
