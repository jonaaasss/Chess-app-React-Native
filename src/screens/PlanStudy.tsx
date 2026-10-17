import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet, PanResponder, type PanResponderInstance } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { allSquares, faceAnnotations, flipIndex, squareFromIndex } from '../chess';
import { hasArrowNotes } from '../arrowNotes';
import { ArrowNoteBody } from '../components/ArrowNoteBody';
import { CloseCircleButton } from '../overlay';
import { MoveText } from '../components/MoveText';
import type { Arrow, ArrowColor, Card, ReactionBoard } from '../types';
import { arrowColors, boardStyles, colors, radius, touchTarget } from '../theme';
import { BoardCoords, CirclesSvg, PieceGlyph, NumberedArrowsSvg, NumberedArrowBadges, type NumberedArrow } from '../components/ChessBoard';
import { PIECE_ANIM_DURATION_MS } from '../components/PieceAnimation';
import type { GuideTargets } from '../components/GuideCoach';
import type { CoachEvent } from '../guideContent';

// Same pace as ReactionStudy's opponent/preview moves, so an arrow appearing
// here and a piece sliding there feel like the same tempo.
const PREVIEW_STEP_MS = PIECE_ANIM_DURATION_MS + 300;

// How long a preview-revealed arrow sits on its own, unannounced, before its
// note popup appears — long enough to register "that's the arrow", short of
// feeling like a separate wait.
const NOTE_PREVIEW_DELAY_MS = 500;

// Drawn, not the '⏸'/'▶' text glyphs — Android renders those as colour
// emoji (inconsistently between the two), overriding whatever text color is
// set. A path always comes out exactly `color`, matching between both.
function PauseIcon({ size, color }: { size: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M6 5h4v14H6zM14 5h4v14h-4z" fill={color} />
    </Svg>
  );
}

function PlayIcon({ size, color }: { size: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M8 5v14l11-7z" fill={color} />
    </Svg>
  );
}

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

// An arrow's Description note, as shown in the popup and in the running
// "seen so far" list below the buttons.
interface ShownNote {
  arrow: Arrow;
  number?: number;
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
  preview,
  paused,
  onTogglePause,
  guideTargets,
  onGuideEvent
}: {
  card: Card;
  yourColor: 'w' | 'b';
  boardStyle: number;
  onResult: (correct: boolean) => void;
  boardRef?: React.MutableRefObject<ReactionBoard | null>;
  onEditBoard?: () => void;
  // Passive preview: arrows appear one at a time by themselves, same pace as
  // ReactionStudy's moves, then the circles; no drawing, Continue fires
  // itself. `paused`/`onTogglePause` back the preview-only Pause/Play button
  // — parent-owned, same pattern as ReactionStudy's.
  preview?: boolean;
  paused?: boolean;
  onTogglePause?: () => void;
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

  // An arrow's Description note (set in the board editor) pops up the
  // instant that arrow is drawn or revealed — in preview or while solving —
  // and has to be dismissed before anything else can happen, same as a
  // "you got it wrong" flash blocks the next attempt. Dismissing it commits
  // straight to `shownNotes` (see dismissNote). Both reset alongside the other per-board state below.
  const [pendingNote, setPendingNote] = useState<ShownNote | null>(null);
  const [shownNotes, setShownNotes] = useState<ShownNote[]>([]);
  const containerRef = useRef<View>(null);
  // The in-flight "show the note after a beat" timer (see
  // revealNextPreviewArrow) — tracked so a board change, or another arrow
  // landing before it fires, can cancel it instead of popping up late/stale.
  const noteDelayRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Dismissing the popup (Got it or the cross) moves the note straight into
  // the list below the board, no transition.
  function dismissNote() {
    if (!pendingNote) return;
    setShownNotes((prev) => [...prev, pendingNote]);
    setPendingNote(null);
  }

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
  // arrows/circles/description) lives, not a second face. Its arrows are the
  // plan you have to reproduce; its circles are context shown alongside it
  // throughout. Both are the *final* position's — the one the board's own
  // moves actually built (see chess.ts's faceAnnotations) — not position 0's,
  // in case the board was set up by playing moves first.
  const finalAnnotations = useMemo(() => (board ? faceAnnotations(board.back) : { arrows: [], circles: [] }), [board]);
  const colorGroups = useMemo(() => buildColorGroups(finalAnnotations.arrows), [finalAnnotations]);
  const arrowNumbers = useMemo(() => editorArrowNumbers(finalAnnotations.arrows), [finalAnnotations]);
  // Nothing to reproduce — the board can't be studied at all, which is a
  // problem to fix in the editor, not a board to quietly count as solved.
  const noArrows = colorGroups.length === 0;
  const allArrows = useMemo(() => colorGroups.flatMap((g) => g.arrows), [colorGroups]);

  // Preview: sets exactly how many arrows are "found" (`drawnArrows.length`
  // is that count already, so it needs no state of its own) by recomputing
  // the same group/remaining/boardDone state the interactive solving path
  // already renders from — Next/Previous/the auto-advance timer all just
  // call this with one more or fewer than `drawnArrows.length`. The circles
  // need no separate step: they're already tied to `boardDone`, which this
  // sets the instant the last arrow lands, same as solving it by hand does.
  function applyPreviewCount(n: number) {
    const clamped = Math.max(0, Math.min(n, allArrows.length));
    setDrawnArrows(allArrows.slice(0, clamped));
    let count = 0;
    let gIdx = 0;
    for (; gIdx < colorGroups.length - 1; gIdx++) {
      if (count + colorGroups[gIdx].arrows.length > clamped) break;
      count += colorGroups[gIdx].arrows.length;
    }
    setGroupIdx(gIdx);
    setRemaining(colorGroups[gIdx] ? colorGroups[gIdx].arrows.slice(clamped - count) : []);
    setBoardDone(clamped >= allArrows.length && allArrows.length > 0);
  }

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
    if (noteDelayRef.current) {
      clearTimeout(noteDelayRef.current);
      noteDelayRef.current = null;
    }
    setPendingNote(null);
    setShownNotes([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [colorGroups]);

  function continueToNextBoard() {
    setBoardIdx((i) => i + 1);
    setBoardDone(false);
  }

  // Automatic (timer-driven) advancing only still happens for preview — it's
  // the whole point there — or for the very last board, which only ever
  // lands on the allDone screen's own "Continue", not straight into quizzing
  // another board unasked. Any other board finishing during interactive
  // solving waits for an explicit tap instead (see the Continue button
  // below, replacing Show solution once boardDone).
  //
  // Held off entirely while a note popup is up
  // (see revealNextPreviewArrow/dismissNote) — the board switch this does
  // would otherwise reset the whole per-board note state (next effect
  // down) out from under it: the popup vanishing unconfirmed. Once the note clears,
  // this re-runs and schedules fresh from here.
  useEffect(() => {
    if (!boardDone || pendingNote) return;
    const isLast = boardIdx >= boards.length - 1;
    if (!preview && !isLast) return;
    const t = setTimeout(() => {
      if (isLast) setAllDone(true);
      else continueToNextBoard();
    }, BOARD_DONE_PAUSE_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardDone, boardIdx, boards.length, pendingNote, preview]);

  // Preview: one more arrow every beat, same pace as ReactionStudy's moves —
  // paused while a note popup is up, same as an explicit Pause.
  useEffect(() => {
    if (!preview || paused || noArrows || boardDone || allDone || pendingNote) return;
    const t = setTimeout(() => revealNextPreviewArrow(), PREVIEW_STEP_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preview, paused, noArrows, boardDone, allDone, pendingNote, drawnArrows.length, allArrows]);

  // Reveals exactly one more arrow (auto-advance or the manual "›" button)
  // and, if it carries a Description, queues the popup for it a beat later —
  // never on the way back ("‹"), which is just review.
  function revealNextPreviewArrow() {
    const next = allArrows[drawnArrows.length];
    applyPreviewCount(drawnArrows.length + 1);
    if (noteDelayRef.current) {
      clearTimeout(noteDelayRef.current);
      noteDelayRef.current = null;
    }
    if (next && hasArrowNotes(next)) {
      noteDelayRef.current = setTimeout(() => {
        noteDelayRef.current = null;
        setPendingNote(noteFor(next));
      }, NOTE_PREVIEW_DELAY_MS);
    }
  }

  function noteFor(arrow: Arrow): ShownNote {
    return { arrow, number: arrowNumbers.get(`${arrow.from}-${arrow.to}-${arrow.color}`) };
  }

  function handleDrawnArrow(from: string, to: string) {
    if (preview || !board || boardDone || allDone || wrongArrow || noArrows) return;
    const matchIdx = remaining.findIndex((a) => a.from === from && a.to === to);
    if (matchIdx === -1) {
      setMistakes((m) => m + 1);
      setWrongArrow({ from, to });
      setTimeout(() => setWrongArrow(null), WRONG_ARROW_SHOW_MS);
      return;
    }
    const matched = remaining[matchIdx];
    setDrawnArrows((prev) => [...prev, matched]);
    // A correct arrow drawn while a note is still showing counts as "Got it"
    // — the old note moves into the list, and this arrow's own note (if any)
    // takes its place below.
    if (pendingNote) dismissNote();
    if (hasArrowNotes(matched)) setPendingNote(noteFor(matched));
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
    if (!board || boardDone || allDone || wrongArrow || remaining.length === 0 || pendingNote) return;
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
    <View ref={containerRef} collapsable={false} style={{ alignItems: 'center', gap: 10 }}>
      {board.back.text ? <MoveText text={board.back.text} style={styles.boardText} /> : null}
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
          <BoardCoords size={BOARD_SIZE} flipped={flipped} styleSet={styleSet} />
          <View style={StyleSheet.absoluteFill} pointerEvents="none">
            <NumberedArrowsSvg arrows={numberedArrows} size={BOARD_SIZE} flipped={flipped} />
            <NumberedArrowBadges arrows={numberedArrows} size={BOARD_SIZE} flipped={flipped} />
            {finalAnnotations.circles.length > 0 && <CirclesSvg circles={finalAnnotations.circles} size={BOARD_SIZE} flipped={flipped} />}
          </View>
        </View>
      </View>

      {pendingNote && (
        // Sits right under the board (not over it), so the arrow being
        // described stays visible while you read — opaque, since the board
        // no longer needs to show through. Dismissed with Got it, the cross, or by
        // drawing the next correct arrow (see handleDrawnArrow).
        <View style={noteStyles.panel}>
          <View style={noteStyles.panelHeader}>
            <ArrowNoteIcon color={arrowColors[pendingNote.arrow.color]} number={pendingNote.number} size={24} />
            <Text style={noteStyles.panelTitle}>Notes</Text>
            <CloseCircleButton onPress={dismissNote} />
          </View>
          <ArrowNoteBody notes={pendingNote.arrow.notes} accent={arrowColors[pendingNote.arrow.color]} />
          <Pressable onPress={dismissNote} style={noteStyles.panelBtn}>
            <Text style={noteStyles.panelBtnText}>Got it</Text>
          </Pressable>
        </View>
      )}

      {preview && !noArrows && !pendingNote && (
        <View style={styles.navRow}>
          <Pressable
            onPress={() => applyPreviewCount(drawnArrows.length - 1)}
            disabled={drawnArrows.length === 0}
            style={[styles.navBtn, drawnArrows.length === 0 && styles.navBtnDisabled]}
          >
            <Text style={styles.navBtnText}>‹</Text>
          </Pressable>
          <Pressable onPress={() => onTogglePause?.()} style={styles.navBtn}>
            {paused ? <PlayIcon size={18} color={colors.gold} /> : <PauseIcon size={18} color={colors.gold} />}
          </Pressable>
          <Pressable
            onPress={revealNextPreviewArrow}
            disabled={drawnArrows.length >= allArrows.length}
            style={[styles.navBtn, drawnArrows.length >= allArrows.length && styles.navBtnDisabled]}
          >
            <Text style={styles.navBtnText}>›</Text>
          </Pressable>
        </View>
      )}

      {allDone ? (
        <Pressable
          ref={guideTargets?.continue}
          collapsable={false}
          onPress={() => {
            onGuideEvent?.('continue');
            onResult(preview || mistakes === 0);
          }}
          style={styles.continueBtn}
        >
          <Text style={styles.continueText}>
            {preview ? 'Continue' : mistakes === 0 ? '✓ Perfect — continue' : `Continue (${mistakes} slip${mistakes === 1 ? '' : 's'})`}
          </Text>
        </Pressable>
      ) : noArrows || preview ? null : boardDone && boardIdx < boards.length - 1 ? (
        // This board is done but the card isn't — interactive solving never
        // jumps to the next board on its own (unlike preview, see the
        // auto-advance effect above); it waits here instead.
        <Pressable onPress={continueToNextBoard} style={styles.continueBtn}>
          <Text style={styles.continueText}>Continue</Text>
        </Pressable>
      ) : pendingNote ? null : (
        <>
          <View style={styles.actionRow}>
            <Pressable
              ref={guideTargets?.solution}
              collapsable={false}
              onPress={showSolution}
              disabled={boardDone || Boolean(wrongArrow) || Boolean(pendingNote)}
              style={[styles.actionBtn, styles.solutionBtn, (boardDone || Boolean(wrongArrow) || Boolean(pendingNote)) && styles.actionDisabled]}
            >
              <Text style={styles.solutionText}>Show solution</Text>
            </Pressable>
          </View>
          <Text style={styles.slipNote}>Show solution counts as a slip.</Text>
        </>
      )}

      {shownNotes.length > 0 && (
        <View style={noteStyles.list}>
          {shownNotes.map((note, i) => (
            <View key={i} style={noteStyles.listRow}>
              <ArrowNoteIcon color={arrowColors[note.arrow.color]} number={note.number} size={20} />
              <ArrowNoteBody
                notes={note.arrow.notes}
                accent={arrowColors[note.arrow.color]}
                compact
                style={noteStyles.listBody}
              />
            </View>
          ))}
        </View>
      )}


    </View>
  );
}

// A small colored circle matching the arrow's own color, with its badge
// number inside when it has one — the same visual language as the board's
// numbered-arrow badges, so a list entry reads as "that arrow" at a glance.
function ArrowNoteIcon({ color, number, size }: { color: string; number?: number; size: number }) {
  return (
    <View style={[noteStyles.icon, { width: size, height: size, borderRadius: size / 2, backgroundColor: color }]}>
      {number !== undefined && <Text style={noteStyles.iconText}>{number}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  navRow: { flexDirection: 'row', gap: 10 },
  navBtn: { width: touchTarget, height: touchTarget, borderRadius: 10, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.panel2, alignItems: 'center', justifyContent: 'center' },
  navBtnDisabled: { opacity: 0.4 },
  navBtnText: { color: colors.text, fontSize: 18 },
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

const noteStyles = StyleSheet.create({
  icon: { alignItems: 'center', justifyContent: 'center' },
  iconText: { color: '#fff', fontSize: 10, fontWeight: '700' },
  list: { alignSelf: 'stretch', paddingHorizontal: 12, gap: 10, marginTop: 4 },
  listRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  listBody: { flex: 1 },
  panel: {
    alignSelf: 'stretch',
    marginHorizontal: 12,
    backgroundColor: colors.panel2,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    gap: 14
  },
  panelHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  panelTitle: { color: colors.text, fontSize: 16, fontWeight: '700', flex: 1 },
  panelBtn: { alignSelf: 'stretch', minHeight: touchTarget, alignItems: 'center', justifyContent: 'center', borderRadius: radius.pill, backgroundColor: colors.primary },
  panelBtnText: { color: colors.onPrimary, fontSize: 14, fontWeight: '700' }
});
