import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet, PanResponder, Switch, type PanResponderInstance } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { allSquares, faceAnnotations, flipIndex, squareFromIndex } from '../chess';
import { hasArrowNotes } from '../arrowNotes';
import { ArrowNoteBody } from '../components/ArrowNoteBody';
import { CloseCircleButton } from '../overlay';
import { MoveText } from '../components/MoveText';
import type { Arrow, ArrowColor, Card, PieceCode, ReactionBoard } from '../types';
import { ARROW_COLOR_NAMES, ARROW_COLOR_ORDER, arrowColors, boardStyles, colors, radius, touchTarget } from '../theme';
import { BoardCoords, CirclesSvg, PieceGlyph, NumberedArrowsSvg, NumberedArrowBadges, isOpponentArrow, type NumberedArrow } from '../components/ChessBoard';
import { PIECE_ANIM_DURATION_MS } from '../components/PieceAnimation';
import type { GuideTargets } from '../components/GuideCoach';
import type { CoachEvent } from '../guideContent';
import { ArrowLinkNoteBadges } from './SummaryBoard';
import { openCardViewer } from './CardViewerOverlay';

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

// The order colour groups are asked in: each colour, then its dark tint
// (see theme.ts). Unused colours are skipped.
const COLOR_CYCLE: readonly ArrowColor[] = ARROW_COLOR_ORDER;

// One colour's arrows on a board: the opponent's (dashed) arrows are drawn
// for you the moment the group comes up; your own you draw yourself.
interface ColorGroup {
  color: ArrowColor;
  auto: Arrow[];
  own: Arrow[];
}

// An arrow's Description note, as shown in the popup and in the running
// "seen so far" list below the buttons.
interface ShownNote {
  arrow: Arrow;
  number?: number;
}

const keyOf = (a: Arrow) => `${a.from}-${a.to}-${a.color}`;

function buildColorGroups(arrows: Arrow[], pieces: Partial<Record<string, PieceCode>> | undefined, yourColor: 'w' | 'b'): ColorGroup[] {
  return COLOR_CYCLE.map((color) => {
    const ofColor = arrows.filter((a) => a.color === color);
    return {
      color,
      auto: ofColor.filter((a) => isOpponentArrow(a.from, pieces, yourColor)),
      own: ofColor.filter((a) => !isOpponentArrow(a.from, pieces, yourColor))
    };
  }).filter((g) => g.auto.length + g.own.length > 0);
}

// The badge number an arrow shows in the board editor is its position
// within its own same-color group there (only shown once a color is used
// 2+ times) — keyed by from/to/color so a drawn arrow in Study can look up
// the exact same number instead of just numbering by the order you find
// them in, which would rarely match. Opponent arrows are numbered among
// themselves; threat arrows (Summary) get "!" and no number.
function editorArrowNumbers(arrows: Arrow[], pieces: Partial<Record<string, PieceCode>> | undefined, yourColor: 'w' | 'b'): Map<string, number> {
  const numbered = arrows.filter((a) => !a.notes?.threat);
  const opp = numbered.filter((a) => isOpponentArrow(a.from, pieces, yourColor));
  const own = numbered.filter((a) => !isOpponentArrow(a.from, pieces, yourColor));
  const numbers = new Map<string, number>();
  for (const group of [own, opp]) numberWithinColors(group, numbers);
  return numbers;
}

function numberWithinColors(arrows: Arrow[], numbers: Map<string, number>): void {
  const countByColor: Partial<Record<ArrowColor, number>> = {};
  for (const a of arrows) countByColor[a.color] = (countByColor[a.color] ?? 0) + 1;
  const seenByColor: Partial<Record<ArrowColor, number>> = {};
  for (const a of arrows) {
    const seen = (seenByColor[a.color] = (seenByColor[a.color] ?? 0) + 1);
    if ((countByColor[a.color] ?? 0) > 1) numbers.set(keyOf(a), seen);
  }
}

// Interactive Plan (and Summary) study: the position starts bare and you
// draw the plan's arrows yourself, one colour group at a time in the fixed
// green → dark green → orange → … order. When a group comes up, its dashed
// opponent arrows appear by themselves; you draw your own (order inside a
// group doesn't matter). ‹ › take back / show one arrow, « » a whole group;
// showing counts as a slip once per arrow (never on a Summary, which isn't
// scored). "Show only current colour" hides everything but the group being
// worked on. A Summary also shows link and note badges on drawn arrows.
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
  // ReactionStudy's moves; no drawing, Continue fires itself. `paused`/
  // `onTogglePause` back the preview-only Pause/Play button.
  preview?: boolean;
  paused?: boolean;
  onTogglePause?: () => void;
  // Guide coach hooks (optional): where the popups' spotlights go, and the
  // Show solution press a popup can wait on.
  guideTargets?: GuideTargets;
  onGuideEvent?: (event: CoachEvent) => void;
}) {
  const isSummary = card.mode === 'summary';
  const boards = useMemo(() => [...card.boards].sort((a, b) => a.order - b.order), [card]);
  const [boardIdx, setBoardIdx] = useState(0);
  // Your own arrows found so far, in the order found (shown solutions included).
  const [found, setFound] = useState<Arrow[]>([]);
  // Arrows already shown with › or » — each costs a slip only the first time.
  const revealedRef = useRef<Set<string>>(new Set());
  const [wrongArrow, setWrongArrow] = useState<{ from: string; to: string } | null>(null);
  const [mistakes, setMistakes] = useState(0);
  const [allDone, setAllDone] = useState(false);
  const [tempArrow, setTempArrow] = useState<{ from: string; to: string } | null>(null);
  const [onlyCurrent, setOnlyCurrent] = useState(false);

  // Plan: an arrow's notes pop up the moment it is found and must be
  // dismissed (Got it) before going on. Summary: notes open from the orange
  // badge instead (`summaryNote`), and links from the link badge.
  const [pendingNote, setPendingNote] = useState<ShownNote | null>(null);
  const [shownNotes, setShownNotes] = useState<ShownNote[]>([]);
  const [summaryNote, setSummaryNote] = useState<Arrow | null>(null);
  const containerRef = useRef<View>(null);
  const noteDelayRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function dismissNote() {
    if (!pendingNote) return;
    setShownNotes((prev) => [...prev, pendingNote]);
    setPendingNote(null);
  }

  useEffect(() => {
    if (allDone) onGuideEvent?.('allDone');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allDone]);

  const board: ReactionBoard | undefined = boards[boardIdx];
  if (board && boardRef) boardRef.current = board;

  // A Plan board has one position — `back` holds it, its arrows and circles
  // (the final position's, see chess.ts's faceAnnotations).
  const finalAnnotations = useMemo(() => (board ? faceAnnotations(board.back) : { arrows: [], circles: [] }), [board]);
  const colorGroups = useMemo(
    () => buildColorGroups(finalAnnotations.arrows, board?.back.pieces, yourColor),
    [finalAnnotations, board, yourColor]
  );
  const arrowNumbers = useMemo(
    () => editorArrowNumbers(finalAnnotations.arrows, board?.back.pieces, yourColor),
    [finalAnnotations, board, yourColor]
  );
  const noArrows = colorGroups.length === 0;
  // Every own arrow in study order — what preview and »/› step through.
  const allOwn = useMemo(() => colorGroups.flatMap((g) => g.own), [colorGroups]);

  // Where the board stands, all derived from `found`: the active group is the
  // first one with own arrows still to find; every group up to it shows its
  // opponent arrows. A group with only opponent arrows is passed straight
  // through.
  const foundKeys = useMemo(() => new Set(found.map(keyOf)), [found]);
  let groupIdx = colorGroups.findIndex((g) => g.own.some((a) => !foundKeys.has(keyOf(a))));
  const boardDone = !noArrows && groupIdx === -1;
  if (groupIdx === -1) groupIdx = colorGroups.length - 1;
  const activeGroup = colorGroups[groupIdx];
  const remaining = activeGroup ? activeGroup.own.filter((a) => !foundKeys.has(keyOf(a))) : [];
  const shownAuto = colorGroups.slice(0, groupIdx + 1).flatMap((g) => g.auto);
  const drawnArrows = [...shownAuto, ...found];

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

  // A new board resets the whole exercise.
  useEffect(() => {
    setFound([]);
    revealedRef.current = new Set();
    setWrongArrow(null);
    if (noteDelayRef.current) {
      clearTimeout(noteDelayRef.current);
      noteDelayRef.current = null;
    }
    setPendingNote(null);
    setShownNotes([]);
    setSummaryNote(null);
  }, [colorGroups]);

  function continueToNextBoard() {
    setBoardIdx((i) => i + 1);
  }

  // Only preview (and the very last board, onto the allDone screen) moves on
  // by itself; interactive solving waits for Continue.
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

  // Preview: one more arrow every beat — paused while a note popup is up.
  useEffect(() => {
    if (!preview || paused || noArrows || boardDone || allDone || pendingNote) return;
    const t = setTimeout(() => revealNextPreviewArrow(), PREVIEW_STEP_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preview, paused, noArrows, boardDone, allDone, pendingNote, found.length, allOwn]);

  function noteFor(arrow: Arrow): ShownNote {
    return { arrow, number: arrowNumbers.get(keyOf(arrow)) };
  }

  // Plan only: queue the popup for a found arrow that has notes to read.
  function popNoteFor(arrow: Arrow, delayed: boolean) {
    if (isSummary || !hasArrowNotes(arrow) || !(arrow.notes?.reason || arrow.notes?.next || arrow.notes?.responses?.length)) return;
    if (noteDelayRef.current) {
      clearTimeout(noteDelayRef.current);
      noteDelayRef.current = null;
    }
    if (!delayed) {
      if (pendingNote) dismissNote();
      setPendingNote(noteFor(arrow));
      return;
    }
    noteDelayRef.current = setTimeout(() => {
      noteDelayRef.current = null;
      setPendingNote(noteFor(arrow));
    }, NOTE_PREVIEW_DELAY_MS);
  }

  function revealNextPreviewArrow() {
    const next = allOwn.find((a) => !foundKeys.has(keyOf(a)));
    if (!next) return;
    setFound((prev) => [...prev, next]);
    popNoteFor(next, true);
  }

  function handleDrawnArrow(from: string, to: string) {
    if (preview || !board || boardDone || allDone || wrongArrow || noArrows) return;
    const match = remaining.find((a) => a.from === from && a.to === to);
    if (!match) {
      if (!isSummary) setMistakes((m) => m + 1);
      setWrongArrow({ from, to });
      setTimeout(() => setWrongArrow(null), WRONG_ARROW_SHOW_MS);
      return;
    }
    setFound((prev) => [...prev, match]);
    popNoteFor(match, false);
  }

  // Shows arrows for you; on a Plan each costs one slip, only the first time.
  function reveal(arrows: Arrow[]) {
    if (arrows.length === 0) return;
    let slips = 0;
    for (const a of arrows) {
      if (!revealedRef.current.has(keyOf(a))) {
        revealedRef.current.add(keyOf(a));
        slips++;
      }
    }
    if (!isSummary && slips > 0) setMistakes((m) => m + slips);
    setFound((prev) => [...prev, ...arrows]);
    popNoteFor(arrows[arrows.length - 1], false);
    onGuideEvent?.('solution');
  }

  const blocked = boardDone || allDone || Boolean(wrongArrow) || Boolean(pendingNote) || noArrows;
  // › one more arrow of the current group; » the rest of the current group
  // (or, once it is complete, the whole next group — which is then current).
  const canNext = !blocked && remaining.length > 0;
  function stepNext() {
    if (canNext) reveal([remaining[0]]);
  }
  function stepNextGroup() {
    if (canNext) reveal(remaining);
  }
  // ‹ takes back the last found arrow; « the current group's found arrows,
  // or if there are none yet, the whole previous group.
  const canBack = !allDone && !wrongArrow && !pendingNote && found.length > 0;
  function stepBack() {
    if (!canBack) return;
    setFound((prev) => prev.slice(0, -1));
  }
  function stepBackGroup() {
    if (!canBack) return;
    const inGroup = (a: Arrow, g: ColorGroup | undefined) => !!g && g.own.some((o) => keyOf(o) === keyOf(a));
    const current = boardDone ? colorGroups[colorGroups.length - 1] : activeGroup;
    const target = found.some((a) => inGroup(a, current))
      ? current
      : colorGroups[colorGroups.indexOf(current as ColorGroup) - 1];
    setFound((prev) => prev.filter((a) => !inGroup(a, target)));
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

  // "Show only current colour": just the active group's colour on the board.
  const visibleColor = onlyCurrent && activeGroup ? activeGroup.color : null;
  const visibleArrows = visibleColor ? drawnArrows.filter((a) => a.color === visibleColor) : drawnArrows;
  const visibleCircles = visibleColor ? finalAnnotations.circles.filter((c) => c.color === visibleColor) : finalAnnotations.circles;

  const numberedArrows: NumberedArrow[] = visibleArrows.map((a, i) => ({
    id: `${keyOf(a)}-${i}`,
    from: a.from,
    to: a.to,
    color: arrowColors[a.color],
    ...(a.notes?.threat ? { label: '!' } : { number: arrowNumbers.get(keyOf(a)) })
  }));
  if (wrongArrow) {
    numberedArrows.push({ id: 'wrong', from: wrongArrow.from, to: wrongArrow.to, color: colors.danger });
  } else if (tempArrow) {
    numberedArrows.push({ id: 'preview', from: tempArrow.from, to: tempArrow.to, color: activeGroup ? arrowColors[activeGroup.color] : colors.textDim });
  }

  if (!board) {
    return <Text style={{ color: colors.textDim }}>This card has no boards to study.</Text>;
  }

  const styleSet = boardStyles[boardStyle] ?? boardStyles[0];

  const groupTotal = activeGroup ? activeGroup.own.length : 0;
  const groupDone = groupTotal - remaining.length;
  const colorName = activeGroup ? ARROW_COLOR_NAMES[activeGroup.color] : '';
  const statusText = boardDone
    ? 'Board complete!'
    : wrongArrow
      ? 'Wrong arrow — try again'
      : activeGroup
        ? `${colorName} arrows: ${groupDone} of ${groupTotal}`
        : "Draw the plan's arrows";
  const statusColor = boardDone ? colors.primary : wrongArrow ? colors.danger : activeGroup ? arrowColors[activeGroup.color] : colors.textDim;

  return (
    <View ref={containerRef} collapsable={false} style={{ alignItems: 'center', gap: 10 }}>
      {board.back.text ? <MoveText text={board.back.text} style={styles.boardText} /> : null}
      {noArrows ? (
        <View style={styles.warning}>
          <Text style={styles.warningTitle}>
            {boards.length > 1 ? `Board ${boardIdx + 1} / ${boards.length}: ` : ''}No arrows to study
          </Text>
          <Text style={styles.warningText}>
            {'This board has no arrows yet, so there is nothing to draw.\nAdd at least one arrow in the board editor to study it.'}
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
            <NumberedArrowsSvg arrows={numberedArrows} size={BOARD_SIZE} flipped={flipped} pieces={board.back.pieces} yourColor={yourColor} />
            <NumberedArrowBadges arrows={numberedArrows} size={BOARD_SIZE} flipped={flipped} pieces={board.back.pieces} yourColor={yourColor} />
            {visibleCircles.length > 0 && <CirclesSvg circles={visibleCircles} size={BOARD_SIZE} flipped={flipped} pieces={board.back.pieces} yourColor={yourColor} />}
          </View>
        </View>
        {isSummary && (
          <ArrowLinkNoteBadges
            arrows={visibleArrows}
            size={BOARD_SIZE}
            flipped={flipped}
            onOpenLink={(cardId) => openCardViewer(cardId, yourColor, boardStyle)}
            onShowNote={setSummaryNote}
          />
        )}
      </View>

      {!noArrows && !preview && (
        <View style={styles.onlyRow}>
          <Text style={styles.onlyLabel}>Show only current color</Text>
          <Switch
            value={onlyCurrent}
            onValueChange={setOnlyCurrent}
            trackColor={{ false: colors.panel2, true: colors.primary }}
            thumbColor={colors.textPrimary}
          />
        </View>
      )}

      {summaryNote && (
        <View style={noteStyles.panel}>
          <View style={noteStyles.panelHeader}>
            <ArrowNoteIcon color={arrowColors[summaryNote.color]} number={arrowNumbers.get(keyOf(summaryNote))} size={24} />
            <Text style={noteStyles.panelTitle}>Notes</Text>
            <CloseCircleButton onPress={() => setSummaryNote(null)} />
          </View>
          <ArrowNoteBody notes={summaryNote.notes} accent={arrowColors[summaryNote.color]} />
        </View>
      )}

      {pendingNote && (
        // Under the board (not over it), so the arrow being described stays visible.
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
          <Pressable onPress={stepBack} disabled={found.length === 0} style={[styles.navBtn, found.length === 0 && styles.navBtnDisabled]}>
            <Text style={styles.navBtnText}>‹</Text>
          </Pressable>
          <Pressable onPress={() => onTogglePause?.()} style={styles.navBtn}>
            {paused ? <PlayIcon size={18} color={colors.gold} /> : <PauseIcon size={18} color={colors.gold} />}
          </Pressable>
          <Pressable onPress={revealNextPreviewArrow} disabled={boardDone} style={[styles.navBtn, boardDone && styles.navBtnDisabled]}>
            <Text style={styles.navBtnText}>›</Text>
          </Pressable>
        </View>
      )}

      {!preview && !noArrows && !allDone && (
        // « whole group back · ‹ one arrow back · › show one arrow · » show the group
        <View ref={guideTargets?.solution} collapsable={false} style={styles.navRow}>
          <Pressable onPress={stepBackGroup} disabled={!canBack} style={[styles.navBtn, !canBack && styles.navBtnDisabled]} accessibilityLabel="Take back this colour">
            <Text style={styles.navBtnText}>«</Text>
          </Pressable>
          <Pressable onPress={stepBack} disabled={!canBack} style={[styles.navBtn, !canBack && styles.navBtnDisabled]} accessibilityLabel="Take back one arrow">
            <Text style={styles.navBtnText}>‹</Text>
          </Pressable>
          <Pressable onPress={stepNext} disabled={!canNext} style={[styles.navBtn, !canNext && styles.navBtnDisabled]} accessibilityLabel="Show the next arrow">
            <Text style={styles.navBtnText}>›</Text>
          </Pressable>
          <Pressable onPress={stepNextGroup} disabled={!canNext} style={[styles.navBtn, !canNext && styles.navBtnDisabled]} accessibilityLabel="Show this colour">
            <Text style={styles.navBtnText}>»</Text>
          </Pressable>
        </View>
      )}

      {allDone ? (
        <Pressable
          ref={guideTargets?.continue}
          collapsable={false}
          onPress={() => {
            onGuideEvent?.('continue');
            onResult(preview || isSummary || mistakes === 0);
          }}
          style={styles.continueBtn}
        >
          <Text style={styles.continueText}>
            {preview || isSummary ? 'Continue' : mistakes === 0 ? '✓ Perfect — continue' : `Continue (${mistakes} slip${mistakes === 1 ? '' : 's'})`}
          </Text>
        </Pressable>
      ) : noArrows || preview ? null : boardDone && boardIdx < boards.length - 1 ? (
        <Pressable onPress={continueToNextBoard} style={styles.continueBtn}>
          <Text style={styles.continueText}>Continue</Text>
        </Pressable>
      ) : isSummary ? null : (
        <Text style={styles.slipNote}>› and » show arrows for you; each shown arrow counts as a slip once.</Text>
      )}

      {shownNotes.length > 0 && (
        <View style={noteStyles.list}>
          {shownNotes.map((note, i) => (
            <View key={i} style={noteStyles.listRow}>
              <ArrowNoteIcon color={arrowColors[note.arrow.color]} number={note.number} size={20} />
              <ArrowNoteBody notes={note.arrow.notes} accent={arrowColors[note.arrow.color]} compact style={noteStyles.listBody} />
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
  continueText: { color: colors.onPrimary, fontSize: 14, fontWeight: '700' },
  onlyRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  onlyLabel: { color: colors.textDim, fontSize: 13 }
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
