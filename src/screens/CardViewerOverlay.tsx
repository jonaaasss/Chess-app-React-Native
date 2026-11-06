import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';
import { descriptionFace, faceAnnotations, isPlanLike } from '../chess';
import { ChessBoardView, NumberedArrowsSvg, numberBadgeCenter, type NumberedArrow } from '../components/ChessBoard';
import { MoveText } from '../components/MoveText';
import { showOverlay, useOverlayBack } from '../overlay';
import { getCard, saveCard } from '../storage';
import type { Arrow, Card, Circle, MoveNode, ReactionBoard } from '../types';
import { colors, radius, touchTarget, type, variationColor } from '../theme';
import { openReactionBoardEditor } from './ReactionBoardEditorOverlay';

// The arrows and circles on screen after walking `path` from the board's
// own start: each move adds and removes its own (same rule as the editor).
function annotationsAlong(board: ReactionBoard, path: MoveNode[]): { arrows: Arrow[]; circles: Circle[] } {
  const same = (a: Arrow, b: Arrow) => a.from === b.from && a.to === b.to && a.color === b.color;
  let arrows = [...board.arrows];
  let circles = [...board.circles];
  for (const node of path) {
    arrows = arrows.filter((a) => !node.removedArrows.some((r) => same(r, a)));
    circles = circles.filter((c) => !node.removedCircles.some((r) => r.square === c.square && r.color === c.color));
    arrows = [...arrows, ...node.addedArrows];
    circles = [...circles, ...node.addedCircles];
  }
  return { arrows, circles };
}

function PencilIcon({ size, color }: { size: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

// Look-only viewer for a card linked from a Summary arrow. Top to bottom:
// "← Summary" and the full title; the board's Description; the board with
// ‹ › beside it to switch boards (hidden for one board or a link to one
// board); under it the pencil (Board editor for this board) and, on a
// Reactions board, « ‹ › » through the recorded moves (« » to the previous /
// next branching point). At a branching point the variations are purple
// numbered arrows (1 = main line, which › follows); tap a number to follow it.
function CardViewerOverlay({
  cardId,
  boardId,
  yourColor,
  boardStyle,
  close
}: {
  cardId: string;
  // A link to one board: only that board is shown. Missing board = whole card.
  boardId?: string;
  yourColor: 'w' | 'b';
  boardStyle: number;
  close: () => void;
}) {
  const [card, setCard] = useState<Card | null | undefined>(undefined);
  const [boardIdx, setBoardIdx] = useState(0);
  // Reactions: the moves played from the board's start (a path in the tree).
  const [path, setPath] = useState<MoveNode[]>([]);
  const { width } = useWindowDimensions();
  const size = Math.min(width - 32 - 2 * (touchTarget + 8), 360);
  const flipped = yourColor === 'b';

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

  function goToBoard(i: number) {
    setBoardIdx(i);
    setPath([]);
  }

  // Moves on a Reactions board.
  const childrenAt = (p: MoveNode[]) => (p.length === 0 ? board?.recording ?? [] : p[p.length - 1].children);
  const children = isReactions ? childrenAt(path) : [];
  const canMoveBack = path.length > 0;
  const canMoveForward = children.length > 0;
  function moveForward() {
    if (children[0]) setPath([...path, children[0]]);
  }
  function moveBack() {
    setPath(path.slice(0, -1));
  }
  // » plays the main line on until the next branching point (or the end).
  function toNextBranch() {
    let p = path;
    do {
      const next = childrenAt(p)[0];
      if (!next) break;
      p = [...p, next];
    } while (childrenAt(p).length === 1);
    setPath(p);
  }
  // « goes back to the previous branching point (or the start).
  function toPrevBranch() {
    let p = path.slice(0, -1);
    while (p.length > 0 && childrenAt(p).length < 2) p = p.slice(0, -1);
    setPath(p);
  }

  async function editBoard() {
    if (!card || !board) return;
    const updated = await openReactionBoardEditor(
      board,
      card.mode,
      yourColor,
      boardStyle,
      isReactions ? (path.length > 0 ? path[path.length - 1].id : null) : undefined
    );
    if (!updated) return;
    const updatedCard = { ...card, boards: card.boards.map((b) => (b.id === updated.id ? updated : b)) };
    await saveCard(updatedCard);
    setCard(updatedCard);
    setPath([]);
  }

  let pieces: ReactionBoard['pieces'] = {};
  let annotations: { arrows: Arrow[]; circles: Circle[] } = { arrows: [], circles: [] };
  if (card && board) {
    if (isReactions) {
      pieces = path.length === 0 ? board.pieces : path[path.length - 1].piecesAfter;
      annotations = annotationsAlong(board, path);
    } else {
      const face = isPlanLike(card.mode) ? board.back : board.front;
      pieces = face.pieces;
      annotations = faceAnnotations(face);
    }
  }
  // The variations at a branching point, numbered (1 = main line).
  const variants: NumberedArrow[] =
    children.length > 1
      ? children.map((c, i) => ({ id: c.id, from: c.from, to: c.to, color: variationColor, number: i + 1 }))
      : [];
  const description = card && board ? board[descriptionFace(card.mode)].text.trim() : '';
  const last = path[path.length - 1];

  return (
    <SafeAreaView style={styles.overlay}>
      <View style={styles.header}>
        <Pressable onPress={close} style={styles.backBtn} accessibilityLabel="Back to the Summary">
          <Text style={styles.backText}>← Summary</Text>
        </Pressable>
        <MoveText text={card?.name || (card === null ? 'Card not found' : '')} style={styles.title} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {card === null && <Text style={styles.missing}>This card no longer exists.</Text>}
        {card && board && (
          <>
            {!!description && <MoveText text={description} style={styles.description} />}
            {boards.length > 1 && <Text style={styles.counter}>{`Board ${boardIdx + 1} / ${boards.length}`}</Text>}
            <View style={styles.boardRow}>
              {boards.length > 1 && boardIdx > 0 ? (
                <Pressable onPress={() => goToBoard(boardIdx - 1)} style={styles.sideBtn} accessibilityLabel="Previous board">
                  <Text style={styles.navText}>‹</Text>
                </Pressable>
              ) : (
                <View style={styles.navSpacer} />
              )}
              <View style={{ width: size, height: size }}>
                <ChessBoardView board={{ pieces, style: boardStyle, arrows: annotations.arrows, circles: annotations.circles }} size={size} flipped={flipped} />
                {variants.length > 0 && (
                  <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
                    <View style={StyleSheet.absoluteFill} pointerEvents="none">
                      <NumberedArrowsSvg arrows={variants} size={size} flipped={flipped} />
                    </View>
                    {variants.map((v, i) => {
                      const c = numberBadgeCenter(v, i, size, flipped);
                      return (
                        <Pressable
                          key={v.id}
                          onPress={() => setPath([...path, children[i]])}
                          hitSlop={11}
                          style={[styles.variantBadge, { left: c.x - 13, top: c.y - 13 }]}
                          accessibilityLabel={`Follow variation ${i + 1}: ${children[i].san}`}
                        >
                          <Text style={styles.variantBadgeText}>{i + 1}</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                )}
              </View>
              {boards.length > 1 && boardIdx < boards.length - 1 ? (
                <Pressable onPress={() => goToBoard(boardIdx + 1)} style={styles.sideBtn} accessibilityLabel="Next board">
                  <Text style={styles.navText}>›</Text>
                </Pressable>
              ) : (
                <View style={styles.navSpacer} />
              )}
            </View>

            <View style={styles.underRow}>
              <Pressable onPress={editBoard} style={styles.pencilBtn} accessibilityLabel="Edit this board">
                <PencilIcon size={22} color={colors.text} />
              </Pressable>
              {isReactions && board.recording.length > 0 ? (
                <View style={styles.moveNav}>
                  <Pressable onPress={toPrevBranch} disabled={!canMoveBack} style={[styles.moveBtn, !canMoveBack && styles.moveBtnDisabled]} accessibilityLabel="Back to the previous branching point">
                    <Text style={styles.moveBtnText}>«</Text>
                  </Pressable>
                  <Pressable onPress={moveBack} disabled={!canMoveBack} style={[styles.moveBtn, !canMoveBack && styles.moveBtnDisabled]} accessibilityLabel="One move back">
                    <Text style={styles.moveBtnText}>‹</Text>
                  </Pressable>
                  <Pressable onPress={moveForward} disabled={!canMoveForward} style={[styles.moveBtn, !canMoveForward && styles.moveBtnDisabled]} accessibilityLabel="Next move">
                    <Text style={styles.moveBtnText}>›</Text>
                  </Pressable>
                  <Pressable onPress={toNextBranch} disabled={!canMoveForward} style={[styles.moveBtn, !canMoveForward && styles.moveBtnDisabled]} accessibilityLabel="On to the next branching point">
                    <Text style={styles.moveBtnText}>»</Text>
                  </Pressable>
                </View>
              ) : (
                <View style={{ flex: 1 }} />
              )}
              <View style={styles.navSpacer} />
            </View>
            {isReactions && board.recording.length > 0 && (
              <Text style={styles.moveInfo}>
                {path.length === 0 ? 'Start position' : `After ${last.san}`}
                {variants.length > 0 ? ' · tap a number to follow a variation' : ''}
              </Text>
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
  backBtn: { minHeight: touchTarget, justifyContent: 'center', paddingHorizontal: 14, borderRadius: radius.pill, backgroundColor: colors.primary },
  backText: { color: colors.onPrimary, fontSize: 15, fontWeight: '700' },
  title: { flex: 1, color: colors.text, ...type.h2 },
  counter: { color: colors.textDim, fontSize: 13, textAlign: 'center' },
  sideBtn: {
    width: touchTarget,
    height: touchTarget * 1.5,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.panel2,
    alignItems: 'center',
    justifyContent: 'center'
  },
  underRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  pencilBtn: { width: touchTarget, height: touchTarget, borderRadius: 10, backgroundColor: colors.panel2, alignItems: 'center', justifyContent: 'center' },
  moveNav: { flex: 1, flexDirection: 'row', justifyContent: 'center', gap: 10 },
  moveBtn: { width: touchTarget, height: touchTarget, borderRadius: 10, backgroundColor: colors.panel2, alignItems: 'center', justifyContent: 'center' },
  moveBtnDisabled: { opacity: 0.35 },
  moveBtnText: { color: colors.gold, fontSize: 22 },
  variantBadge: { position: 'absolute', width: 26, height: 26, borderRadius: 13, backgroundColor: variationColor, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#ffffff' },
  variantBadgeText: { color: '#1d1030', fontSize: 13, fontWeight: '800' },
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
