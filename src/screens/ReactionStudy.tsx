import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet, Animated, Easing, PanResponder, type PanResponderInstance } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { allSquares, flipIndex, mainLineNodes, squareFromIndex } from '../chess';
import { legalMovesFrom, makeMove, type GameState } from '../chessEngine';
import type { Arrow, Card, Circle, MoveNode, PieceCode, ReactionBoard } from '../types';
import { boardStyles, colors, radius, touchTarget } from '../theme';
import { ArrowsSvg, CirclesSvg, PieceGlyph, NumberedArrowsSvg, NumberedArrowBadges, type NumberedArrow } from '../components/ChessBoard';
import { usePieceAnimation, PieceAnimationGhosts, PIECE_ANIM_DURATION_MS } from '../components/PieceAnimation';
import type { GuideTargets } from '../components/GuideCoach';
import type { CoachEvent } from '../guideContent';

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
// arrow (red, except the current one shown in green). The number is the
// order they're walked through in, so the arrow that plays first is 1 —
// which means the recorded main line, always walked last, is the highest
// number here (unlike in the board editor, where it's 1).
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
  onResult,
  boardRef,
  paused,
  guideTargets,
  onGuideEvent
}: {
  card: Card;
  yourColor: 'w' | 'b';
  boardStyle: number;
  onResult: (correct: boolean) => void;
  boardRef?: React.MutableRefObject<ReactionBoard | null>;
  // Guide coach hooks (all optional): `paused` freezes the automatic parts
  // (opponent auto-play, variant walkthrough) while a popup is up;
  // `guideTargets` are where the popups' spotlights go; `onGuideEvent`
  // reports the moments/presses the popups wait on.
  paused?: boolean;
  guideTargets?: GuideTargets;
  onGuideEvent?: (event: CoachEvent) => void;
}) {
  const boards = useMemo(() => [...card.boards].sort((a, b) => a.order - b.order), [card]);
  const [boardIdx, setBoardIdx] = useState(0);
  const [ply, setPly] = useState(0);
  // Set only while the prev/next buttons have pulled the board back to
  // review an earlier position; null means "live" (showing `ply`, the true
  // progress driving auto-play/solving). What's displayed is derived from
  // the two below rather than kept as its own synced state — an earlier
  // version mirrored `ply` into a separate state via an effect, and its
  // state-updater read a ref that had already been overwritten by the time
  // React ran it, so the board could stay stuck on the previous position
  // after a move.
  const [reviewPly, setReviewPly] = useState<number | null>(null);
  const viewPly = reviewPly ?? ply;
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

  // Lets the Edit button (in the parent study session chrome) jump straight
  // into whichever board is actually on screen right now, instead of just
  // opening the card and making you find/open the right board yourself.
  // Written directly during render (not a useEffect, which only runs after
  // paint and left a real gap where a fast Edit tap could still read the
  // previous board, or null right after mount) — safe here since it's a
  // plain ref write with no read-back that could affect this render's
  // output.
  if (board && boardRef) boardRef.current = board;

  function siblingsAt(n: number): MoveNode[] {
    if (!board) return [];
    return n === 0 ? board.recording : line[n - 1]?.children ?? [];
  }

  // Driven by `viewPly`, not `ply` — the position actually shown/interacted
  // with, which is the live position unless the prev/next buttons have
  // stepped it back to review an earlier one (see `viewPly`'s declaration).
  const engineState: GameState = useMemo(() => {
    if (!board) return { pieces: {}, turn: 'w', castling: { wK: false, wQ: false, bK: false, bQ: false }, enPassant: null };
    let st: GameState = { pieces: board.pieces, turn: board.turn, castling: board.castling, enPassant: board.enPassant };
    for (let i = 0; i < viewPly && i < line.length; i++) {
      st = makeMove(st, line[i].from, line[i].to, line[i].promotion).next;
    }
    return st;
  }, [board, line, viewPly]);

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

  // All recorded continuations at this branch, shortest first. `siblings[0]`
  // is the line's own true continuation — it's excluded from
  // `walkableVariants` (the ones actually played through with a rewind)
  // since resuming the line after the showcase already plays it; walking it
  // here too would just replay the same moves a second time.
  const sortedVariants = useMemo(() => {
    if (!inVariant) return [];
    return [...siblingsAt(branchPly)].sort((a, b) => mainLineNodes([a]).length - mainLineNodes([b]).length);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inVariant, board, line, branchPly]);

  const mainlineSibling = board ? siblingsAt(branchPly)[0] : undefined;
  const walkableVariants = useMemo(
    () => sortedVariants.filter((v) => v.id !== mainlineSibling?.id),
    [sortedVariants, mainlineSibling]
  );

  // The order the variants are actually walked in — every walkable variant
  // (shortest first), then the line's own true continuation last (it's always
  // shown last, once the showcase resumes the main line). The numbered arrows
  // follow this order exactly, so each number is the order it's shown in.
  const orderedVariants = useMemo(
    () => (mainlineSibling ? [...walkableVariants, mainlineSibling] : walkableVariants),
    [walkableVariants, mainlineSibling]
  );

  // Once every walkable variant has been shown, `variantIdx` is pushed one
  // past the end as a sentinel: there's one last arrow flash — the actual
  // recorded continuation (mainlineSibling), shown in green exactly like
  // every walkable variant was — before the line resumes on it. Without
  // this, resuming the mainline sibling after the last variant's rewind
  // would skip straight to playing its move with no arrow shown at all.
  const showingMainline = variantIdx >= walkableVariants.length;
  // The mainline sentinel is walked through the exact same 'playing' stage
  // as every other variant (see the two effects below) rather than a
  // bespoke "just jump ply forward" shortcut — that shortcut used to mark
  // the move as already played without it ever actually happening (no
  // animation, and if it was your move to find, no chance to find it).
  // Reusing the real playing/tap/auto-play machinery is what variants 1
  // and 2 already rely on successfully.
  const currentVariant = showingMainline ? mainlineSibling : walkableVariants[variantIdx];
  const activeArrowIdx = orderedVariants.findIndex((v) => v.id === currentVariant?.id);
  const variantArrows = useMemo(
    () => toVariantArrows(orderedVariants, activeArrowIdx),
    [orderedVariants, activeArrowIdx]
  );
  // A real variant's showcase plays out its whole recorded subtree; the
  // mainline sentinel must stop after exactly its one move — the rest of
  // the line resumes through the normal ply-based flow (with its own
  // branch detection), not through this one-off showcase.
  const variantLine = useMemo(
    () => (currentVariant ? (showingMainline ? [currentVariant] : mainLineNodes([currentVariant])) : []),
    [currentVariant, showingMainline]
  );

  const variantState: GameState = useMemo(() => {
    let st = branchState;
    for (let i = 0; i < variantSubPly && i < variantLine.length; i++) {
      st = makeMove(st, variantLine[i].from, variantLine[i].to, variantLine[i].promotion).next;
    }
    return st;
  }, [branchState, variantLine, variantSubPly]);

  // Whichever position is "live" right now — the main line, or the variant
  // being walked through — drives taps, hint, and solution; these stay tied
  // to the true `ply`/`variantSubPly` regardless of what's being reviewed,
  // since reviewing an earlier position is never itself a solving
  // opportunity (see `isReviewing` below, which gates taps/hint/solution).
  const activeState = inVariant ? variantState : engineState;
  const activeNextMove = inVariant ? variantLine[variantSubPly] : line[ply];
  const activeMoveColor = activeNextMove ? (activeNextMove.turnAfter === 'w' ? 'b' : 'w') : null;
  const activeIsYourTurn = variantStage === 'playing' ? activeMoveColor === yourColor : inVariant ? false : activeMoveColor === yourColor;
  const activeLineDone = inVariant ? variantSubPly >= variantLine.length : !board || ply >= line.length;
  // True while the prev/next buttons have stepped the board back to an
  // earlier position — taps, Hint and Show solution are all suspended
  // until you step back to the live position (or it catches back up to you).
  const isReviewing = !inVariant && viewPly !== ply;

  // Guide coach: the two moments its popups can wait on.
  const yourTurnNow =
    activeIsYourTurn && !activeLineDone && !isReviewing && (!inVariant || variantStage === 'playing');
  useEffect(() => {
    if (yourTurnNow) onGuideEvent?.('yourTurn');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [yourTurnNow]);
  useEffect(() => {
    if (variantStage === 'intro') onGuideEvent?.('branchIntro');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [variantStage]);
  // The card is finished and its Continue button is on screen.
  useEffect(() => {
    if (allDone) onGuideEvent?.('allDone');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allDone]);

  const { arrows: visibleArrows, circles: visibleCircles } = useMemo(
    () => (board ? activeAnnotationsAt(board, line, inVariant ? branchPly : viewPly) : { arrows: [], circles: [] }),
    [board, line, viewPly, inVariant, branchPly]
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
    if (inVariant || activeLineDone || activeIsYourTurn || paused) return;
    const t = setTimeout(() => {
      setPly((p) => p + 1);
      setSelected(null);
      setHintOn(false);
    }, AUTO_ADVANCE_DELAY_MS);
    return () => clearTimeout(t);
  }, [inVariant, ply, activeIsYourTurn, activeLineDone, paused]);

  // Board finished → next board, or the whole card is done. Held off
  // entirely while reviewing (see `isReviewing`) — stepping back to look at
  // the completed line must actually give time to look at it, not just
  // delay the inevitable by `AUTO_ADVANCE_DELAY_MS`. Returning to the live
  // position (or letting it catch back up) re-triggers this effect and the
  // advance proceeds from there.
  useEffect(() => {
    if (inVariant || !activeLineDone || isReviewing) return;
    if (boardIdx < boards.length - 1) {
      const t = setTimeout(() => {
        setBoardIdx((i) => i + 1);
        setPly(0);
        setReviewPly(null);
        setSelected(null);
        setHintOn(false);
        setShownBranches(new Set());
      }, AUTO_ADVANCE_DELAY_MS);
      return () => clearTimeout(t);
    }
    setAllDone(true);
  }, [inVariant, activeLineDone, isReviewing, boardIdx, boards.length]);

  // Variant intro: show the numbered arrows briefly, then start playing —
  // uniformly for a real variant and for the mainline sentinel alike (see
  // `variantLine`/the playing effect below for how the sentinel's single
  // move gets committed instead of rewound).
  useEffect(() => {
    if (variantStage !== 'intro' || paused) return;
    const t = setTimeout(() => setVariantStage('playing'), VARIANT_INTRO_MS);
    return () => clearTimeout(t);
  }, [variantStage, paused]);

  // Variant playing: auto-play its opponent moves; when it ends, either
  // pause then rewind (a real, truly-alternate variant) or — for the
  // mainline sentinel, which is never rewound — pause then commit its move
  // straight into the real `ply` and exit variant mode, letting the normal
  // ply-based flow (with its own branch detection) resume from there.
  useEffect(() => {
    if (variantStage !== 'playing' || paused) return;
    if (activeLineDone) {
      if (showingMainline) {
        const t = setTimeout(() => {
          setVariantStage('none');
          setVariantArrowsVisible(false);
          setPly(branchPly + variantLine.length);
        }, VARIANT_REWIND_PAUSE_MS);
        return () => clearTimeout(t);
      }
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
  }, [variantStage, activeLineDone, activeIsYourTurn, showingMainline, branchPly, variantLine.length, paused]);

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
    if (isReviewing || !activeIsYourTurn || activeLineDone || wrongMove) return;
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
    if (isReviewing || !activeIsYourTurn || activeLineDone) return;
    if (inVariant) {
      setVariantSubPly((p) => p + 1);
      setVariantArrowsVisible(false);
    } else {
      setPly((p) => p + 1);
    }
    setSelected(null);
    setHintOn(false);
    setMistakes((m) => m + 1);
    onGuideEvent?.('solution');
  }

  // Prev/next let you step back through the main line to review an earlier
  // position (and forward again, up to the live position) — inert during
  // the variant walkthrough, which is its own fully automatic showcase.
  const canStepReview = !inVariant;
  const canGoPrev = canStepReview && viewPly > 0;
  const canGoNext = canStepReview && viewPly < ply;

  function handlePrevMove() {
    if (!canGoPrev) return;
    setReviewPly(viewPly - 1);
    setSelected(null);
    setHintOn(false);
  }

  function handleNextMove() {
    if (!canGoNext) return;
    // Stepping forward onto the live position means you're no longer
    // reviewing — back to null so the view follows `ply` again.
    setReviewPly(viewPly + 1 >= ply ? null : viewPly + 1);
    setSelected(null);
    setHintOn(false);
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
  const playedSans = line.slice(0, viewPly).map((n) => n.san);
  const notationParts = playedSans.length > 0 ? formatNotationParts(playedSans, line[0].turnAfter === 'b', yourColor) : [];
  const showVariantArrows = variantArrowsVisible;

  // `activeIsYourTurn` is forced false during 'intro' (see its definition)
  // regardless of whose move is about to be shown, so this already reads
  // "Opponent's move…" throughout every intro flash — a real variant's and
  // the mainline sentinel's alike — without needing a special case for
  // either.
  const statusText =
    variantStage === 'rewinding'
      ? 'Rewinding…'
      : activeLineDone
        ? inVariant
          ? 'Variation complete'
          : 'Line complete'
        : activeIsYourTurn
          ? 'Your move'
          : "Opponent's move…";
  const statusColor =
    !activeLineDone && variantStage !== 'rewinding'
      ? activeIsYourTurn
        ? colors.primary
        : colors.textDim
      : colors.textDim;

  return (
    <View style={{ alignItems: 'center', gap: 10 }}>
      {board.front.text ? <Text style={styles.boardText}>{board.front.text}</Text> : null}
      <Text style={[styles.status, { color: statusColor }]}>
        {boards.length > 1 ? `Board ${boardIdx + 1} / ${boards.length} — ` : ''}
        {statusText}
      </Text>

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
      </View>

      {/* Step back/forward through the main line to review it — always
          shown, including once the line is complete or the whole card is
          done, since reviewing what just happened is exactly when this is
          most useful. Inert during the variant walkthrough, which is its
          own automatic showcase. */}
      <View style={styles.navRow}>
        <Pressable onPress={handlePrevMove} disabled={!canGoPrev} style={[styles.navBtn, !canGoPrev && styles.navBtnDisabled]}>
          <Text style={styles.navBtnText}>‹</Text>
        </Pressable>
        <Pressable onPress={handleNextMove} disabled={!canGoNext} style={[styles.navBtn, !canGoNext && styles.navBtnDisabled]}>
          <Text style={styles.navBtnText}>›</Text>
        </Pressable>
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
              ref={guideTargets?.hint}
              collapsable={false}
              onPress={() => {
                setHintOn(true);
                onGuideEvent?.('hint');
              }}
              disabled={isReviewing || !activeIsYourTurn || activeLineDone || (inVariant && variantStage !== 'playing')}
              style={[styles.actionBtn, styles.hintBtn, (isReviewing || !activeIsYourTurn || activeLineDone) && styles.actionDisabled]}
            >
              <Text style={styles.hintText}>Hint</Text>
            </Pressable>
            <Pressable
              ref={guideTargets?.solution}
              collapsable={false}
              onPress={showSolution}
              disabled={isReviewing || !activeIsYourTurn || activeLineDone || (inVariant && variantStage !== 'playing')}
              style={[styles.actionBtn, styles.solutionBtn, (isReviewing || !activeIsYourTurn || activeLineDone) && styles.actionDisabled]}
            >
              <Text style={styles.solutionText}>Show solution</Text>
            </Pressable>
          </View>
          <Text style={styles.slipNote}>Show solution counts as a slip.</Text>
          <Text style={[styles.wrongText, !wrongMove && styles.wrongTextHidden]}>Wrong move. Try again.</Text>
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
  selHighlight: { backgroundColor: 'rgba(21,128,61,0.35)' },
  moveDot: { position: 'absolute', width: CELL * 0.28, height: CELL * 0.28, borderRadius: (CELL * 0.28) / 2, backgroundColor: 'rgba(21,128,61,0.55)' },
  captureRing: { position: 'absolute', width: CELL - 6, height: CELL - 6, borderRadius: (CELL - 6) / 2, borderWidth: 3, borderColor: 'rgba(220,38,38,0.85)' },
  rewindOverlay: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(15,23,42,0.55)'
  },
  navRow: { flexDirection: 'row', gap: 10 },
  navBtn: { width: touchTarget, height: touchTarget, borderRadius: 10, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.panel2, alignItems: 'center', justifyContent: 'center' },
  navBtnDisabled: { opacity: 0.4 },
  navBtnText: { color: colors.text, fontSize: 18 },
  notation: { color: colors.textDim, fontSize: 13, textAlign: 'center', paddingHorizontal: 12 },
  notationYours: { color: colors.primary, fontWeight: '700' },
  slipNote: { color: colors.textDim, fontSize: 12 },
  wrongText: { color: colors.danger, fontSize: 13, fontWeight: '700' },
  wrongTextHidden: { opacity: 0 },
  actionRow: { flexDirection: 'row', gap: 10, alignSelf: 'stretch', paddingHorizontal: 12 },
  actionBtn: { flex: 1, minHeight: touchTarget, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16, borderRadius: radius.pill },
  hintBtn: { backgroundColor: colors.gold },
  hintText: { color: colors.onGold, fontSize: 13, fontWeight: '700' },
  solutionBtn: { backgroundColor: colors.primary },
  solutionText: { color: colors.onPrimary, fontSize: 13, fontWeight: '700' },
  actionDisabled: { opacity: 0.4 },
  continueBtn: { marginTop: 4, minHeight: touchTarget, justifyContent: 'center', paddingHorizontal: 20, borderRadius: radius.pill, backgroundColor: colors.primary },
  continueText: { color: colors.onPrimary, fontSize: 14, fontWeight: '700' }
});
