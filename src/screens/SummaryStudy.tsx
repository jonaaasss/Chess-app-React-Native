// Study for a Summary card: nothing to do or score — each board is shown with
// its arrows already drawn. The link badge on an arrow opens the linked card
// (see CardViewerOverlay), the orange badge shows the arrow's notes below the
// board. Continue goes to the next board, and after the last one, onDone.
import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { faceAnnotations } from '../chess';
import { ArrowNoteBody } from '../components/ArrowNoteBody';
import { MoveText } from '../components/MoveText';
import { CloseCircleButton } from '../overlay';
import type { Arrow, Card, ReactionBoard } from '../types';
import { arrowColors, colors, radius, touchTarget } from '../theme';
import { openCardViewer } from './CardViewerOverlay';
import { SummaryBoard } from './SummaryBoard';

const BOARD_SIZE = 300;

export function SummaryStudy({
  card,
  yourColor,
  boardStyle,
  onDone,
  boardRef
}: {
  card: Card;
  yourColor: 'w' | 'b';
  boardStyle: number;
  onDone: () => void;
  // The board on screen, for the study screen's edit button.
  boardRef?: React.MutableRefObject<ReactionBoard | null>;
}) {
  const boards = useMemo(() => [...card.boards].sort((a, b) => a.order - b.order), [card]);
  const [boardIdx, setBoardIdx] = useState(0);
  const [note, setNote] = useState<Arrow | null>(null);
  const board = boards[boardIdx];
  if (board && boardRef) boardRef.current = board;
  useEffect(() => setNote(null), [boardIdx]);

  if (!board) return null;
  const annotations = faceAnnotations(board.back);
  const text = board.back.text.trim();
  const last = boardIdx >= boards.length - 1;

  return (
    <View style={styles.wrap}>
      {boards.length > 1 && <Text style={styles.counter}>Board {boardIdx + 1} / {boards.length}</Text>}
      <SummaryBoard
        pieces={board.back.pieces}
        arrows={annotations.arrows}
        circles={annotations.circles}
        size={BOARD_SIZE}
        flipped={yourColor === 'b'}
        boardStyle={boardStyle}
        onOpenLink={(cardId) => openCardViewer(cardId, yourColor, boardStyle)}
        onShowNote={setNote}
      />

      {note && (
        <View style={styles.notePanel}>
          <View style={styles.noteHeader}>
            <Text style={styles.noteTitle}>Notes</Text>
            <CloseCircleButton onPress={() => setNote(null)} />
          </View>
          <ArrowNoteBody notes={note.notes} accent={arrowColors[note.color]} />
        </View>
      )}

      {!!text && <MoveText text={text} style={styles.description} />}

      <Pressable onPress={() => (last ? onDone() : setBoardIdx(boardIdx + 1))} style={styles.continueBtn}>
        <Text style={styles.continueText}>Continue</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 12 },
  counter: { color: colors.textDim, fontSize: 13, textAlign: 'center' },
  description: { color: colors.text, fontSize: 15, lineHeight: 22 },
  notePanel: { backgroundColor: colors.panel, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: 12, gap: 8 },
  noteHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  noteTitle: { color: colors.text, fontSize: 15, fontWeight: '700' },
  continueBtn: {
    minHeight: touchTarget,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: radius.pill,
    backgroundColor: colors.primary
  },
  continueText: { color: colors.onPrimary, fontSize: 14, fontWeight: '700' }
});
