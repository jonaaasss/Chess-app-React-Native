import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet, Animated, Easing, PanResponder, type PanResponderInstance } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { allSquares, flipIndex, mainLineNodes, squareFromIndex } from '../chess';
import { legalMovesFrom, makeMove, type GameState } from '../chessEngine';
import type { Arrow, Card, Circle, MoveNode, PieceCode, ReactionBoard } from '../types';
import { arrowColors, boardStyles, colors, radius, touchTarget } from '../theme';
import { BoardCoords, ArrowsSvg, CirclesSvg, PieceGlyph, NumberedArrowsSvg, NumberedArrowBadges, type NumberedArrow } from '../components/ChessBoard';
import { usePieceAnimation, PieceAnimationGhosts, PIECE_ANIM_DURATION_MS } from '../components/PieceAnimation';
import type { GuideTargets } from '../components/GuideCoach';
import { CollapsibleDescription } from '../components/CollapsibleDescription';
import type { CoachEvent } from '../guideContent';
import { useAutoPlayMode } from '../components/ReactionModeSwitch';
import { alertDialog, choiceDialog, showSnackbar, textDialog } from '../overlay';
import { saveStudyBoard } from '../studyEdits';
import type { PromotionPiece } from '../types';

// Opponent auto-play, board-to-board transitions, and the variation
// walkthrough all wait long enough for the slide animation to fully finish,
// plus a short pause, before moving on.
const AUTO_ADVANCE_DELAY_MS = PIECE_ANIM_DURATION_MS + 300;
const VARIANT_INTRO_MS = 1200;
const VARIANT_REWIND_PAUSE_MS = 1000;
// Stepping back through a variation's moves is a "rewind": sped up.
const REWIND_STEP_MS = Math.round(AUTO_ADVANCE_DELAY_MS / 1.75);
// A wrong move is actually played out (and animated), then slides back.
const WRONG_MOVE_SHOW_MS = PIECE_ANIM_DURATION_MS + 400;

const BOARD_SIZE = 300;
const CELL = BOARD_SIZE / 8;

// Each branching point along the line being played has its own colour, in
// order (green, orange, red, blue, then again); the move about to be played
// is the light tint, the other choices the dark one.
const BRANCH_COLORS = ['green', 'orange', 'red', 'blue'] as const;
const BRANCH_DARK = { green: 'darkGreen', orange: 'darkOrange', red: 'darkRed', blue: 'darkBlue' } as const;
const branchColor = (k: number, light: boolean) => {
  const c = BRANCH_COLORS[k % BRANCH_COLORS.length];
  return arrowColors[light ? c : BRANCH_DARK[c]];
};

function sameArrow(a: Arrow, b: Arrow) {
  return a.from === b.from && a.to === b.to && a.color === b.color;
}
function sameCircle(a: Circle, b: Circle) {
  return a.square === b.square && a.color === b.color;
}

// The arrows and circles visible after walking `path` from the board's own
// start: each move adds and removes its own (same rule as the editor).
function annotationsAlong(base: { arrows: Arrow[]; circles: Circle[] }, path: MoveNode[]) {
  let arrows = [...base.arrows];
  let circles = [...base.circles];
  for (const node of path) {
    arrows = arrows.filter((a) => !node.removedArrows.some((r) => sameArrow(r, a)));
    circles = circles.filter((c) => !node.removedCircles.some((r) => sameCircle(r, c)));
    arrows = [...arrows, ...node.addedArrows];
    circles = [...circles, ...node.addedCircles];
  }
  return { arrows, circles };
}

// Drawn icons (not '⏸'/'▶' glyphs, which Android renders as colour emoji).
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

function Chevron({ open, color }: { open: boolean; color: string }) {
  return (
    <Svg width={16} height={16} viewBox="0 0 24 24">
      <Path d={open ? 'M7 10l5 5 5-5z' : 'M10 7l5 5-5 5z'} fill={color} />
    </Svg>
  );
}

// ---------- The walk through a board ----------
//
// Everything that happens on a board is laid out once, in order, as a list
// of steps (each with the moves on the board at that point). At a branching
// point every choice is shown (`intro`), played to its end (`leaf`), and
// rewound only back to that branching point before the next choice; once
// all its choices are played it rewinds further, to the branching point
// before it. The order of the choices (and so their numbers):
//   - on the main line: the variations, shortest first, the main line last
//     (so the walk ends at the end of the main line);
//   - inside a variation: its own continuation first, then the others.

type IntroStep = { kind: 'intro'; path: MoveNode[]; choice: MoveNode; choices: MoveNode[] };
type Step =
  | { kind: 'start'; path: MoveNode[] }
  | IntroStep
  | { kind: 'move'; path: MoveNode[] }
  | { kind: 'leaf'; path: MoveNode[] }
  | { kind: 'rewind'; path: MoveNode[] };

function playOrder(siblings: MoveNode[], inside: boolean): MoveNode[] {
  if (inside) return siblings;
  const vars = siblings.slice(1).sort((a, b) => mainLineNodes([a]).length - mainLineNodes([b]).length);
  return [...vars, siblings[0]];
}

function childrenAfter(board: ReactionBoard, path: MoveNode[]): MoveNode[] {
  return path.length ? path[path.length - 1].children : board.recording;
}

// Whether the move at index `j` of `path` is played inside a variation
// (an earlier choice on the path left the main line).
function insideAt(board: ReactionBoard, path: MoveNode[], j: number): boolean {
  for (let i = 0; i < j; i++) {
    const sib = childrenAfter(board, path.slice(0, i));
    if (sib[0] && sib[0].id !== path[i].id) return true;
  }
  return false;
}

function buildTimeline(board: ReactionBoard): Step[] {
  const steps: Step[] = [{ kind: 'start', path: [] }];
  let cur: MoveNode[] = [];
  const walk = (inside: boolean) => {
    for (;;) {
      const sib = childrenAfter(board, cur);
      if (sib.length === 0) {
        steps.push({ kind: 'leaf', path: cur });
        return;
      }
      if (sib.length === 1) {
        cur = [...cur, sib[0]];
        steps.push({ kind: 'move', path: cur });
        continue;
      }
      const base = cur;
      const order = playOrder(sib, inside);
      for (const c of order) {
        while (cur.length > base.length) {
          cur = cur.slice(0, -1);
          steps.push({ kind: 'rewind', path: cur });
        }
        steps.push({ kind: 'intro', path: base, choice: c, choices: order });
        cur = [...base, c];
        steps.push({ kind: 'move', path: cur });
        walk(inside || c.id !== sib[0].id);
      }
      return;
    }
  };
  walk(false);
  return steps;
}

const leafKey = (path: MoveNode[]) => (path.length ? path[path.length - 1].id : 'root');

// One branching choice in the lines overview: the move, the moves after it up
// to the next branching point, and the choices there.
interface TreeNode {
  choice: MoveNode;
  ply: number;
  number: number;
  colorIdx: number;
  segment: { ply: number; node: MoveNode }[];
  children: TreeNode[];
  leafKeys: string[];
}

function buildTree(board: ReactionBoard): { rootSegment: { ply: number; node: MoveNode }[]; roots: TreeNode[] } {
  const follow = (path: MoveNode[]) => {
    const seg: { ply: number; node: MoveNode }[] = [];
    let p = path;
    for (;;) {
      const sib = childrenAfter(board, p);
      if (sib.length !== 1) return { seg, end: p };
      seg.push({ ply: p.length, node: sib[0] });
      p = [...p, sib[0]];
    }
  };
  const choicesAt = (base: MoveNode[], depth: number, inside: boolean): TreeNode[] => {
    const sib = childrenAfter(board, base);
    if (sib.length < 2) return [];
    return playOrder(sib, inside).map((c, i) => {
      const { seg, end } = follow([...base, c]);
      const children = choicesAt(end, depth + 1, inside || c.id !== sib[0].id);
      const leafKeys = children.length ? children.flatMap((ch) => ch.leafKeys) : [leafKey(end)];
      return { choice: c, ply: base.length, number: i + 1, colorIdx: depth, segment: seg, children, leafKeys };
    });
  };
  const { seg, end } = follow([]);
  return { rootSegment: seg, roots: choicesAt(end, 0, false) };
}

// Interactive Reactions study: the recorded line (a tree of moves) is walked
// as described above. "Play myself": the opponent's moves play themselves and
// you find yours (Hint, Show solution). "Auto-play": every move plays itself.
export function ReactionStudy({
  card,
  yourColor,
  boardStyle,
  onResult,
  boardRef,
  cursorRef,
  paused,
  preview,
  viewer,
  onTogglePause,
  guideTargets,
  onGuideEvent,
  onCardSaved,
  onShowLines
}: {
  card: Card;
  yourColor: 'w' | 'b';
  boardStyle: number;
  onResult: (correct: boolean) => void;
  boardRef?: React.MutableRefObject<ReactionBoard | null>;
  // Which recorded move is on screen — lets Edit reopen the board editor there.
  cursorRef?: React.MutableRefObject<string | null>;
  // Freezes everything automatic (a guide popup is up, the board editor is open).
  paused?: boolean;
  // The study session's preview pass: always Auto-play, no mode switch.
  preview?: boolean;
  // Opened from a link (CardViewerOverlay): same choices as in Study, never scored.
  viewer?: boolean;
  // With `preview`: the pause button drives the parent's `paused`.
  onTogglePause?: () => void;
  guideTargets?: GuideTargets;
  onGuideEvent?: (event: CoachEvent) => void;
  // Editing from here (the Description's pencil, "Use this move") is on when
  // set; it gets the stored card after every edit.
  onCardSaved?: (card: Card) => void;
  // Scrolls the parent to the bottom, where the lines tree is.
  onShowLines?: () => void;
}) {
  // A local copy, so an edit shows at once; follows the parent's card.
  const [localCard, setLocalCard] = useState(card);
  useEffect(() => setLocalCard(card), [card]);
  const editable = Boolean(onCardSaved);
  const boards = useMemo(() => [...localCard.boards].sort((a, b) => a.order - b.order), [localCard]);
  const [boardIdx, setBoardIdx] = useState(0);
  const board = boards[boardIdx];
  const steps = useMemo<Step[]>(() => (board ? buildTimeline(board) : [{ kind: 'start', path: [] }]), [board]);
  const tree = useMemo(() => (board ? buildTree(board) : { rootSegment: [], roots: [] as TreeNode[] }), [board]);
  const leaves = useMemo(
    () => steps.flatMap((s, i) => (s.kind === 'leaf' ? [{ key: leafKey(s.path), path: s.path, index: i }] : [])),
    [steps]
  );

  // Where the walk is (an index in `steps`).
  const [t, setT] = useState(0);
  // Set while ‹ has stepped back along the moves on the board: how many of
  // them are shown. null = the live position.
  const [reviewLen, setReviewLen] = useState<number | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [wrongMove, setWrongMove] = useState(false);
  const [wrongSquare, setWrongSquare] = useState<string | null>(null);
  const [wrongMovePreview, setWrongMovePreview] = useState<Partial<Record<string, PieceCode>> | null>(null);
  const [hintOn, setHintOn] = useState(false);
  const [mistakes, setMistakes] = useState(0);
  const [allDone, setAllDone] = useState(false);
  // Lines of this board played to their end (keyed by their last move).
  const [doneLeaves, setDoneLeaves] = useState<Set<string>>(new Set());
  const [overviewOpen, setOverviewOpen] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // "Play myself" or "Auto-play"; the last choice is remembered for Study and
  // the link viewer alike. The preview pass is always auto, the guide never.
  // The switch itself sits in the parent's fixed bottom bar.
  const autoMode = useAutoPlayMode();
  const [usedAuto, setUsedAuto] = useState(autoMode);
  const showModeSwitch = !preview && !guideTargets;
  const auto = Boolean(preview) || (showModeSwitch && autoMode);
  const [selfPaused, setSelfPaused] = useState(false);
  const isPaused = Boolean(paused) || (auto && !onTogglePause && selfPaused);

  const flipped = yourColor === 'b';
  const gridRef = useRef<View>(null);
  const gridOrigin = useRef({ x: 0, y: 0 });
  function measureGrid(cb?: () => void) {
    gridRef.current?.measureInWindow((x, y) => {
      gridOrigin.current = { x, y };
      cb?.();
    });
  }
  function squareFromPage(pageX: number, pageY: number): string | null {
    const file = Math.floor((pageX - gridOrigin.current.x) / CELL);
    const rank = Math.floor((pageY - gridOrigin.current.y) / CELL);
    return squareFromIndex(flipIndex(file, flipped), flipIndex(rank, flipped));
  }
  useEffect(() => {
    measureGrid();
  }, []);

  if (board && boardRef) boardRef.current = board;

  const step = steps[Math.min(t, steps.length - 1)];
  const livePath = step.path;
  const reviewing = reviewLen !== null;
  const viewPath = useMemo(() => (reviewLen !== null ? livePath.slice(0, reviewLen) : livePath), [livePath, reviewLen]);
  const nextStep = steps[t + 1];
  // The move about to be played (none while rewinding or at a line's end).
  const pendingMove =
    step.kind !== 'leaf' && step.kind !== 'rewind' && nextStep?.kind === 'move' ? nextStep.path[nextStep.path.length - 1] : undefined;
  const pendingIsYours = pendingMove ? (pendingMove.turnAfter === 'w' ? 'b' : 'w') === yourColor : false;
  const yourTurn = pendingIsYours && !auto;

  const liveState = useMemo<GameState>(() => {
    if (!board) return { pieces: {}, turn: 'w', castling: { wK: false, wQ: false, bK: false, bQ: false }, enPassant: null };
    let st: GameState = { pieces: board.pieces, turn: board.turn, castling: board.castling, enPassant: board.enPassant };
    for (const n of viewPath) st = makeMove(st, n.from, n.to, n.promotion).next;
    return st;
  }, [board, viewPath]);

  if (cursorRef) cursorRef.current = viewPath.length ? viewPath[viewPath.length - 1].id : null;

  // Move labels ("5.d5", "5...Bb4") by their index along a path.
  const firstIsWhite = board ? board.turn === 'w' : true;
  const moveLabel = (ply: number, san: string) => {
    const off = firstIsWhite ? 0 : 1;
    const n = Math.floor((ply + off) / 2) + 1;
    return (ply + off) % 2 === 0 ? `${n}.${san}` : `${n}...${san}`;
  };

  // The line being played: the next line end at or after this step.
  const currentLeaf = leaves.find((l) => l.index >= t) ?? leaves[leaves.length - 1];
  const currentLineIdx = currentLeaf ? leaves.indexOf(currentLeaf) : 0;
  const lineChoices = (path: MoveNode[]) =>
    board ? path.flatMap((n, j) => (childrenAfter(board, path.slice(0, j)).length > 1 ? [moveLabel(j, n.san)] : [])) : [];

  // The choices made along the moves shown stay on the board as one light
  // arrow each, numbered as at their branching point.
  const persistentArrows: NumberedArrow[] = [];
  if (board) {
    let k = 0;
    viewPath.forEach((node, j) => {
      const sib = childrenAfter(board, viewPath.slice(0, j));
      if (sib.length < 2) return;
      const order = playOrder(sib, insideAt(board, viewPath, j));
      persistentArrows.push({
        id: `keep-${node.id}`,
        from: node.from,
        to: node.to,
        color: branchColor(k, true),
        number: order.findIndex((v) => v.id === node.id) + 1
      });
      k += 1;
    });
  }
  const introArrows: NumberedArrow[] =
    !reviewing && step.kind === 'intro'
      ? step.choices.map((v, i) => ({
          id: `intro-${v.id}`,
          from: v.from,
          to: v.to,
          color: branchColor(persistentArrows.length, v.id === step.choice.id),
          number: i + 1
        }))
      : [];

  const { arrows: visibleArrows, circles: visibleCircles } = useMemo(
    () => (board ? annotationsAlong(board, viewPath) : { arrows: [], circles: [] }),
    [board, viewPath]
  );
  const legalTargets = useMemo(() => (selected ? legalMovesFrom(liveState, selected) : []), [liveState, selected]);
  const displayedPieces = wrongMovePreview ?? liveState.pieces;
  const { hiddenSquares, ghosts } = usePieceAnimation(displayedPieces, CELL, flipped);
  const rewindSpin = useRef(new Animated.Value(0)).current;

  // Guide coach moments.
  const yourTurnNow = yourTurn && !reviewing;
  useEffect(() => {
    if (yourTurnNow) onGuideEvent?.('yourTurn');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [yourTurnNow]);
  useEffect(() => {
    if (step.kind === 'intro') onGuideEvent?.('branchIntro');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t, boardIdx]);
  useEffect(() => {
    if (allDone) onGuideEvent?.('allDone');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allDone]);

  // A line reached its end.
  useEffect(() => {
    if (step.kind !== 'leaf') return;
    const key = leafKey(step.path);
    setDoneLeaves((s) => (s.has(key) ? s : new Set(s).add(key)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t, boardIdx]);

  function clearTransient() {
    setSelected(null);
    setHintOn(false);
    setWrongMove(false);
    setWrongSquare(null);
    setWrongMovePreview(null);
    setReviewLen(null);
  }

  function goTo(index: number) {
    clearTransient();
    setAllDone(false);
    setT(index);
  }

  // ▶ in the lines tree: play that choice again from its branching point
  // (its lines count as not played yet), and resume if Auto-play was paused.
  function playChoice(introIdx: number, choice: MoveNode) {
    const under = new Set(leavesUnder(choice).map((l) => l.key));
    setDoneLeaves((s) => new Set([...s].filter((k) => !under.has(k))));
    setSelfPaused(false);
    goTo(introIdx);
  }

  const leavesUnder = (c: MoveNode) => leaves.filter((l) => l.path.some((n) => n.id === c.id));
  // Start a line not played yet at the highest branching point on it where
  // nothing has been played.
  function jumpToLeaf(leaf: (typeof leaves)[number]) {
    const intros: { s: IntroStep; i: number }[] = [];
    steps.forEach((s, i) => {
      if (s.kind === 'intro' && leaf.path.some((n) => n.id === s.choice.id)) intros.push({ s, i });
    });
    const fresh = intros.find(({ s }) => leavesUnder(s.choice).every((l) => !doneLeaves.has(l.key)));
    const target = fresh ?? intros[intros.length - 1];
    goTo(target ? target.i : 0);
  }

  // The walk: one step at a time, at the pace of what happens.
  useEffect(() => {
    if (!board || reviewing || isPaused || allDone || wrongMove) return;
    if (step.kind === 'leaf') {
      if (!doneLeaves.has(leafKey(step.path))) return;
      const undone = leaves.filter((l) => !doneLeaves.has(l.key));
      if (undone.length === 0) {
        if (boardIdx < boards.length - 1) {
          const tm = setTimeout(() => {
            clearTransient();
            setBoardIdx((i) => i + 1);
            setT(0);
            setDoneLeaves(new Set());
            setExpanded(new Set());
          }, AUTO_ADVANCE_DELAY_MS);
          return () => clearTimeout(tm);
        }
        setAllDone(true);
        return;
      }
      if (t >= steps.length - 1) {
        // Lines skipped by jumping ahead are played before the board ends.
        const tm = setTimeout(() => jumpToLeaf(undone[0]), AUTO_ADVANCE_DELAY_MS);
        return () => clearTimeout(tm);
      }
    }
    if (t >= steps.length - 1) return;
    const next = steps[t + 1];
    if (next.kind === 'intro') {
      // A choice whose lines were all played already (after a jump) is
      // passed over, unless it is the last one at its branching point.
      const idx = next.choices.findIndex((c) => c.id === next.choice.id);
      if (idx < next.choices.length - 1 && leavesUnder(next.choice).every((l) => doneLeaves.has(l.key))) {
        const following = steps.findIndex((s, i) => i > t + 1 && s.kind === 'intro' && s.choice.id === next.choices[idx + 1].id);
        if (following > 0) {
          setT(following - 1);
          return;
        }
      }
    }
    if (next.kind === 'move' && yourTurn) return;
    const delay =
      next.kind === 'intro'
        ? step.kind === 'rewind'
          ? 300
          : AUTO_ADVANCE_DELAY_MS
        : next.kind === 'move'
          ? step.kind === 'intro'
            ? VARIANT_INTRO_MS
            : AUTO_ADVANCE_DELAY_MS
          : next.kind === 'leaf'
            ? AUTO_ADVANCE_DELAY_MS
            : step.kind === 'leaf'
              ? VARIANT_REWIND_PAUSE_MS
              : REWIND_STEP_MS;
    const tm = setTimeout(() => {
      setT((x) => x + 1);
      setSelected(null);
      setHintOn(false);
    }, delay);
    return () => clearTimeout(tm);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t, steps, board, reviewing, isPaused, allDone, wrongMove, doneLeaves, yourTurn, boardIdx]);

  // Spin the rewind icon for as long as the rewinding lasts.
  const rewinding = step.kind === 'rewind' && !reviewing;
  useEffect(() => {
    if (!rewinding) return;
    rewindSpin.setValue(0);
    const anim = Animated.loop(Animated.timing(rewindSpin, { toValue: 1, duration: 900, easing: Easing.linear, useNativeDriver: true }));
    anim.start();
    return () => {
      anim.stop();
      rewindSpin.setValue(0);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rewinding]);

  function playPending(slip: boolean) {
    setT((x) => x + 1);
    setSelected(null);
    setHintOn(false);
    if (slip) setMistakes((m) => m + 1);
  }

  function handleSquareTap(sq: string) {
    if (auto || reviewing || !yourTurn || wrongMove || !pendingMove) return;
    if (!selected) {
      const p = liveState.pieces[sq];
      if (p && p[0] === liveState.turn) setSelected(sq);
      return;
    }
    if (sq === selected) {
      setSelected(null);
      return;
    }
    if (legalTargets.includes(sq)) {
      if (selected === pendingMove.from && sq === pendingMove.to) {
        playPending(false);
      } else {
        setWrongMove(true);
        setWrongSquare(sq);
        setMistakes((m) => m + 1);
        setWrongMovePreview(makeMove(liveState, selected, sq).next.pieces);
        setSelected(null);
        if (editable && board) {
          const from = selected;
          const at = { board, path: livePath, node: pendingMove };
          showSnackbar({
            message: 'Not the move on this card.',
            actionLabel: 'Use this move',
            duration: 6000,
            onAction: () => void applyMyMove(at.board, at.path, at.node, from, sq)
          });
        }
        setTimeout(() => setWrongMovePreview(null), WRONG_MOVE_SHOW_MS);
        setTimeout(() => {
          setWrongMove(false);
          setWrongSquare(null);
        }, WRONG_MOVE_SHOW_MS + PIECE_ANIM_DURATION_MS);
      }
      return;
    }
    const p = liveState.pieces[sq];
    setSelected(p && p[0] === liveState.turn ? sq : null);
  }

  // Saves an edited board into the card and shows it here at once.
  // With `focusId`, the walk goes on from that move of the new board.
  async function storeBoard(next: ReactionBoard, focusId?: string) {
    setLocalCard((c) => ({ ...c, boards: c.boards.map((b) => (b.id === next.id ? next : b)) }));
    if (focusId) {
      const at = buildTimeline(next).findIndex((s) => s.kind === 'move' && s.path[s.path.length - 1]?.id === focusId);
      if (at >= 0) goTo(at);
    }
    const saved = await saveStudyBoard(localCard.id, next);
    if (saved) onCardSaved?.(saved);
  }

  async function editDescription() {
    if (!board) return;
    const text = await textDialog('Description', board.front.text);
    if (text === null || text === board.front.text) return;
    await storeBoard({ ...board, front: { ...board.front, text } });
  }

  // "Use this move": your move replaces the recorded one. When every move
  // after it is still legal, a popup asks whether to keep them or delete
  // them; otherwise they are deleted. Undo for 6 s either way.
  async function applyMyMove(target: ReactionBoard, parentPath: MoveNode[], node: MoveNode, from: string, to: string) {
    let st: GameState = { pieces: target.pieces, turn: target.turn, castling: target.castling, enPassant: target.enPassant };
    for (const n of parentPath) st = makeMove(st, n.from, n.to, n.promotion).next;
    const piece = st.pieces[from];
    const promotion: PromotionPiece | undefined = piece?.[1] === 'P' && (to[1] === '8' || to[1] === '1') ? 'Q' : undefined;
    const siblings = childrenAfter(target, parentPath);
    if (siblings.some((v) => v.id !== node.id && v.from === from && v.to === to)) {
      await alertDialog('This move is already a variation here. Edit the board to change it.');
      return;
    }
    const res = makeMove(st, from, to, promotion);
    const replay = (children: MoveNode[], state: GameState): MoveNode[] | null => {
      const out: MoveNode[] = [];
      for (const c of children) {
        const p = state.pieces[c.from];
        if (!p || p[0] !== state.turn || !legalMovesFrom(state, c.from).includes(c.to)) return null;
        const m = makeMove(state, c.from, c.to, c.promotion);
        const kids = replay(c.children, m.next);
        if (!kids) return null;
        out.push({ ...c, san: m.san, piecesAfter: m.next.pieces, turnAfter: m.next.turn, castlingAfter: m.next.castling, enPassantAfter: m.next.enPassant, children: kids });
      }
      return out;
    };
    const kept = node.children.length ? replay(node.children, res.next) : [];
    let keep = false;
    if (node.children.length && kept) {
      const choice = await choiceDialog<'keep' | 'cut'>(`Use ${res.san} instead of ${node.san}?`, [
        { label: 'Only change this move', value: 'keep', variant: 'primary' },
        { label: 'Delete the moves after it', value: 'cut', variant: 'danger' }
      ]);
      if (!choice) return;
      keep = choice === 'keep';
    }
    const replaced: MoveNode = {
      ...node,
      from,
      to,
      promotion,
      san: res.san,
      piecesAfter: res.next.pieces,
      turnAfter: res.next.turn,
      castlingAfter: res.next.castling,
      enPassantAfter: res.next.enPassant,
      children: keep && kept ? kept : []
    };
    const swap = (list: MoveNode[]): MoveNode[] => list.map((n) => (n.id === node.id ? replaced : { ...n, children: swap(n.children) }));
    const next: ReactionBoard = { ...target, recording: swap(target.recording) };
    setMistakes((m) => Math.max(0, m - 1));
    await storeBoard(next, node.id);
    showSnackbar({
      message: keep ? `${res.san} saved; the moves after it stay.` : `${res.san} saved; the moves after it are deleted.`,
      actionLabel: 'Undo',
      onAction: () => void storeBoard(target, node.id)
    });
  }

  function showSolution() {
    if (reviewing || !yourTurn) return;
    playPending(true);
    onGuideEvent?.('solution');
  }

  // ‹ › step back and forward along the moves on the board; nothing moves on
  // by itself meanwhile. › never plays your move (that is Show solution).
  const canGoPrev = viewPath.length > 0;
  const canGoNext = reviewing;
  function handlePrevMove() {
    if (!canGoPrev) return;
    setReviewLen(viewPath.length - 1);
    setSelected(null);
    setHintOn(false);
  }
  function handleNextMove() {
    if (!canGoNext) return;
    const n = viewPath.length + 1;
    setReviewLen(n >= livePath.length ? null : n);
    setSelected(null);
    setHintOn(false);
  }

  // « : back to the branching point of the last choice on the board (or,
  // while the choices of a branching point are on screen, the one before),
  // from where the walk goes on in its usual order.
  const prevBranch = (() => {
    const onPath = new Set(viewPath.map((n) => n.id));
    for (let i = Math.min(t, steps.length - 1); i >= 0; i--) {
      const s = steps[i];
      if (s.kind === 'intro' && onPath.has(s.choice.id)) return i;
    }
    return null;
  })();

  // Switching mode (from the bottom bar) mid-play.
  const firstMode = useRef(true);
  useEffect(() => {
    if (firstMode.current) {
      firstMode.current = false;
      return;
    }
    if (autoMode) setUsedAuto(true);
    setSelected(null);
    setHintOn(false);
    setSelfPaused(false);
  }, [autoMode]);

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
  const hintCircles = hintOn && yourTurn && pendingMove ? [{ square: pendingMove.from, color: 'green' as const }] : [];
  const showIntro = introArrows.length > 0;
  const actionsDisabled = reviewing || !yourTurn;

  const statusText = auto && isPaused && !allDone
    ? 'Paused — tap ▶ to go on'
    : rewinding
    ? 'Rewinding…'
    : step.kind === 'leaf'
      ? 'Line complete'
      : pendingMove
        ? pendingIsYours
          ? 'Your move'
          : "Opponent's move…"
        : '';
  const statusShown = wrongMove ? 'Wrong move — try again' : statusText;
  const statusColor = wrongMove ? colors.danger : pendingMove && pendingIsYours && !rewinding ? colors.primary : colors.textDim;

  const choicesText = currentLeaf ? lineChoices(currentLeaf.path) : [];
  const onLive = new Set(livePath.map((n) => n.id));
  if (step.kind === 'intro') onLive.add(step.choice.id);

  const toggleNode = (key: string) =>
    setExpanded((s) => {
      const n = new Set(s);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });

  // In the lines tree: no move numbers; your moves green, the opponent's red.
  const moveColor = (n: MoveNode) => ((n.turnAfter === 'w' ? 'b' : 'w') === yourColor ? arrowColors.green : colors.dangerText);
  const coloredMoves = (moves: { node: MoveNode }[]) =>
    moves.map((m, i) => (
      <Text key={m.node.id} style={{ color: moveColor(m.node) }}>
        {m.node.san}
        {i < moves.length - 1 ? '  ' : ''}
      </Text>
    ));

  const renderNode = (node: TreeNode, depth: number): React.ReactNode => {
    const key = node.choice.id;
    const open = expanded.has(key);
    const done = node.leafKeys.every((k) => doneLeaves.has(k));
    const current = onLive.has(key) && !allDone;
    const canOpen = node.segment.length > 0 || node.children.length > 0;
    const introIdx = steps.findIndex((s) => s.kind === 'intro' && s.choice.id === key);
    return (
      <View key={key}>
        <View style={[styles.treeRow, { paddingLeft: 10 + depth * 16 }, current && styles.treeRowCurrent]}>
          <Pressable onPress={() => canOpen && toggleNode(key)} style={styles.treeMain} accessibilityLabel={open ? 'Fold in' : 'Fold out'}>
            <View style={{ width: 16 }}>{canOpen && <Chevron open={open} color={colors.textDim} />}</View>
            <Text style={[styles.treeMove, { color: moveColor(node.choice) }, current && styles.treeMoveCurrent]}>{node.choice.san}</Text>
            {done && <Text style={styles.treeDone}>✓</Text>}
          </Pressable>
          <Pressable onPress={() => introIdx >= 0 && playChoice(introIdx, node.choice)} style={styles.treePlay} accessibilityLabel={`Play ${node.choice.san}`}>
            <PlayIcon size={18} color={colors.primary} />
          </Pressable>
        </View>
        {open && (
          <>
            {node.segment.length > 0 && (
              <Text style={[styles.treeSegment, { paddingLeft: 34 + depth * 16 }]}>
                {coloredMoves(node.segment)}
              </Text>
            )}
            {node.children.map((ch) => renderNode(ch, depth + 1))}
          </>
        )}
      </View>
    );
  };

  return (
    <View style={{ alignItems: 'center', gap: 10, alignSelf: 'stretch' }}>
      <CollapsibleDescription text={board.front.text} onEdit={editable ? editDescription : undefined} />
      <Text style={[styles.status, { color: statusColor }]}>
        {boards.length > 1 ? `Board ${boardIdx + 1} / ${boards.length} — ` : ''}
        {statusShown}
      </Text>
      {leaves.length > 1 && (
        // Tapping it opens the lines tree at the bottom and scrolls there.
        <Pressable
          onPress={() => {
            setOverviewOpen(true);
            if (onShowLines) setTimeout(onShowLines, 80);
          }}
          style={styles.linePathBtn}
          accessibilityLabel="Show all lines"
        >
          <Text style={styles.linePath}>
            {`Line ${currentLineIdx + 1} of ${leaves.length}: `}
            <Text style={styles.linePathMoves}>{choicesText.join(' › ')}</Text>
            <Text style={styles.linePathMore}>{'  ▾'}</Text>
          </Text>
        </Pressable>
      )}

      <View ref={guideTargets?.board} collapsable={false}>
        <View ref={gridRef} onLayout={() => measureGrid()} style={[styles.board, { width: BOARD_SIZE, height: BOARD_SIZE }]} {...panResponder.panHandlers}>
          <View style={{ width: BOARD_SIZE, height: BOARD_SIZE, flexDirection: 'row', flexWrap: 'wrap' }}>
            {(flipped ? [...allSquares()].reverse() : allSquares()).map((sq, i) => {
              const file = i % 8;
              const rank = Math.floor(i / 8);
              const isLight = (file + rank) % 2 === 0;
              const piece = displayedPieces[sq];
              const isSel = sq === selected;
              const isTarget = legalTargets.includes(sq);
              const isCapture = isTarget && (Boolean(piece) || (selected && liveState.pieces[selected]?.[1] === 'P' && sq === liveState.enPassant));
              return (
                <View key={sq} style={{ width: CELL, height: CELL, backgroundColor: isLight ? styleSet.light : styleSet.dark, alignItems: 'center', justifyContent: 'center' }}>
                  {piece && !hiddenSquares.has(sq) && <PieceGlyph code={piece} cell={CELL} />}
                  {isSel && <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.selHighlight]} />}
                  {isTarget && !isCapture && <View pointerEvents="none" style={styles.moveDot} />}
                  {isCapture && <View pointerEvents="none" style={styles.captureRing} />}
                  {sq === wrongSquare && <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.wrongSquare]} />}
                </View>
              );
            })}
          </View>
          <BoardCoords size={BOARD_SIZE} flipped={flipped} styleSet={styleSet} />
          <View style={StyleSheet.absoluteFill} pointerEvents="none">
            {!showIntro && (
              <>
                <ArrowsSvg arrows={visibleArrows} size={BOARD_SIZE} flipped={flipped} pieces={displayedPieces} yourColor={yourColor} />
                <CirclesSvg circles={[...visibleCircles, ...hintCircles]} size={BOARD_SIZE} flipped={flipped} pieces={displayedPieces} yourColor={yourColor} />
              </>
            )}
            {(persistentArrows.length > 0 || showIntro) && (
              <>
                <NumberedArrowsSvg arrows={[...persistentArrows, ...introArrows]} size={BOARD_SIZE} flipped={flipped} />
                <NumberedArrowBadges arrows={[...persistentArrows, ...introArrows]} size={BOARD_SIZE} flipped={flipped} />
              </>
            )}
            <PieceAnimationGhosts ghosts={ghosts} cell={CELL} />
          </View>
          {rewinding && (
            <View style={[StyleSheet.absoluteFill, styles.rewindOverlay]} pointerEvents="none">
              <Animated.View style={{ transform: [{ rotate: rewindSpin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }) }] }}>
                <RewindIcon size={72} color={colors.onPrimary} />
              </Animated.View>
            </View>
          )}
        </View>
      </View>

      <View style={styles.navRow}>
        {tree.roots.length > 0 && (
          <Pressable
            onPress={() => prevBranch !== null && goTo(prevBranch)}
            disabled={prevBranch === null}
            style={[styles.navBtn, prevBranch === null && styles.navBtnDisabled]}
            accessibilityLabel="Back to the previous branching point"
          >
            <Text style={styles.navBtnText}>«</Text>
          </Pressable>
        )}
        <Pressable onPress={handlePrevMove} disabled={!canGoPrev} style={[styles.navBtn, !canGoPrev && styles.navBtnDisabled]}>
          <Text style={styles.navBtnText}>‹</Text>
        </Pressable>
        {auto && (
          <Pressable onPress={() => (onTogglePause ? onTogglePause() : setSelfPaused((p) => !p))} style={styles.navBtn} accessibilityLabel={isPaused ? 'Play' : 'Pause'}>
            {(onTogglePause ? paused : selfPaused) ? <PlayIcon size={18} color={colors.gold} /> : <PauseIcon size={18} color={colors.gold} />}
          </Pressable>
        )}
        <Pressable onPress={handleNextMove} disabled={!canGoNext} style={[styles.navBtn, !canGoNext && styles.navBtnDisabled]}>
          <Text style={styles.navBtnText}>›</Text>
        </Pressable>
      </View>

      {allDone ? (
        <Pressable
          ref={guideTargets?.continue}
          collapsable={false}
          onPress={() => {
            onGuideEvent?.('continue');
            onResult(Boolean(preview) || Boolean(viewer) || mistakes === 0);
          }}
          style={styles.continueBtn}
        >
          <Text style={styles.continueText}>
            {preview || viewer || (usedAuto && mistakes === 0)
              ? 'Continue'
              : mistakes === 0
                ? '✓ Perfect — continue'
                : `Continue (${mistakes} slip${mistakes === 1 ? '' : 's'})`}
          </Text>
        </Pressable>
      ) : auto ? null : (
        <>
          <View style={styles.actionRow}>
            <Pressable
              ref={guideTargets?.hint}
              collapsable={false}
              onPress={() => {
                setHintOn(true);
                onGuideEvent?.('hint');
              }}
              disabled={actionsDisabled}
              style={[styles.actionBtn, styles.hintBtn, actionsDisabled && styles.actionDisabled]}
            >
              <Text style={styles.hintText}>Hint</Text>
            </Pressable>
            <Pressable
              ref={guideTargets?.solution}
              collapsable={false}
              onPress={showSolution}
              disabled={actionsDisabled}
              style={[styles.actionBtn, styles.solutionBtn, actionsDisabled && styles.actionDisabled]}
            >
              <Text style={styles.solutionText}>Show solution</Text>
            </Pressable>
          </View>
          {!viewer && <Text style={styles.slipNote}>Show solution counts as a slip.</Text>}
        </>
      )}

      {tree.roots.length > 0 && (
        // Every line of this board as a tree: the choices at the first
        // branching point, each opening to the moves up to the next one and
        // the choices there. ▶ plays from that choice.
        <View style={styles.overview}>
          <Pressable onPress={() => setOverviewOpen((o) => !o)} style={styles.overviewHead} accessibilityLabel={overviewOpen ? 'Hide the lines' : 'Show all lines'}>
            <Text style={styles.overviewHeadText}>{`${leaves.length} lines ${overviewOpen ? '▴' : '▾'}`}</Text>
          </Pressable>
          {overviewOpen && (
            <>
              {tree.rootSegment.length > 0 && (
                <Text style={[styles.treeSegment, { paddingLeft: 14 }]}>{coloredMoves(tree.rootSegment)}</Text>
              )}
              {tree.roots.map((n) => renderNode(n, 0))}
            </>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  linePath: { color: colors.textDim, fontSize: 13, textAlign: 'center', paddingHorizontal: 16 },
  linePathMoves: { color: colors.text, fontWeight: '700' },
  linePathMore: { color: colors.textDim },
  linePathBtn: { minHeight: touchTarget, justifyContent: 'center' },
  overview: { alignSelf: 'stretch', marginHorizontal: 12, borderRadius: 10, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.panel2, overflow: 'hidden' },
  overviewHead: { minHeight: touchTarget, justifyContent: 'center', paddingHorizontal: 14 },
  overviewHeadText: { color: colors.text, fontSize: 14, fontWeight: '600' },
  treeRow: { flexDirection: 'row', alignItems: 'center', borderTopWidth: 1, borderTopColor: colors.border },
  treeRowCurrent: { backgroundColor: colors.panel },
  treeMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: touchTarget },
  treeNum: { width: 18, fontSize: 13, fontWeight: '800' },
  treeMove: { color: colors.text, fontSize: 14, fontWeight: '600' },
  treeMoveCurrent: { fontWeight: '800' },
  treeDone: { color: colors.primary, fontSize: 14, fontWeight: '800' },
  treePlay: { width: touchTarget, height: touchTarget, alignItems: 'center', justifyContent: 'center' },
  treeSegment: { color: colors.textDim, fontSize: 13, paddingRight: 14, paddingBottom: 8 },
  status: { color: colors.textDim, fontSize: 13, fontWeight: '600' },
  board: { borderRadius: 6, overflow: 'hidden', borderWidth: 1, borderColor: colors.border },
  selHighlight: { backgroundColor: 'rgba(21,128,61,0.35)' },
  moveDot: { position: 'absolute', width: CELL * 0.28, height: CELL * 0.28, borderRadius: (CELL * 0.28) / 2, backgroundColor: 'rgba(21,128,61,0.55)' },
  captureRing: { position: 'absolute', width: CELL - 6, height: CELL - 6, borderRadius: (CELL - 6) / 2, borderWidth: 3, borderColor: 'rgba(220,38,38,0.85)' },
  rewindOverlay: { alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(15,23,42,0.55)' },
  navRow: { flexDirection: 'row', gap: 10 },
  navBtn: { width: touchTarget, height: touchTarget, borderRadius: 10, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.panel2, alignItems: 'center', justifyContent: 'center' },
  navBtnDisabled: { opacity: 0.4 },
  navBtnText: { color: colors.text, fontSize: 18 },
  slipNote: { color: colors.textDim, fontSize: 12 },
  wrongSquare: { backgroundColor: 'rgba(220,38,38,0.5)' },
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
