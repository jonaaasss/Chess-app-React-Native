import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';
import { descriptionFace, faceAnnotations, isPlanLike } from '../chess';
import { ChessBoardView, NumberedArrowBadges, NumberedArrowsSvg, numberBadgeCenter, type NumberedArrow } from '../components/ChessBoard';
import { toEditorNumberedArrows } from '../arrowNumbering';
import { ReactionStudy } from './ReactionStudy';
import { MoveText } from '../components/MoveText';
import { CollapsibleDescription } from '../components/CollapsibleDescription';
import { showOverlay, useOverlayBack } from '../overlay';
import { getCard, saveCard } from '../storage';
import type { Arrow, Card, Circle, MoveNode, ReactionBoard } from '../types';
import { colors, radius, touchTarget, type, variationColor } from '../theme';
import { openReactionBoardEditor } from './ReactionBoardEditorOverlay';
import { EditCircleButton } from '../components/Common';

// Skip-to-next glyph, drawn like the app's other icons (same as in Study).
function SkipIcon({ size, color }: { size: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" fill={color} />
    </Svg>
  );
}

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

// Look-only viewer for a card linked from a Summary arrow: "← Summary" and
// the full title on top. A Reactions card runs exactly as in Study
// (ReactionStudy with `viewer`): Play myself or Auto-play, the lines
// overview, « ‹ ›, nothing scored; Continue returns to the Summary. A Plan
// card shows its Description above the board, the arrows numbered as in the
// board editor, and ‹ › beside the board to switch boards. The pencil under
// the board opens the Board editor (on a Reactions card at the move shown).
// A link to one board shows only that board.
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
  // Reactions: the study view's pause, and where it stands (for the pencil).
  const [paused, setPaused] = useState(false);
  const [version, setVersion] = useState(0);
  const studyBoardRef = useRef<ReactionBoard | null>(null);
  const studyCursorRef = useRef<string | null>(null);
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
    const target = isReactions ? studyBoardRef.current ?? board : board;
    setPaused(true);
    const updated = await openReactionBoardEditor(
      target,
      card.mode,
      yourColor,
      boardStyle,
      isReactions ? studyCursorRef.current : undefined
    );
    setPaused(false);
    if (!updated) return;
    const updatedCard = { ...card, boards: card.boards.map((b) => (b.id === updated.id ? updated : b)) };
    await saveCard(updatedCard);
    setCard(updatedCard);
    setPath([]);
    setVersion((v) => v + 1);
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
  const numbered = toEditorNumberedArrows(annotations.arrows, pieces, yourColor);
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
        {card && board && isReactions && (
          // A Reactions card plays exactly as in Study, with the same choice
          // between Play myself and Auto-play (remembered), the lines overview
          // and « ‹ ›; nothing is scored. Continue goes back. `paused` only
          // freezes it while the board editor is open.
          <>
            <ReactionStudy
              key={`${card.id}-${version}`}
              card={{ ...card, boards }}
              yourColor={yourColor}
              boardStyle={boardStyle}
              onResult={() => close()}
              boardRef={studyBoardRef}
              cursorRef={studyCursorRef}
              viewer
              paused={paused}
            />
          </>
        )}
        {card && board && !isReactions && (
          <>
            <CollapsibleDescription text={description} />
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
                <ChessBoardView board={{ pieces, style: boardStyle, arrows: [], circles: annotations.circles }} size={size} flipped={flipped} />
                <View style={StyleSheet.absoluteFill} pointerEvents="none">
                  {/* Numbered like the board editor: same-colour arrows 1, 2…, threats !A / A1 / ★A. */}
                  <NumberedArrowsSvg arrows={numbered} size={size} flipped={flipped} pieces={pieces} yourColor={yourColor} />
                  <NumberedArrowBadges arrows={numbered} size={size} flipped={flipped} pieces={pieces} yourColor={yourColor} />
                </View>
              </View>
              {boards.length > 1 && boardIdx < boards.length - 1 ? (
                <Pressable onPress={() => goToBoard(boardIdx + 1)} style={styles.sideBtn} accessibilityLabel="Next board">
                  <Text style={styles.navText}>›</Text>
                </Pressable>
              ) : (
                <View style={styles.navSpacer} />
              )}
            </View>
          </>
        )}
      </ScrollView>

      {/* Fixed at the bottom, as in Study: the pencil and Skip (back to the Summary). */}
      {card && board && (
        <View style={styles.bottomBar}>
          <EditCircleButton onPress={editBoard} />
          <Pressable onPress={close} style={styles.skipBtn} accessibilityLabel="Skip, back to the Summary">
            <View style={styles.skipRow}>
              <SkipIcon size={18} color={colors.textDim} />
              <Text style={styles.skipLabel}>Skip</Text>
            </View>
            <Text style={styles.skipNote}>back to the Summary</Text>
          </Pressable>
        </View>
      )}
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
  bottomBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 48,
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 4,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.bg
  },
  skipBtn: { minHeight: 48, alignItems: 'flex-end', justifyContent: 'center', paddingHorizontal: 4 },
  skipRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  skipLabel: { color: colors.textDim, fontSize: 14, fontWeight: '600' },
  skipNote: { color: colors.textDim, fontSize: 11, opacity: 0.8 },
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
