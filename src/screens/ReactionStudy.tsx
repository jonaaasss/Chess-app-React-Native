import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet, Animated, Easing, PanResponder, type PanResponderInstance } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { allSquares, flipIndex, mainLineNodes, squareFromIndex } from '../chess';
import { legalMovesFrom, makeMove, type GameState } from '../chessEngine';
import type { Arrow, Card, Circle, MoveNode, PieceCode } from '../types';
import { boardStyles, colors, radius } from '../theme';
import { ArrowsSvg, CirclesSvg, PieceGlyph, NumberedArrowsSvg, NumberedArrowBadges, type NumberedArrow } from '../components/ChessBoard';
import { usePieceAnimation, PieceAnimationGhosts, PIECE_ANIM_DURATION_MS } from '../components/PieceAnimation';

// Opponent auto-play, board-to-board transitions, and the variant
// walkthrough all wait long enough for the slide animation to fully
// finish, plus a short pause, before moving on — so a move is always
// clearly visible, never cut off by the next one starting.
const AUTO_ADVANCE_DELAY_MS = PIECE_ANIM_DURATION_MS + 300;
const VARIANT_INTRO_MS = 1200;
const VARIANT_REWIND_PAUSE_MS = 1000;
// Stepping back through a variant's moves is a "rewind", not a replay — it
// reads better sped up (75% faster) rather than pacing out at move speed.
const REWIND_STEP_MS = Math.round(AUTO_ADVANCE_DELAY_MS / 1.75);
// A wrong move is actually played out (and animated) so you can see what
// it would have done, then held briefly before sliding back.
const WRONG_MOVE_SHOW_MS = PIECE_ANIM_DURATION_MS + 400;

const BOARD_SIZE = 300;
const CELL = BOARD_SIZE / 8;

function sameArrow(a: Arrow, b: Arrow) {
  return a.from === b.from && a.to === b.to && a.color === b.color;
}
function sameCircle(a: Circle, b: Circle) {
  return a.square === b.square && a.color === b.color;
}

// What's actually visible after `count` moves of `line` have been played:
// the board's own (pre-Play) annotations, then each played move's
// added/removed applied in order — same rule the editor uses, so anything
// drawn while recording shows up at the right moment during Study too.
function activeAnnotationsAt(base: { arrows: Arrow[]; circles: Circle[] }, line: MoveNode[], count: number) {
  let arrows = [...base.arrows];
  let circles = [...base.circles];
  for (let i = 0; i < count; i++) {
    const node = line[i];
    arrows = arrows.filter((a) => !node.removedArrows.some((r) => sameArrow(r, a)));
    circles = circles.filter((c) => !node.removedCircles.some((r) => sameCircle(r, c)));
    arrows = [...arrows, ...node.addedArrows];
    circles = [...circles, ...node.addedCircles];
  }
  return { arrows, circles };
}

// One piece per played move, tagged with whether it was yours to move —
// so the notation can color your own moves apart from the opponent's,
// rather than rendering the whole line as one flat string.
function formatNotationParts(sans: string[], firstIsWhite: boolean, yourColor: 'w' | 'b'): { text: string; isYours: boolean }[] {
  let moveNumber = 1;
  let whiteToMove = firstIsWhite;
  const parts: { text: string; isYours: boolean }[] = [];
  sans.forEach((san, i) => {
    const prefix = whiteToMove ? `${moveNumber}.` : i === 0 ? `${moveNumber}...` : '';
    const text = (prefix ? `${prefix}${san}` : san) + (i < sans.length - 1 ? ' ' : '');
    parts.push({ text, isYours: (whiteToMove ? 'w' : 'b') === yourColor });
    if (!whiteToMove) moveNumber += 1;
    whiteToMove = !whiteToMove;
  });
  return parts;
}

// A thicker, drawn rewind icon (a circular arrow) rather than a Unicode
// glyph, per the established pattern in this app of not trusting font
// glyphs for anything that needs to look intentional.
// Standard "refresh" glyph (a single circular-arrow path, arrowhead flush
// with the arc's end) — swapped in for a hand-built arc+triangle that left
// a visible gap between the circle and its arrowhead.
function RewindIcon({ size, color }: { size: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path
        d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"
        fill={color}
      />
    </Svg>
  );
}

// One level of branching at the position right before `siblings` were
// recorded: every sibling is a candidate "variant", shown as a numbered
// arrow (red, except the current one shown in green), shortest-first.
// Uses the same numbered-arrow style as the board editor's own same-color
// arrow numbering, so the two look identical.
function toVariantArrows(variants: MoveNode[], activeIdx: number): NumberedArrow[] {
  return variants.map((v, i) => ({
    id: v.id,
    from: v.from,
    to: v.to,
    color: i === activeIdx ? colors.primary : colors.danger,
    number: i + 1
  }));
}

// Interactive Reactions study: no flip. The recorded line's opponent moves
// play themselves; on your turn you must find the recorded move. A wrong
// move shows a message and resets your selection. Hint rings the piece to
// move; Show solution plays the recorded move for you. When the line
// branches, all recorded continuations are shown as numbered arrows
// (shortest = 1, green) and walked through one at a time — play it,
// rewind, show the next — before the line resumes on its recorded path.
export function ReactionStudy({
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
  const [ply, setPly] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [wrongMove, setWrongMove] = useState(false);
  const [wrongMovePreview, setWrongMovePreview] = useState<Partial<Record<string, PieceCode>> | null>(null);
  const [hintOn, setHintOn] = useState(false);
  const [mistakes, setMistakes] = useState(0);
  const [allDone, setAllDone] = useState(false);

  // Variant walkthrough state — inert while `variantStage` is 'none'.
  const [shownBranches, setShownBranches] = useState<Set<number>>(new Set());
  const [variantStage, setVariantStage] = useState<'none' | 'intro' | 'playing' | 'rewinding'>('none');
  const [branchPly, setBranchPly] = useState(0);
  const [variantIdx, setVariantIdx] = useState(0);
  const [variantSubPly, setVariantSubPly] = useState(0);
  // Explicitly toggled (not derived from stage/subPly) so every variant —
  // the first and every one after it — turns its numbered arrows on at
  // exactly the same two call sites: on when a variant's intro starts, off
  // the instant its first move actually starts sliding.
  const [variantArrowsVisible, setVariantArrowsVisible] = useState(false);
  const inVariant = variantStage !== 'none';

  // Touch handling for the board uses a PanResponder (grabbing the touch on
  // first contact) rather than per-square Pressable/onPress — inside a
  // ScrollView, onPress waits out a tap-vs-scroll gesture negotiation before
  // firing, which reads as a delay between tapping a square and the piece
  // actually starting to slide. PanResponder claims the touch immediately.
  const gridRef = useRef<View>(null);
  const gridOrigin = useRef({ x: 0, y: 0 });

  function measureGrid(cb?: () => void) {
    gridRef.current?.measureInWindow((x, y) => {
      gridOrigin.current = { x, y };
      cb?.();
    });
  }

  // Cards under a Black repertoire are shown from Black's side — rank 1 at
  // the top, a-file on the right — the same 180° flip everywhere a square
  // is placed on screen or a touch is mapped back to one.
  const flipped = yourColor === 'b';

  function squareFromPage(pageX: number, pageY: number): string | null {
    const file = Math.floor((pageX - gridOrigin.current.x) / CELL);
    const rank = Math.floor((pageY - gridOrigin.current.y) / CELL);
    return squareFromIndex(flipIndex(file, flipped), flipIndex(rank, flipped));
  }

  useEffect(() => {
    measureGrid();
  }, []);

  const board = boards[boardIdx];
  const line = useMemo(() => (board ? mainLineNodes(board.recording) : []), [board]);

  function siblingsAt(n: number): MoveNode[] {
    if (!board) return [];
    return n === 0 ? board.recording : line[n - 1]?.children ?? [];
  }

  const engineState: GameState = useMemo(() => {
    if (!board) return { pieces: {}, turn: 'w', castling: { wK: false, wQ: false, bK: false, bQ: false }, enPassant: null };
    let st: GameState = { pieces: board.pieces, turn: board.turn, castling: board.castling, enPassant: board.enPassant };
    for (let i = 0; i < ply && i < line.length; i++) {
      st = makeMove(st, line[i].from, line[i].to, line[i].promotion).next;
    }
    return st;
  }, [board, line, ply]);

  // Position right before the branch (base for the variant walkthrough).
  const branchState: GameState = useMemo(() => {
    if (!board) return engineState;
    let st: GameState = { pieces: board.pieces, turn: board.turn, castling: board.castling, enPassant: board.enPassant };
    for (let i = 0; i < branchPly && i < line.length; i++) {
      st = makeMove(st, line[i].from, line[i].to, line[i].promotion).next;
    }
    return st;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [board, line, branchPly]);

  // All recorded continuations at this branch, shortest first, for the
  // numbered arrow display. `siblings[0]` is the line's own true
  // continuation — it's excluded from `walkableVariants` (the ones actually
  // played through with a rewind) since resuming the line after the
  // showcase already plays it; walking it here too would just replay the
  // same moves a second time.
  const sortedVariants = useMemo(() => {
    if (!inVariant) return [];
    return [...siblingsAt(branchPly)].sort((a, b) => mainLineNodes([a]).length - mainLineNodes([b]).length);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inVariant, board, line, branchPly]);

  const mainlineSiblingId = board ? siblingsAt(branchPly)[0]?.id : undefined;
  const walkableVariants = useMemo(
    () => sortedVariants.filter((v) => v.id !== mainlineSiblingId),
    [sortedVariants, mainlineSiblingId]
  );

  // Once every walkable variant has been shown, `variantIdx` is pushed one
  // past the end as a sentinel: there's one last arrow flash — the actual
  // recorded continuation (mainlineSiblingId), shown in green exactly like
  // every walkable variant was — before the line resumes on it. Without
  // this, resuming the mainline sibling after the last variant's rewind
  // would skip straight to playing its move with no arrow shown at all.
  const showingMainline = variantIdx >= walkableVariants.length;
  const currentVariant = showingMainline ? undefined : walkableVariants[variantIdx];
  const activeArrowIdx = sortedVariants.findIndex((v) => v.id === (showingMainline ? mainlineSiblingId : currentVariant?.id));
  const variantArrows = useMemo(
    () => toVariantArrows(sortedVariants, activeArrowIdx),
    [sortedVariants, activeArrowIdx]
  );
  const variantLine = useMemo(() => (currentVariant ? mainLineNodes([currentVariant]) : []), [currentVariant]);

  const variantState: GameState = useMemo(() => {
    let st = branchState;
    for (let i = 0; i < variantSubPly && i < variantLine.length; i++) {
      st = makeMove(st, variantLine[i].from, variantLine[i].to, variantLine[i].promotion).next;
    }
    return st;
  }, [branchState, variantLine, variantSubPly]);

  // Whichever position is "live" right now — the main line, or the variant
  // being walked through — drives the board, taps, hint, and solution.
  const activeState = inVariant ? variantState : engineState;
  const activeNextMove = inVariant ? variantLine[variantSubPly] : line[ply];
  const activeMoveColor = activeNextMove ? (activeNextMove.turnAfter === 'w' ? 'b' : 'w') : null;
  const activeIsYourTurn = variantStage === 'playing' ? activeMoveColor === yourColor : inVariant ? false : activeMoveColor === yourColor;
  const activeLineDone = inVariant ? variantSubPly >= variantLine.length : !board || ply >= line.length;

  const { arrows: visibleArrows, circles: visibleCircles } = useMemo(
    () => (board ? activeAnnotationsAt(board, line, inVariant ? branchPly : ply) : { arrows: [], circles: [] }),
    [board, line, ply, inVariant, branchPly]
  );

  const legalTargets = useMemo(
    () => (selected ? legalMovesFrom(activeState, selected) : []),
    [activeState, selected]
  );

  const displayedPieces = wrongMovePreview ?? activeState.pieces;
  const { hiddenSquares, ghosts } = usePieceAnimation(displayedPieces, CELL, flipped);

  const rewindSpin = useRef(new Animated.Value(0)).current;

  // Detect a branch before revealing the next line move; show all recorded
  // continuations instead of just continuing silently.
  useEffect(() => {
    if (inVariant || activeLineDone) return;
    const siblings = siblingsAt(ply);
    if (siblings.length > 1 && !shownBranches.has(ply)) {
      setShownBranches((s) => new Set(s).add(ply));
      setBranchPly(ply);
      setVariantIdx(0);
      setVariantSubPly(0);
      setVariantStage('intro');
      setVariantArrowsVisible(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inVariant, activeLineDone, ply, board]);

  // Auto-play the opponent's moves on the main line.
  useEffect(() => {
    if (inVariant || activeLineDone || activeIsYourTurn) return;
    const t = setTimeout(() => {
      setPly((p) => p + 1);
      setSelected(null);
      setHintOn(false);
    }, AUTO_ADVANCE_DELAY_MS);
    return () => clearTimeout(t);
  }, [inVariant, ply, activeIsYourTurn, activeLineDone]);

  // Board finished → next board, or the whole card is done.
  useEffect(() => {
    if (inVariant || !activeLineDone) return;
    if (boardIdx < boards.length - 1) {
      const t = setTimeout(() => {
        setBoardIdx((i) => i + 1);
        setPly(0);
        setSelected(null);
        setHintOn(false);
        setShownBranches(new Set());
      }, AUTO_ADVANCE_DELAY_MS);
      return () => clearTimeout(t);
    }
    setAllDone(true);
  }, [inVariant, activeLineDone, boardIdx, boards.length]);

  // Variant intro: show the numbered arrows briefly, then either start
  // playing that variant, or — for the sentinel "mainline" flash after the
  // last one — resume the main line directly (there's no separate variant
  // to play/rewind for it; the normal main-line auto-play effect takes it
  // from here once `inVariant` goes false).
  useEffect(() => {
    if (variantStage !== 'intro') return;
    const t = setTimeout(() => {
      if (showingMainline) {
        setVariantStage('none');
        setVariantArrowsVisible(false);
        setPly(branchPly + 1);
      } else {
        setVariantStage('playing');
      }
    }, VARIANT_INTRO_MS);
    return () => clearTimeout(t);
  }, [variantStage, variantIdx, showingMainline, branchPly]);

  // Variant playing: auto-play its opponent moves; when it ends, pause then rewind.
  useEffect(() => {
    if (variantStage !== 'playing') return;
    if (activeLineDone) {
      const t = setTimeout(() => setVariantStage('rewinding'), VARIANT_REWIND_PAUSE_MS);
      return () => clearTimeout(t);
    }
    if (!activeIsYourTurn) {
      const t = setTimeout(() => {
        setVariantSubPly((p) => p + 1);
        setSelected(null);
        setVariantArrowsVisible(false);
      }, AUTO_ADVANCE_DELAY_MS);
      return () => clearTimeout(t);
    }
  }, [variantStage, activeLineDone, activeIsYourTurn]);

  // Spin the rewind icon for as long as the whole rewinding stage lasts —
  // kept in its own effect, keyed only on variantStage, so the loop plays
  // through uninterrupted. Restarting it on every step (as a combined
  // effect keyed on variantSubPly too would) cut the animation off partway
  // through its cycle and snapped it back to 0, reading as a stutter.
  useEffect(() => {
    if (variantStage !== 'rewinding') return;
    rewindSpin.setValue(0);
    const anim = Animated.loop(
      Animated.timing(rewindSpin, { toValue: 1, duration: 900, easing: Easing.linear, useNativeDriver: true })
    );
    anim.start();
    return () => {
      anim.stop();
      rewindSpin.setValue(0);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [variantStage]);

  // Rewinding: step the variant back to the branch one animated move at a
  // time, then move on to the next variant. Sped up relative to normal
  // move pacing since this is a rewind, not a replay.
  useEffect(() => {
    if (variantStage !== 'rewinding') return;
    if (variantSubPly > 0) {
      const t = setTimeout(() => setVariantSubPly((p) => p - 1), REWIND_STEP_MS);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => {
      // Push variantIdx one past the last walkable variant either way — for
      // a variant still left to walk, the next render's `showingMainline`
      // is false and this just selects it; once none are left, it becomes
      // the sentinel that flashes the mainline continuation's own arrow.
      setVariantIdx((i) => i + 1);
      setVariantStage('intro');
      setVariantArrowsVisible(true);
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [variantStage, variantSubPly, variantIdx, walkableVariants.length, branchPly]);

  function handleSquareTap(sq: string) {
    if (inVariant && variantStage !== 'playing') return;
    if (!activeIsYourTurn || activeLineDone || wrongMove) return;
    if (!selected) {
      const p = activeState.pieces[sq];
      if (p && p[0] === activeState.turn) setSelected(sq);
      return;
    }
    if (sq === selected) {
      setSelected(null);
      return;
    }
    if (legalTargets.includes(sq)) {
      if (selected === activeNextMove!.from && sq === activeNextMove!.to) {
        if (inVariant) {
          setVariantSubPly((p) => p + 1);
          setVariantArrowsVisible(false);
        } else {
          setPly((p) => p + 1);
        }
        setSelected(null);
        setHintOn(false);
      } else {
        setWrongMove(true);
        setMistakes((m) => m + 1);
        setWrongMovePreview(makeMove(activeState, selected, sq).next.pieces);
        // Clear the selection right away, not after the preview finishes —
        // otherwise the old piece's move dots/capture ring (including one
        // sitting right on the wrong move's own destination square) stay
        // drawn on top of the preview animation.
        setSelected(null);
        setTimeout(() => setWrongMovePreview(null), WRONG_MOVE_SHOW_MS);
        setTimeout(() => {
          setWrongMove(false);
        }, WRONG_MOVE_SHOW_MS + PIECE_ANIM_DURATION_MS);
      }
      return;
    }
    const p = activeState.pieces[sq];
    setSelected(p && p[0] === activeState.turn ? sq : null);
  }

  function showSolution() {
    if (!activeIsYourTurn || activeLineDone) return;
    if (inVariant) {
      setVariantSubPly((p) => p + 1);
      setVariantArrowsVisible(false);
    } else {
      setPly((p) => p + 1);
    }
    setSelected(null);
    setHintOn(false);
    setMistakes((m) => m + 1);
  }

  // The PanResponder below is created once (via useRef) so claiming the
  // touch doesn't get re-negotiated on every render, but that means its
  // callback would otherwise close over the very first render's
  // handleSquareTap. Routing through a ref kept fresh on every render
  // avoids that staleness.
  const handleSquareTapRef = useRef(handleSquareTap);
  handleSquareTapRef.current = handleSquareTap;

  const panResponderRef = useRef<PanResponderInstance | null>(null);
  if (!panResponderRef.current) {
    panResponderRef.current = PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderGrant: (evt) => {
        const { pageX, pageY } = evt.nativeEvent;
        measureGrid(() => {
          const sq = squareFromPage(pageX, pageY);
          if (sq) handleSquareTapRef.current(sq);
        });
      }
    });
  }
  const panResponder = panResponderRef.current;

  if (!board) {
    return <Text style={{ color: colors.textDim }}>This card has no boards to study.</Text>;
  }

  const styleSet = boardStyles[boardStyle] ?? boardStyles[0];
  const hintCircles = hintOn && activeIsYourTurn && activeNextMove ? [{ square: activeNextMove.from, color: 'green' as const }] : [];
  const playedSans = line.slice(0, ply).map((n) => n.san);
  const notationParts = playedSans.length > 0 ? formatNotationParts(playedSans, line[0].turnAfter === 'b', yourColor) : [];
  const showVariantArrows = variantArrowsVisible;

  // The intro's numbered arrows already say "here are your options" — no
  // need for a redundant "Variation X/Y" label on top; during intro it's
  // always about to be the opponent's reply, so just say that. The
  // mainline flash is also an "intro" of sorts (`activeLineDone` reads true
  // for it since there's no variant line behind it) so it needs the same
  // carve-out to avoid claiming the variation is already "complete".
  const isMainlineFlash = variantStage === 'intro' && showingMainline;
  const statusText = isMainlineFlash
    ? "Opponent's move…"
    : variantStage === 'rewinding'
      ? 'Rewinding…'
      : activeLineDone
        ? inVariant
          ? 'Variation complete'
          : 'Line complete'
        : activeIsYourTurn
          ? 'Your move'
          : "Opponent's move…";
  const statusColor =
    isMainlineFlash || (!activeLineDone && variantStage !== 'rewinding')
      ? activeIsYourTurn
        ? colors.primary
        : colors.danger
      : colors.textDim;

  return (
    <View style={{ alignItems: 'center', gap: 10 }}>
      {board.front.text ? <Text style={styles.boardText}>{board.front.text}</Text> : null}
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
            const piece = displayedPieces[sq];
            const isSel = sq === selected;
            const isTarget = legalTargets.includes(sq);
            const isCapture = isTarget && (Boolean(piece) || (selected && activeState.pieces[selected]?.[1] === 'P' && sq === activeState.enPassant));
            return (
              <View
                key={sq}
                style={{ width: CELL, height: CELL, backgroundColor: isLight ? styleSet.light : styleSet.dark, alignItems: 'center', justifyContent: 'center' }}
              >
                {piece && !hiddenSquares.has(sq) && <PieceGlyph code={piece} cell={CELL} />}
                {isSel && <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.selHighlight]} />}
                {isTarget && !isCapture && <View pointerEvents="none" style={styles.moveDot} />}
                {isCapture && <View pointerEvents="none" style={styles.captureRing} />}
              </View>
            );
          })}
        </View>
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          {showVariantArrows ? (
            <>
              <NumberedArrowsSvg arrows={variantArrows} size={BOARD_SIZE} flipped={flipped} />
              <NumberedArrowBadges arrows={variantArrows} size={BOARD_SIZE} flipped={flipped} />
            </>
          ) : (
            <>
              <ArrowsSvg arrows={visibleArrows} size={BOARD_SIZE} flipped={flipped} />
              <CirclesSvg circles={[...visibleCircles, ...hintCircles]} size={BOARD_SIZE} flipped={flipped} />
            </>
          )}
          <PieceAnimationGhosts ghosts={ghosts} cell={CELL} />
        </View>
        {variantStage === 'rewinding' && (
          <View style={[StyleSheet.absoluteFill, styles.rewindOverlay]} pointerEvents="none">
            <Animated.View
              style={{
                transform: [{ rotate: rewindSpin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }) }]
              }}
            >
              <RewindIcon size={72} color={colors.onPrimary} />
            </Animated.View>
          </View>
        )}
      </View>

      {notationParts.length > 0 ? (
        <Text style={styles.notation}>
          {notationParts.map((part, i) => (
            <Text key={i} style={part.isYours ? styles.notationYours : undefined}>
              {part.text}
            </Text>
          ))}
        </Text>
      ) : null}

      {!allDone ? (
        <>
          <View style={styles.actionRow}>
            <Pressable
              onPress={() => setHintOn(true)}
              disabled={!activeIsYourTurn || activeLineDone || (inVariant && variantStage !== 'playing')}
              style={[styles.actionBtn, styles.hintBtn, (!activeIsYourTurn || activeLineDone) && styles.actionDisabled]}
            >
              <Text style={styles.hintText}>Hint</Text>
            </Pressable>
            <Pressable
              onPress={showSolution}
              disabled={!activeIsYourTurn || activeLineDone || (inVariant && variantStage !== 'playing')}
              style={[styles.actionBtn, styles.solutionBtn, (!activeIsYourTurn || activeLineDone) && styles.actionDisabled]}
            >
              <Text style={styles.solutionText}>Show solution</Text>
            </Pressable>
          </View>
          <Text style={[styles.wrongText, !wrongMove && styles.wrongTextHidden]}>Wrong move. Try again.</Text>
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
  selHighlight: { backgroundColor: 'rgba(21,128,61,0.35)' },
  moveDot: { position: 'absolute', width: CELL * 0.28, height: CELL * 0.28, borderRadius: (CELL * 0.28) / 2, backgroundColor: 'rgba(21,128,61,0.55)' },
  captureRing: { position: 'absolute', width: CELL - 6, height: CELL - 6, borderRadius: (CELL - 6) / 2, borderWidth: 3, borderColor: 'rgba(220,38,38,0.85)' },
  rewindOverlay: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(15,23,42,0.55)'
  },
  notation: { color: colors.textDim, fontSize: 13, textAlign: 'center', paddingHorizontal: 12 },
  notationYours: { color: colors.primary, fontWeight: '700' },
  wrongText: { color: colors.danger, fontSize: 13, fontWeight: '700' },
  wrongTextHidden: { opacity: 0 },
  actionRow: { flexDirection: 'row', gap: 10 },
  actionBtn: { paddingVertical: 8, paddingHorizontal: 16, borderRadius: radius.pill },
  hintBtn: { backgroundColor: colors.gold },
  hintText: { color: colors.onGold, fontSize: 13, fontWeight: '700' },
  solutionBtn: { backgroundColor: colors.primary },
  solutionText: { color: colors.onPrimary, fontSize: 13, fontWeight: '700' },
  actionDisabled: { opacity: 0.4 },
  continueBtn: { marginTop: 4, paddingVertical: 12, paddingHorizontal: 20, borderRadius: radius.pill, backgroundColor: colors.primary },
  continueText: { color: colors.onPrimary, fontSize: 14, fontWeight: '700' }
});
