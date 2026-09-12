import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet, PanResponder, type PanResponderInstance } from 'react-native';
import { allSquares, flipIndex, squareFromIndex } from '../chess';
import type { Arrow, ArrowColor, Card, ReactionBoard } from '../types';
import { arrowColors, boardStyles, colors, radius } from '../theme';
import { CirclesSvg, PieceGlyph, NumberedArrowsSvg, type NumberedArrow } from '../components/ChessBoard';

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
  onResult
}: {
  card: Card;
  yourColor: 'w' | 'b';
  boardStyle: number;
  onResult: (correct: boolean) => void;
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

  const board: ReactionBoard | undefined = boards[boardIdx];
  // A Plan board has one position — `back` is just where it (and its
  // arrows/circles/description) lives, not a second face. Its arrows are
  // the plan you have to reproduce; its circles are decorative context
  // revealed only once the board is solved.
  const colorGroups = useMemo(() => (board ? buildColorGroups(board.back.arrows) : []), [board]);

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

  // A new board resets the whole exercise — start at the first color group
  // (or, defensively, treat a board with no arrows as already done).
  useEffect(() => {
    setGroupIdx(0);
    setRemaining(colorGroups[0]?.arrows ?? []);
    setDrawnArrows([]);
    setWrongArrow(null);
    setBoardDone(colorGroups.length === 0);
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
    if (!board || boardDone || allDone || wrongArrow) return;
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
      color: arrowColors[a.color]
    }));
    if (wrongArrow) {
      list.push({ id: 'wrong', from: wrongArrow.from, to: wrongArrow.to, color: colors.danger });
    } else if (tempArrow) {
      const previewColor = colorGroups[groupIdx] ? arrowColors[colorGroups[groupIdx].color] : colors.textDim;
      list.push({ id: 'preview', from: tempArrow.from, to: tempArrow.to, color: previewColor });
    }
    return list;
  }, [drawnArrows, wrongArrow, tempArrow, colorGroups, groupIdx]);

  if (!board) {
    return <Text style={{ color: colors.textDim }}>This card has no boards to study.</Text>;
  }

  const styleSet = boardStyles[boardStyle] ?? boardStyles[0];

  const statusText = boardDone ? 'Board complete!' : "Draw the plan's arrows";
  const statusColor = boardDone ? colors.primary : colors.textDim;

  return (
    <View style={{ alignItems: 'center', gap: 10 }}>
      {board.back.text ? <Text style={styles.boardText}>{board.back.text}</Text> : null}
      <Text style={[styles.status, { color: statusColor }]}>
        {boards.length > 1 ? `Board ${boardIdx + 1} / ${boards.length} — ` : ''}
        {statusText}
      </Text>

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
          {boardDone && board.back.circles.length > 0 && <CirclesSvg circles={board.back.circles} size={BOARD_SIZE} flipped={flipped} />}
        </View>
      </View>

      {!allDone ? (
        <>
          <View style={styles.actionRow}>
            <Pressable
              onPress={showSolution}
              disabled={boardDone || Boolean(wrongArrow)}
              style={[styles.actionBtn, styles.solutionBtn, (boardDone || Boolean(wrongArrow)) && styles.actionDisabled]}
            >
              <Text style={styles.solutionText}>Show solution</Text>
            </Pressable>
          </View>
          <Text style={[styles.wrongText, !wrongArrow && styles.wrongTextHidden]}>Wrong arrow. Try again.</Text>
        </>
      ) : (
        <Pressable onPress={() => onResult(mistakes === 0)} style={styles.continueBtn}>
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
  wrongText: { color: colors.danger, fontSize: 13, fontWeight: '700' },
  wrongTextHidden: { opacity: 0 },
  actionRow: { flexDirection: 'row', gap: 10 },
  actionBtn: { paddingVertical: 8, paddingHorizontal: 16, borderRadius: radius.pill },
  solutionBtn: { backgroundColor: colors.primary },
  solutionText: { color: colors.onPrimary, fontSize: 13, fontWeight: '700' },
  actionDisabled: { opacity: 0.4 },
  continueBtn: { marginTop: 4, paddingVertical: 12, paddingHorizontal: 20, borderRadius: radius.pill, backgroundColor: colors.primary },
  continueText: { color: colors.onPrimary, fontSize: 14, fontWeight: '700' }
});
