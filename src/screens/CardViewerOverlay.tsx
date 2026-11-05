// Look-only viewer for a card linked from a Summary arrow. Opens on board 1
// with all its arrows shown; ‹ and › beside the board step through it — from
// board to board for a Plan card, move by move along the recorded main line
// (then on to the next board) for a Reactions card. "← Summary" (or the
// Android back button) returns to the Summary board it was opened from.
import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { descriptionFace, faceAnnotations, isPlanLike, mainLineNodes } from '../chess';
import { MoveText } from '../components/MoveText';
import { showOverlay, useOverlayBack } from '../overlay';
import { getCard } from '../storage';
import type { Card } from '../types';
import { colors, radius, touchTarget, type } from '../theme';
import { SummaryBoard } from './SummaryBoard';

function CardViewerOverlay({
  cardId,
  boardId,
  yourColor,
  boardStyle,
  close
}: {
  cardId: string;
  // A link to one board: only that board is shown (no ‹ › to other boards;
  // a Reactions board still steps through its moves). Missing board = whole card.
  boardId?: string;
  yourColor: 'w' | 'b';
  boardStyle: number;
  close: () => void;
}) {
  const [card, setCard] = useState<Card | null | undefined>(undefined);
  const [boardIdx, setBoardIdx] = useState(0);
  // Reactions only: how many moves of the main line have been played out.
  const [ply, setPly] = useState(0);
  const { width } = useWindowDimensions();
  const size = Math.min(width - 32 - 2 * (touchTarget + 8), 360);

  useEffect(() => {
    getCard(cardId).then((c) => setCard(c ?? null));
  }, [cardId]);
  useOverlayBack(close);

  const boards = useMemo(() => {
    if (!card) return [];
    const sorted = [...card.boards].sort((a, b) => a.order - b.order);
    const one = boardId ? sorted.filter((b) => b.id === boardId) : [];
    return one.length > 0 ? one : sorted;
  }, [card, boardId]);
  const board = boards[boardIdx];
  const isReactions = card?.mode === 'reactions';
  const line = useMemo(() => (board && isReactions ? mainLineNodes(board.recording) : []), [board, isReactions]);

  const canBack = ply > 0 || boardIdx > 0;
  const canForward = (isReactions && ply < line.length) || boardIdx < boards.length - 1;

  function back() {
    if (ply > 0) setPly(ply - 1);
    else if (boardIdx > 0) {
      setBoardIdx(boardIdx - 1);
      setPly(0);
    }
  }
  function forward() {
    if (isReactions && ply < line.length) setPly(ply + 1);
    else if (boardIdx < boards.length - 1) {
      setBoardIdx(boardIdx + 1);
      setPly(0);
    }
  }

  let view: React.ReactNode = null;
  if (card && board) {
    if (isReactions) {
      const pieces = ply === 0 ? board.pieces : line[ply - 1].piecesAfter;
      view = (
        <SummaryBoard
          pieces={pieces}
          arrows={ply === 0 ? board.arrows : []}
          circles={ply === 0 ? board.circles : []}
          size={size}
          flipped={yourColor === 'b'}
          boardStyle={boardStyle}
        />
      );
    } else {
      const face = isPlanLike(card.mode) ? board.back : board.front;
      const annotations = faceAnnotations(face);
      view = (
        <SummaryBoard
          pieces={face.pieces}
          arrows={annotations.arrows}
          circles={annotations.circles}
          size={size}
          flipped={yourColor === 'b'}
          boardStyle={boardStyle}
        />
      );
    }
  }

  return (
    <SafeAreaView style={styles.overlay}>
      <View style={styles.header}>
        <Pressable onPress={close} style={styles.backBtn} accessibilityLabel="Back to the Summary">
          <Text style={styles.backText}>← Summary</Text>
        </Pressable>
        <MoveText text={card?.name || (card === null ? 'Card not found' : '')} style={styles.title} numberOfLines={1} />
        <Text style={styles.counter}>{boards.length > 1 ? `${boardIdx + 1} / ${boards.length}` : ''}</Text>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {card === null && <Text style={styles.missing}>This card no longer exists.</Text>}
        {card && board && (
          <>
            <View style={styles.boardRow}>
              {canBack ? (
                <Pressable onPress={back} style={styles.navBtn} accessibilityLabel="Previous">
                  <Text style={styles.navText}>‹</Text>
                </Pressable>
              ) : (
                <View style={styles.navSpacer} />
              )}
              {view}
              {canForward ? (
                <Pressable onPress={forward} style={styles.navBtn} accessibilityLabel="Next">
                  <Text style={styles.navText}>›</Text>
                </Pressable>
              ) : (
                <View style={styles.navSpacer} />
              )}
            </View>
            {isReactions && line.length > 0 && (
              <Text style={styles.moveInfo}>{ply === 0 ? 'Start position' : `After ${line[ply - 1].san}`}</Text>
            )}
            {!!board[descriptionFace(card.mode)].text.trim() && (
              <MoveText text={board[descriptionFace(card.mode)].text.trim()} style={styles.description} />
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

export function openCardViewer(cardId: string, yourColor: 'w' | 'b', boardStyle: number, boardId?: string): Promise<void> {
  return showOverlay<void>((close) => (
    <CardViewerOverlay cardId={cardId} boardId={boardId} yourColor={yourColor} boardStyle={boardStyle} close={() => close(undefined)} />
  ), { animation: 'none' });
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: colors.border
  },
  backBtn: { minHeight: touchTarget, justifyContent: 'center', paddingHorizontal: 12, borderRadius: radius.pill, backgroundColor: colors.panel2 },
  backText: { color: colors.text, fontSize: 15, fontWeight: '700' },
  title: { flex: 1, color: colors.text, ...type.h2, textAlign: 'center' },
  counter: { minWidth: 48, color: colors.textDim, fontSize: 13, textAlign: 'right' },
  content: { padding: 16, gap: 12 },
  boardRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  navBtn: {
    width: touchTarget,
    height: touchTarget * 1.5,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.panel2,
    alignItems: 'center',
    justifyContent: 'center'
  },
  navSpacer: { width: touchTarget },
  navText: { color: colors.text, fontSize: 26 },
  moveInfo: { color: colors.textDim, fontSize: 13, textAlign: 'center' },
  description: { color: colors.text, fontSize: 15, lineHeight: 22 },
  missing: { color: colors.textSecondary, textAlign: 'center', marginTop: 24 }
});
