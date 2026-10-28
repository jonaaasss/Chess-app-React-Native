import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView, Switch } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { addCard, deleteCard, getBoardStyle, getCard, getOpening, getRepertoire, saveCard } from '../storage';
import { descriptionFace, faceAnnotations } from '../chess';
import { confirmDialog, showOverlay, SnackbarLayer, useOverlayBack } from '../overlay';
import type { BoardFace, Card, CardMode, OpeningStartPosition, ReactionBoard } from '../types';
import { colors, type } from '../theme';
import { MoveText } from '../components/MoveText';
import { openMoveDuplicateDialog } from './MoveDuplicateOverlay';
import { BoardsGrid } from './BoardsGrid';
import { TutorialLayer, useTutorial, useTutorialTarget } from '../tutorial';

export interface CardEditorResult {
  changed: boolean;
  deleted: boolean;
  // Set when the card was deleted, so whoever opened the editor can offer Undo.
  deletedCard?: Card;
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
    // The front's *current* (final) position's annotations — not position
    // 0's — since that's what was actually visible on the board being
    // converted (see chess.ts's faceAnnotations).
    const finalAnnotations = faceAnnotations(board.front);
    next = {
      ...board,
      pieces: { ...board.front.pieces },
      turn: board.front.turn,
      castling: { ...board.front.castling },
      enPassant: board.front.enPassant,
      arrows: finalAnnotations.arrows.map((a) => ({ ...a })),
      circles: finalAnnotations.circles.map((c) => ({ ...c })),
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
        moves: board.front.moves.map((m) => ({
          ...m,
          piecesAfter: { ...m.piecesAfter },
          castlingAfter: { ...m.castlingAfter },
          arrowsAfter: m.arrowsAfter.map((a) => ({ ...a })),
          circlesAfter: m.circlesAfter.map((c) => ({ ...c }))
        }))
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

// A brand-new card is never persisted until a type is actually chosen — no
// popup, and no orphaned "others"-by-default card if the picker is
// cancelled. `cardId` XOR `newCard`: editing an existing card vs. starting
// one from scratch.
function CardEditorOverlay({
  cardId,
  newCard,
  close
}: {
  cardId?: string;
  newCard?: { openingId: string; name: string };
  close: (result: CardEditorResult) => void;
}) {
  const [card, setCard] = useState<Card | null>(null);
  // Which color this card's repertoire plays — drives both the board
  // orientation and which side's moves get highlighted in the editor.
  const [yourColor, setYourColor] = useState<'w' | 'b'>('w');
  // The opening's own starting position (see types.ts's OpeningStartPosition),
  // threaded down to BoardsGrid so a brand-new board starts there instead of
  // the plain starting position.
  const [openingStartPosition, setOpeningStartPosition] = useState<OpeningStartPosition | undefined>(undefined);
  // Board style is a single global setting now (Settings screen) — fetched
  // once here and threaded down to every board preview/editor.
  const [boardStyle, setBoardStyle] = useState(0);
  const changedRef = useRef(false);
  // The card as it is in storage, to tell whether there's anything to lose.
  const originalRef = useRef('');
  const tutorial = useTutorial();
  const saveRef = useTutorialTarget('cardEditor.save');
  const modeRefs = {
    reactions: useTutorialTarget('cardEditor.mode.reactions'),
    plan: useTutorialTarget('cardEditor.mode.plan'),
    others: useTutorialTarget('cardEditor.mode.others')
  };

  useEffect(() => {
    (async () => {
      setBoardStyle(await getBoardStyle());
    })();
  }, []);

  useEffect(() => {
    if (!cardId) return;
    (async () => {
      const original = await getCard(cardId);
      if (!original) {
        close({ changed: false, deleted: false });
        return;
      }
      originalRef.current = JSON.stringify(original);
      setCard(JSON.parse(JSON.stringify(original)) as Card);
      const opening = await getOpening(original.openingId);
      const rep = opening ? await getRepertoire(opening.repertoireId) : undefined;
      setYourColor(rep?.group === 'black' ? 'b' : 'w');
      setOpeningStartPosition(opening?.startPosition);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cardId]);

  useEffect(() => {
    if (!newCard) return;
    (async () => {
      const opening = await getOpening(newCard.openingId);
      const rep = opening ? await getRepertoire(opening.repertoireId) : undefined;
      setYourColor(rep?.group === 'black' ? 'b' : 'w');
      setOpeningStartPosition(opening?.startPosition);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newCard?.openingId]);

  useOverlayBack(() => handleCancel());

  // A new card is never created until a type is chosen — pick one, or
  // Cancel/back and nothing was ever added.
  async function handlePickMode(pickedMode: CardMode) {
    if (!newCard) return;
    const created = await addCard(newCard.openingId, newCard.name, pickedMode);
    originalRef.current = JSON.stringify(created);
    changedRef.current = true;
    setCard(created);
    tutorial.remember({ cardId: created.id });
    tutorial.event(`mode:${pickedMode}`);
  }

  if (!card) {
    if (!newCard) return <SafeAreaView style={styles.overlay} />;
    return (
      <SafeAreaView style={styles.overlay}>
        <View style={styles.header}>
          <Pressable onPress={handleCancel} style={styles.headerCancel}>
            <Text style={styles.topBarBtn}>Cancel</Text>
          </Pressable>
          <MoveText text={newCard.name || 'New card'} style={styles.title} />
          <View style={{ width: 64 }} />
        </View>
        <ScrollView contentContainerStyle={styles.content}>
          <Text style={styles.fieldLabel}>What kind of card is this?</Text>
          <Pressable
            ref={modeRefs.reactions}
            collapsable={false}
            onPress={() => handlePickMode('reactions')}
            style={styles.modeTile}
          >
            <Text style={styles.modeTileTitle}>Reactions</Text>
            <Text style={styles.modeTileDesc}>A line you play, with branches for how they might reply.</Text>
          </Pressable>
          <Pressable ref={modeRefs.plan} collapsable={false} onPress={() => handlePickMode('plan')} style={styles.modeTile}>
            <Text style={styles.modeTileTitle}>Plan</Text>
            <Text style={styles.modeTileDesc}>A position with one arrow to reproduce.</Text>
          </Pressable>
          <Pressable ref={modeRefs.others} collapsable={false} onPress={() => handlePickMode('others')} style={styles.modeTile}>
            <Text style={styles.modeTileTitle}>Front & back</Text>
            <Text style={styles.modeTileDesc}>A question side and an answer side.</Text>
          </Pressable>
        </ScrollView>
        <TutorialLayer surface="cardEditor" />
      </SafeAreaView>
    );
  }

  async function handleSave() {
    if (!card) return;
    await saveCard(card);
    tutorial.event('cardSaved');
    close({ changed: true, deleted: false });
  }

  function isDirty() {
    return card !== null && JSON.stringify(card) !== originalRef.current;
  }

  async function handleCancel() {
    // Not during the tutorial, which handles leaving on its own.
    if (isDirty() && !tutorial.step) {
      const ok = await confirmDialog('Discard your changes?', { confirmLabel: 'Discard', cancelLabel: 'Keep editing' });
      if (!ok) return;
    }
    close({ changed: changedRef.current, deleted: false });
  }

  // All three modes share `card.boards`; migrateBoardForMode reconciles the
  // Reactions-only fields against the Others/Plan front/back split.
  async function handleSetMode(next: CardMode) {
    if (!card) return;
    if (next === card.mode) {
      // Already on this mode: nothing to change, but a tutorial step waiting
      // for exactly this choice shouldn't be left hanging.
      tutorial.event(`mode:${next}`);
      return;
    }
    const hasRecording = card.mode === 'reactions' && next !== 'reactions' && card.boards.some((b) => b.recording.length > 0);
    if (hasRecording) {
      const modeName = next === 'others' ? 'Front & back' : 'Plan';
      const ok = await confirmDialog(
        `Switching to ${modeName} deletes all recorded moves/notation on this card's boards. Each board's position, arrows, and circles are kept as its front and back. Continue?`
      );
      if (!ok) return;
    }
    setCard((prev) =>
      prev ? { ...prev, mode: next, boards: prev.boards.map((b) => migrateBoardForMode(b, prev.mode, next)) } : prev
    );
    tutorial.event(`mode:${next}`);
  }

  async function handleMoveDuplicate() {
    if (!card) return;
    // Moving or duplicating works on the saved card, so unsaved changes would
    // be left behind (or, saved silently, couldn't be cancelled any more).
    if (isDirty()) {
      const ok = await confirmDialog('Save your changes first? Moving or duplicating works on the saved card.', {
        confirmLabel: 'Save & continue',
        cancelLabel: 'Cancel',
        confirmVariant: 'primary'
      });
      if (!ok) return;
      await saveCard(card);
      originalRef.current = JSON.stringify(card);
      changedRef.current = true;
    }
    const result = await openMoveDuplicateDialog(card);
    if (result === 'moved') {
      close({ changed: true, deleted: false });
    } else if (result === 'duplicated') {
      changedRef.current = true;
    }
  }

  // No confirmation: the caller offers Undo once this window has closed.
  async function handleDelete() {
    if (!card) return;
    await deleteCard(card.id);
    close({ changed: true, deleted: true, deletedCard: card });
  }

  return (
    <SafeAreaView style={styles.overlay}>
      {/* Outside the scrolling part, so Cancel and Save never scroll away. */}
      <View style={styles.header}>
        <Pressable onPress={handleCancel} style={styles.headerCancel}>
          <Text style={styles.topBarBtn}>Cancel</Text>
        </Pressable>
        <Text style={styles.title}>Edit card</Text>
        <Pressable ref={saveRef} collapsable={false} onPress={handleSave} style={styles.headerSave}>
          <Text style={styles.headerSaveText}>Save</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.content}>

        <View style={styles.fastRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.fastTitle}>Fast Revision</Text>
            <Text style={styles.fastDesc}>Include this card in the quick daily run-through.</Text>
          </View>
          <Switch
            value={card.fastRevision === true}
            onValueChange={(on) => setCard((prev) => (prev ? { ...prev, fastRevision: on ? true : undefined } : prev))}
            trackColor={{ false: colors.panel2, true: colors.primary }}
            thumbColor={colors.textPrimary}
          />
        </View>

        <View style={styles.modeHeaderRow}>
          <Text style={[styles.fieldLabel, { marginTop: 0, marginBottom: 0 }]}>Boards</Text>
          <View style={styles.modeToggle}>
            <Pressable
              ref={modeRefs.reactions}
              collapsable={false}
              onPress={() => handleSetMode('reactions')}
              style={[styles.modeBtn, card.mode === 'reactions' && styles.modeBtnActive]}
            >
              <Text style={[styles.modeBtnText, card.mode === 'reactions' && styles.modeBtnTextActive]}>Reactions</Text>
            </Pressable>
            <Pressable ref={modeRefs.plan} collapsable={false} onPress={() => handleSetMode('plan')} style={[styles.modeBtn, card.mode === 'plan' && styles.modeBtnActive]}>
              <Text style={[styles.modeBtnText, card.mode === 'plan' && styles.modeBtnTextActive]}>Plan</Text>
            </Pressable>
            <Pressable ref={modeRefs.others} collapsable={false} onPress={() => handleSetMode('others')} style={[styles.modeBtn, card.mode === 'others' && styles.modeBtnActive]}>
              <Text style={[styles.modeBtnText, card.mode === 'others' && styles.modeBtnTextActive]}>Front & back</Text>
            </Pressable>
          </View>
        </View>

        <BoardsGrid
          mode={card.mode}
          boards={card.boards}
          yourColor={yourColor}
          boardStyle={boardStyle}
          startPosition={openingStartPosition}
          overviewText={card.overviewText}
          onOverviewChange={(overviewText) => setCard((prev) => (prev ? { ...prev, overviewText } : prev))}
          onChange={(boards) => setCard((prev) => (prev ? { ...prev, boards } : prev))}
        />

        <Pressable onPress={handleMoveDuplicate} style={[styles.blockBtn, styles.secondaryBtn]}>
          <Text style={[styles.blockBtnText, styles.secondaryBtnText]}>Move / duplicate card</Text>
        </Pressable>
        <Pressable onPress={handleDelete} style={[styles.blockBtn, styles.dangerBtn]}>
          <Text style={styles.blockBtnText}>Delete card</Text>
        </Pressable>
      </ScrollView>
      <SnackbarLayer />
      <TutorialLayer surface="cardEditor" />
    </SafeAreaView>
  );
}

export function openCardEditor(cardId: string): Promise<CardEditorResult> {
  return showOverlay<CardEditorResult>((close) => <CardEditorOverlay cardId={cardId} close={close} />, {
    animation: 'none'
  });
}

export function openNewCardEditor(openingId: string, name: string): Promise<CardEditorResult> {
  return showOverlay<CardEditorResult>((close) => <CardEditorOverlay newCard={{ openingId, name }} close={close} />, {
    animation: 'none'
  });
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, paddingBottom: 32 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.bg
  },
  headerCancel: { minHeight: 48, minWidth: 64, justifyContent: 'center' },
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
  topBarBtn: { color: colors.textDim, ...type.body },
  title: { color: colors.text, ...type.h2 },
  fieldLabel: { color: colors.textDim, fontSize: 12.5, marginBottom: 6, marginTop: 14 },
  fastRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    marginBottom: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.panel
  },
  fastTitle: { color: colors.text, ...type.bodyStrong },
  fastDesc: { color: colors.textDim, fontSize: 12.5, marginTop: 2 },
  modeHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 0, marginBottom: 6 },
  modeToggle: { flexDirection: 'row', backgroundColor: colors.panel2, borderRadius: 8, padding: 2, borderWidth: 1, borderColor: colors.border },
  modeBtn: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 6 },
  modeBtnActive: { backgroundColor: colors.accent },
  modeBtnText: { color: colors.textDim, fontSize: 13, fontWeight: '600' },
  modeBtnTextActive: { color: colors.onPrimary },
  modeTile: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.panel,
    borderRadius: 12,
    padding: 16,
    marginTop: 12
  },
  modeTileTitle: { color: colors.text, ...type.h2, marginBottom: 4 },
  modeTileDesc: { color: colors.textDim, ...type.body },
  blockBtn: { width: '100%', borderRadius: 10, paddingVertical: 13, alignItems: 'center', marginTop: 12 },
  secondaryBtn: { backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.textDim },
  secondaryBtnText: { color: colors.text },
  dangerBtn: { backgroundColor: colors.danger, marginTop: 28 },
  blockBtnText: { color: 'white', fontSize: 15, fontWeight: '600' }
});
