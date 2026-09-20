import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet, PanResponder, type PanResponderInstance } from 'react-native';
import { allSquares, flipIndex, squareFromIndex } from '../chess';
import type { Arrow, ArrowColor, Card, ReactionBoard } from '../types';
import { arrowColors, boardStyles, colors, radius, touchTarget } from '../theme';
import { CirclesSvg, PieceGlyph, NumberedArrowsSvg, NumberedArrowBadges, type NumberedArrow } from '../components/ChessBoard';
import type { GuideTargets } from '../components/GuideCoach';
import type { CoachEvent } from '../guideContent';

// A wrong arrow flashes briefly before it's removed — long enough to
// register as "that's what I drew", short enough not to block retrying.
const WRONG_ARROW_SHOW_MS = 700;
// Pause after a board's plan is fully found before moving to the next one,
// so the completed picture is visible for a moment rather than vanishing
// the instant the last arrow lands.
const BOARD_DONE_PAUSE_MS = 900;

const BOARD_SIZE = 300;
const CELL = BOARD_SIZE / 8;

// The fixed order Plan colors get assigned in — unused colors are skipped
// entirely, and a color used more than once just repeats that many times
// before moving to the next one.
const COLOR_CYCLE: ArrowColor[] = ['green', 'orange', 'red', 'blue'];

interface ColorGroup {
  color: ArrowColor;
  arrows: Arrow[];
}

function buildColorGroups(arrows: Arrow[]): ColorGroup[] {
  return COLOR_CYCLE.map((color) => ({ color, arrows: arrows.filter((a) => a.color === color) })).filter(
    (g) => g.arrows.length > 0
  );
}

// The badge number an arrow shows in the board editor is its position
// within its own same-color group there (only shown once a color is used
// 2+ times) — keyed by from/to/color so a drawn arrow in Study can look up
// the exact same number instead of just numbering by the order you find
// them in, which would rarely match.
function editorArrowNumbers(arrows: Arrow[]): Map<string, number> {
  const countByColor: Partial<Record<ArrowColor, number>> = {};
  for (const a of arrows) countByColor[a.color] = (countByColor[a.color] ?? 0) + 1;
  const seenByColor: Partial<Record<ArrowColor, number>> = {};
  const numbers = new Map<string, number>();
  for (const a of arrows) {
    const seen = (seenByColor[a.color] = (seenByColor[a.color] ?? 0) + 1);
    if ((countByColor[a.color] ?? 0) > 1) {
      numbers.set(`${a.from}-${a.to}-${a.color}`, seen);
    }
  }
  return numbers;
}

// Interactive Plan study: the position is shown bare (no arrows/circles —
// Study hides what the editor drew) and you have to draw the plan's arrows
// yourself, one color group at a time in the fixed green→orange→red→blue
// order (skipping colors the board doesn't use). Each arrow you draw is
// checked against whatever's left in the current color group — order
// within a group doesn't matter, just which squares. A wrong arrow flashes
// and is removed, counted as a mistake, and you try again; once every
// arrow is found the board's own circles are revealed alongside the
// completed plan.
export function PlanStudy({
  card,
  yourColor,
  boardStyle,
  onResult,
  boardRef,
  onEditBoard,
  guideTargets,
  onGuideEvent
}: {
  card: Card;
  yourColor: 'w' | 'b';
  boardStyle: number;
  onResult: (correct: boolean) => void;
  boardRef?: React.MutableRefObject<ReactionBoard | null>;
  onEditBoard?: () => void;
  // Guide coach hooks (optional): where the popups' spotlights go, and the
  // Show solution press a popup can wait on.
  guideTargets?: GuideTargets;
  onGuideEvent?: (event: CoachEvent) => void;
}) {
  const boards = useMemo(() => [...card.boards].sort((a, b) => a.order - b.order), [card]);
  const [boardIdx, setBoardIdx] = useState(0);
  const [groupIdx, setGroupIdx] = useState(0);
  const [remaining, setRemaining] = useState<Arrow[]>([]);
  const [drawnArrows, setDrawnArrows] = useState<Arrow[]>([]);
  const [wrongArrow, setWrongArrow] = useState<{ from: string; to: string } | null>(null);
  const [mistakes, setMistakes] = useState(0);
  const [boardDone, setBoardDone] = useState(false);
  const [allDone, setAllDone] = useState(false);
  const [tempArrow, setTempArrow] = useState<{ from: string; to: string } | null>(null);

  // Guide coach: the card is finished and its Continue button is on screen.
  useEffect(() => {
    if (allDone) onGuideEvent?.('allDone');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allDone]);

  const board: ReactionBoard | undefined = boards[boardIdx];

  // Lets the Edit button (in the parent study session chrome) jump straight
  // into whichever board is actually on screen right now, instead of just
  // opening the card and making you find/open the right board yourself.
  // Written directly during render (not a useEffect, which only runs after
  // paint and left a real gap where a fast Edit tap could still read the
  // previous board, or null right after mount) — safe here since it's a
  // plain ref write with no read-back that could affect this render's
  // output.
  if (board && boardRef) boardRef.current = board;

  // A Plan board has one position — `back` is just where it (and its
  // arrows/circles/description) lives, not a second face. Its arrows are
  // the plan you have to reproduce; its circles are decorative context
  // revealed only once the board is solved.
  const colorGroups = useMemo(() => (board ? buildColorGroups(board.back.arrows) : []), [board]);
  const arrowNumbers = useMemo(() => editorArrowNumbers(board ? board.back.arrows : []), [board]);
  // Nothing to reproduce — the board can't be studied at all, which is a
  // problem to fix in the editor, not a board to quietly count as solved.
  const noArrows = colorGroups.length === 0;

  const gridRef = useRef<View>(null);
  const gridOrigin = useRef({ x: 0, y: 0 });
  const arrowStartRef = useRef<string | null>(null);
  const flipped = yourColor === 'b';

  function measureGrid(cb?: () => void) {
    gridRef.current?.measureInWindow((x, y) => {
      gridOrigin.current = { x, y };
      cb?.();
    });
  }

  useEffect(() => {
    measureGrid();
  }, []);

  function squareFromPage(pageX: number, pageY: number): string | null {
    const file = Math.floor((pageX - gridOrigin.current.x) / CELL);
    const rank = Math.floor((pageY - gridOrigin.current.y) / CELL);
    return squareFromIndex(flipIndex(file, flipped), flipIndex(rank, flipped));
  }

  // A new board resets the whole exercise — start at the first color group.
  // A board with no arrows is never "done" (it used to be, which showed
  // "Board complete!" for something that couldn't be studied); it shows a
  // warning instead, and re-runs this once arrows are added in the editor.
  useEffect(() => {
    setGroupIdx(0);
    setRemaining(colorGroups[0]?.arrows ?? []);
    setDrawnArrows([]);
    setWrongArrow(null);
    setBoardDone(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [colorGroups]);

  useEffect(() => {
    if (!boardDone) return;
    const t = setTimeout(() => {
      if (boardIdx < boards.length - 1) {
        setBoardIdx((i) => i + 1);
        setBoardDone(false);
      } else {
        setAllDone(true);
      }
    }, BOARD_DONE_PAUSE_MS);
    return () => clearTimeout(t);
  }, [boardDone, boardIdx, boards.length]);

  function handleDrawnArrow(from: string, to: string) {
    if (!board || boardDone || allDone || wrongArrow || noArrows) return;
    const matchIdx = remaining.findIndex((a) => a.from === from && a.to === to);
    if (matchIdx === -1) {
      setMistakes((m) => m + 1);
      setWrongArrow({ from, to });
      setTimeout(() => setWrongArrow(null), WRONG_ARROW_SHOW_MS);
      return;
    }
    const matched = remaining[matchIdx];
    setDrawnArrows((prev) => [...prev, matched]);
    const nextRemaining = remaining.filter((_, i) => i !== matchIdx);
    if (nextRemaining.length > 0) {
      setRemaining(nextRemaining);
      return;
    }
    const nextGroupIdx = groupIdx + 1;
    if (nextGroupIdx < colorGroups.length) {
      setGroupIdx(nextGroupIdx);
      setRemaining(colorGroups[nextGroupIdx].arrows);
    } else {
      setBoardDone(true);
    }
  }

  function showSolution() {
    if (!board || boardDone || allDone || wrongArrow || remaining.length === 0) return;
    setMistakes((m) => m + 1);
    handleDrawnArrow(remaining[0].from, remaining[0].to);
    onGuideEvent?.('solution');
  }

  const panResponderRef = useRef<PanResponderInstance | null>(null);
  const handleDrawnArrowRef = useRef(handleDrawnArrow);
  handleDrawnArrowRef.current = handleDrawnArrow;
  if (!panResponderRef.current) {
    panResponderRef.current = PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (evt) => {
        const { pageX, pageY } = evt.nativeEvent;
        measureGrid(() => {
          const sq = squareFromPage(pageX, pageY);
          if (!sq) return;
          arrowStartRef.current = sq;
          setTempArrow(null);
        });
      },
      onPanResponderMove: (evt) => {
        if (!arrowStartRef.current) return;
        const { pageX, pageY } = evt.nativeEvent;
        const hoverSq = squareFromPage(pageX, pageY);
        const start = arrowStartRef.current;
        setTempArrow(hoverSq && hoverSq !== start ? { from: start, to: hoverSq } : null);
      },
      onPanResponderRelease: (evt) => {
        const start = arrowStartRef.current;
        arrowStartRef.current = null;
        setTempArrow(null);
        if (!start) return;
        const { pageX, pageY } = evt.nativeEvent;
        const endSq = squareFromPage(pageX, pageY);
        if (endSq && endSq !== start) handleDrawnArrowRef.current(start, endSq);
      }
    });
  }
  const panResponder = panResponderRef.current;

  // Computed before the `!board` bail-out below — hooks can't be called
  // conditionally, and this one doesn't actually need `board` (colorGroups
  // already resolves to [] when there isn't one).
  const numberedArrows: NumberedArrow[] = useMemo(() => {
    const list: NumberedArrow[] = drawnArrows.map((a, i) => ({
      id: `${a.from}-${a.to}-${i}`,
      from: a.from,
      to: a.to,
      color: arrowColors[a.color],
      number: arrowNumbers.get(`${a.from}-${a.to}-${a.color}`)
    }));
    if (wrongArrow) {
      list.push({ id: 'wrong', from: wrongArrow.from, to: wrongArrow.to, color: colors.danger });
    } else if (tempArrow) {
      const previewColor = colorGroups[groupIdx] ? arrowColors[colorGroups[groupIdx].color] : colors.textDim;
      list.push({ id: 'preview', from: tempArrow.from, to: tempArrow.to, color: previewColor });
    }
    return list;
  }, [drawnArrows, wrongArrow, tempArrow, colorGroups, groupIdx, arrowNumbers]);

  if (!board) {
    return <Text style={{ color: colors.textDim }}>This card has no boards to study.</Text>;
  }

  const styleSet = boardStyles[boardStyle] ?? boardStyles[0];

  // Which colour is being drawn and how far along it is ("Green arrows: 1 of
  // 2"); a wrong arrow is announced here too, where you're looking.
  const activeGroup = colorGroups[groupIdx];
  const groupTotal = activeGroup ? activeGroup.arrows.length : 0;
  const groupDone = groupTotal - remaining.length;
  const colorName = activeGroup ? activeGroup.color[0].toUpperCase() + activeGroup.color.slice(1) : '';
  const statusText = boardDone
    ? 'Board complete!'
    : wrongArrow
      ? 'Wrong arrow — try again'
      : activeGroup
        ? `${colorName} arrows: ${groupDone} of ${groupTotal}`
        : "Draw the plan's arrows";
  const statusColor = boardDone
    ? colors.primary
    : wrongArrow
      ? colors.danger
      : activeGroup
        ? arrowColors[activeGroup.color]
        : colors.textDim;

  return (
    <View style={{ alignItems: 'center', gap: 10 }}>
      {board.back.text ? <Text style={styles.boardText}>{board.back.text}</Text> : null}
      {noArrows ? (
        <View style={styles.warning}>
          <Text style={styles.warningTitle}>
            {boards.length > 1 ? `Board ${boardIdx + 1} / ${boards.length}: ` : ''}No arrows to study
          </Text>
          <Text style={styles.warningText}>
            {'This Plan board has no arrows yet, so there is nothing to draw.\nAdd at least one arrow in the board editor to study it.'}
          </Text>
          {onEditBoard && (
            <Pressable onPress={onEditBoard} style={styles.warningBtn}>
              <Text style={styles.warningBtnText}>Open board editor</Text>
            </Pressable>
          )}
        </View>
      ) : (
        <Text style={[styles.status, { color: statusColor }]}>
          {boards.length > 1 ? `Board ${boardIdx + 1} / ${boards.length} — ` : ''}
          {statusText}
        </Text>
      )}

      <View ref={guideTargets?.board} collapsable={false}>
        <View
          ref={gridRef}
          onLayout={() => measureGrid()}
          style={[styles.board, { width: BOARD_SIZE, height: BOARD_SIZE }]}
          {...panResponder.panHandlers}
        >
          <View style={{ width: BOARD_SIZE, height: BOARD_SIZE, flexDirection: 'row', flexWrap: 'wrap' }}>
            {(flipped ? [...allSquares()].reverse() : allSquares()).map((sq, i) => {
              const file = i % 8;
              const rank = Math.floor(i / 8);
              const isLight = (file + rank) % 2 === 0;
              const piece = board.back.pieces[sq];
              return (
                <View
                  key={sq}
                  style={{ width: CELL, height: CELL, backgroundColor: isLight ? styleSet.light : styleSet.dark, alignItems: 'center', justifyContent: 'center' }}
                >
                  {piece && <PieceGlyph code={piece} cell={CELL} />}
                </View>
              );
            })}
          </View>
          <View style={StyleSheet.absoluteFill} pointerEvents="none">
            <NumberedArrowsSvg arrows={numberedArrows} size={BOARD_SIZE} flipped={flipped} />
            <NumberedArrowBadges arrows={numberedArrows} size={BOARD_SIZE} flipped={flipped} />
            {boardDone && board.back.circles.length > 0 && <CirclesSvg circles={board.back.circles} size={BOARD_SIZE} flipped={flipped} />}
          </View>
        </View>
      </View>

      {noArrows ? null : !allDone ? (
        <>
          <View style={styles.actionRow}>
            <Pressable
              ref={guideTargets?.solution}
              collapsable={false}
              onPress={showSolution}
              disabled={boardDone || Boolean(wrongArrow)}
              style={[styles.actionBtn, styles.solutionBtn, (boardDone || Boolean(wrongArrow)) && styles.actionDisabled]}
            >
              <Text style={styles.solutionText}>Show solution</Text>
            </Pressable>
          </View>
          <Text style={styles.slipNote}>Show solution counts as a slip.</Text>
        </>
      ) : (
        <Pressable
          ref={guideTargets?.continue}
          collapsable={false}
          onPress={() => {
            onGuideEvent?.('continue');
            onResult(mistakes === 0);
          }}
          style={styles.continueBtn}
        >
          <Text style={styles.continueText}>{mistakes === 0 ? '✓ Perfect — continue' : `Continue (${mistakes} slip${mistakes === 1 ? '' : 's'})`}</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  boardText: { color: colors.text, fontSize: 15, lineHeight: 22, textAlign: 'center', paddingHorizontal: 12 },
  status: { color: colors.textDim, fontSize: 13, fontWeight: '600' },
  board: { borderRadius: 6, overflow: 'hidden', borderWidth: 1, borderColor: colors.border },
  warning: {
    alignSelf: 'stretch',
    backgroundColor: colors.panel2,
    borderWidth: 1,
    borderColor: colors.gold,
    borderRadius: radius.md,
    padding: 14,
    gap: 8
  },
  warningTitle: { color: colors.gold, fontSize: 14, fontWeight: '700' },
  warningText: { color: colors.text, fontSize: 13, lineHeight: 19 },
  warningBtn: { alignSelf: 'flex-start', backgroundColor: colors.gold, borderRadius: radius.pill, paddingVertical: 8, paddingHorizontal: 16, marginTop: 2 },
  warningBtnText: { color: colors.onGold, fontSize: 13, fontWeight: '700' },
  slipNote: { color: colors.textDim, fontSize: 12 },
  actionRow: { flexDirection: 'row', gap: 10, alignSelf: 'stretch', paddingHorizontal: 12 },
  actionBtn: { flex: 1, minHeight: touchTarget, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16, borderRadius: radius.pill },
  solutionBtn: { backgroundColor: colors.primary },
  solutionText: { color: colors.onPrimary, fontSize: 13, fontWeight: '700' },
  actionDisabled: { opacity: 0.4 },
  continueBtn: { marginTop: 4, minHeight: touchTarget, justifyContent: 'center', paddingHorizontal: 20, borderRadius: radius.pill, backgroundColor: colors.primary },
  continueText: { color: colors.onPrimary, fontSize: 14, fontWeight: '700' }
});
