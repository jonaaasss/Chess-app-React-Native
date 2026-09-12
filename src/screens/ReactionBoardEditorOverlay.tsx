import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, PanResponder, PanResponderInstance, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { allSquares, cloneBoardFace, flipIndex, squareFromIndex, startingPosition } from '../chess';
import { legalMovesFrom, makeMove, isPromotionMove, type GameState } from '../chessEngine';
import type { Arrow, ArrowColor, BoardFace, BoardMove, CardMode, Circle, MoveNode, PromotionPiece, ReactionBoard } from '../types';
import { arrowColors, boardStyles, colors, radius, spacing, type } from '../theme';
import { CirclesSvg, PieceGlyph, NumberedArrowsSvg, NumberedArrowBadges, type NumberedArrow } from '../components/ChessBoard';
import { usePieceAnimation, PieceAnimationGhosts } from '../components/PieceAnimation';
import { alertDialog, confirmDialog, showOverlay } from '../overlay';
import { uid } from '../storage';

const ARROW_KEYS = Object.keys(arrowColors) as ArrowColor[];
const BOARD_SIZE = 320;
const CELL = BOARD_SIZE / 8;
const PROMOTION_PIECES: PromotionPiece[] = ['Q', 'R', 'B', 'N'];

type Tool = 'move' | 'annotate';
type Side = 'front' | 'back';

// ---------- Tree helpers (all immutable — return new trees/boards) ----------

function mapNode(nodes: MoveNode[], id: string, fn: (n: MoveNode) => MoveNode): MoveNode[] {
  return nodes.map((n) => (n.id === id ? fn(n) : { ...n, children: mapNode(n.children, id, fn) }));
}

function findPath(nodes: MoveNode[], id: string, path: MoveNode[] = []): MoveNode[] | null {
  for (const n of nodes) {
    const next = [...path, n];
    if (n.id === id) return next;
    const found = findPath(n.children, id, next);
    if (found) return found;
  }
  return null;
}

// Drops a node and everything under it (its whole subtree, main line or
// variation) wherever it sits in the tree — used for "delete from here".
function removeNode(nodes: MoveNode[], id: string): MoveNode[] {
  return nodes.filter((n) => n.id !== id).map((n) => ({ ...n, children: removeNode(n.children, id) }));
}

function mainLineLeafId(nodes: MoveNode[]): string | null {
  if (nodes.length === 0) return null;
  let node = nodes[0];
  while (node.children.length > 0) node = node.children[0];
  return node.id;
}

function sameArrow(a: Arrow, b: Arrow) {
  return a.from === b.from && a.to === b.to && a.color === b.color;
}
function sameArrowSpan(a: Arrow, b: Arrow) {
  return a.from === b.from && a.to === b.to;
}
function sameCircle(a: Circle, b: Circle) {
  return a.square === b.square && a.color === b.color;
}

// Same thick-arrow-with-side-offset-badge treatment used by Study's variant
// callouts, so the editor's own arrows look identical. Only same-colored
// arrows are numbered against each other (2+ of a color) — a lone arrow of
// its color needs no badge to disambiguate.
function toEditorNumberedArrows(arrows: Arrow[]): NumberedArrow[] {
  const countByColor: Partial<Record<ArrowColor, number>> = {};
  for (const a of arrows) countByColor[a.color] = (countByColor[a.color] ?? 0) + 1;
  const seenByColor: Partial<Record<ArrowColor, number>> = {};
  return arrows.map((a, i) => {
    const seen = (seenByColor[a.color] = (seenByColor[a.color] ?? 0) + 1);
    return {
      id: `${a.from}-${a.to}-${a.color}-${i}`,
      from: a.from,
      to: a.to,
      color: arrowColors[a.color],
      number: (countByColor[a.color] ?? 0) > 1 ? seen : undefined
    };
  });
}

// Resolves what's actually visible at a given point in the tree: start from
// the board's own (pre-Play) annotations, then walk the path to the current
// node applying each node's added/removed in order.
function activeAnnotations(board: ReactionBoard, path: MoveNode[]): { arrows: Arrow[]; circles: Circle[] } {
  let arrows = [...board.arrows];
  let circles = [...board.circles];
  for (const node of path) {
    arrows = arrows.filter((a) => !node.removedArrows.some((r) => sameArrow(r, a)));
    circles = circles.filter((c) => !node.removedCircles.some((r) => sameCircle(r, c)));
    arrows = [...arrows, ...node.addedArrows];
    circles = [...circles, ...node.addedCircles];
  }
  return { arrows, circles };
}

// ---------- The overlay ----------

function ReactionBoardEditorOverlay({
  initial,
  mode,
  yourColor,
  boardStyle,
  close
}: {
  initial: ReactionBoard;
  mode: CardMode;
  yourColor: 'w' | 'b';
  boardStyle: number;
  close: (result: ReactionBoard | null) => void;
}) {
  const isReactions = mode === 'reactions';
  const isOthers = mode === 'others';
  const isPlan = mode === 'plan';
  // A Black-repertoire card is edited from Black's side of the board — rank
  // 1 at the top, a-file on the right.
  const flipped = yourColor === 'b';
  const [board, setBoard] = useState<ReactionBoard>(initial);
  const [phase, setPhase] = useState<'setup' | 'playing'>(initial.recording.length > 0 ? 'playing' : 'setup');
  const [cursorId, setCursorId] = useState<string | null>(
    initial.recording.length > 0 ? mainLineLeafId(initial.recording) : null
  );
  // Others only — which side of the board you're currently editing (a real
  // flip, front and back independently viewable). Plan always edits `back`
  // directly (no flip, no hidden bare view — you draw the plan's arrows
  // right on the position, they're only hidden again in Study). Reactions
  // has no front/back position split at all, so this stays unused for it.
  const [side, setSide] = useState<Side>(isPlan ? 'back' : 'front');
  const [tool, setTool] = useState<Tool>('move');
  // One shared color for both arrows and circles — which one you get is
  // decided by the gesture (drag = arrow, tap = circle), not by a separate
  // color picker per annotation type.
  const [annotateColor, setAnnotateColor] = useState<ArrowColor>('green');
  const [selected, setSelected] = useState<string | null>(null);
  const [tempArrow, setTempArrow] = useState<{ from: string; to: string } | null>(null);
  const [pendingPromotion, setPendingPromotion] = useState<{ from: string; to: string } | null>(null);
  // Reactions setup-phase step back/forward only: undo/redo stacks of
  // whole-board snapshots, for the brief pre-Play position-building step.
  // Reactions' playing phase walks the recorded tree instead (`cursorId`);
  // Others/Plan use `historyIndex` below, a permanent, per-face history.
  const [undoStack, setUndoStack] = useState<ReactionBoard[]>([]);
  const [redoStack, setRedoStack] = useState<ReactionBoard[]>([]);
  const arrowStartRef = useRef<string | null>(null);
  const gridOrigin = useRef({ x: 0, y: 0 });
  const gridRef = useRef<View>(null);

  const activeFace: BoardFace = side === 'front' ? board.front : board.back;

  // Others/Plan only — how many of `activeFace.moves` are currently
  // "applied"/visible. Equal to `activeFace.moves.length` means you're at
  // the live head (matching `activeFace.pieces`, which is always kept at
  // the head); a smaller value means you've stepped back to review how the
  // position was built. Reset on every flip to the newly active face's own
  // head, since Others' two faces can have differently-sized histories.
  const [historyIndex, setHistoryIndex] = useState(isPlan ? initial.back.moves.length : initial.front.moves.length);
  const atHead = historyIndex === activeFace.moves.length;

  const path = useMemo(
    () => (isReactions && cursorId ? findPath(board.recording, cursorId) ?? [] : []),
    [isReactions, board.recording, cursorId]
  );
  const cursorNode = path.length > 0 ? path[path.length - 1] : null;

  const engineState: GameState = isReactions
    ? cursorNode
      ? { pieces: cursorNode.piecesAfter, turn: cursorNode.turnAfter, castling: cursorNode.castlingAfter, enPassant: cursorNode.enPassantAfter }
      : { pieces: board.pieces, turn: board.turn, castling: board.castling, enPassant: board.enPassant }
    : atHead
      ? { pieces: activeFace.pieces, turn: activeFace.turn, castling: activeFace.castling, enPassant: activeFace.enPassant }
      : historyIndex === 0
        ? { pieces: startingPosition(), turn: 'w', castling: { wK: true, wQ: true, bK: true, bQ: true }, enPassant: null }
        : {
            pieces: activeFace.moves[historyIndex - 1].piecesAfter,
            turn: activeFace.moves[historyIndex - 1].turnAfter,
            castling: activeFace.moves[historyIndex - 1].castlingAfter,
            enPassant: activeFace.moves[historyIndex - 1].enPassantAfter
          };

  // Annotations aren't tied to individual moves for Others/Plan (unlike
  // Reactions' per-node add/remove) — they're just the face's current, flat
  // arrows/circles, which only make sense drawn on top of the live head.
  // Stepping back to review earlier moves hides them rather than showing
  // them mismatched against a position they don't belong to.
  const { arrows: visibleArrows, circles: visibleCircles } = useMemo(() => {
    if (!isReactions) return atHead ? { arrows: activeFace.arrows, circles: activeFace.circles } : { arrows: [], circles: [] };
    return activeAnnotations(board, path);
  }, [isReactions, activeFace, board, path, atHead]);

  const numberedArrows = useMemo(
    () => toEditorNumberedArrows(tempArrow ? [...visibleArrows, { ...tempArrow, color: annotateColor }] : visibleArrows),
    [visibleArrows, tempArrow, annotateColor]
  );
  // Badges are numbered off the committed arrows only — while a second
  // same-color arrow is still being dragged (not yet released), its number
  // shouldn't appear yet, nor should it bump an existing lone arrow's badge
  // into existence prematurely.
  const committedNumberedArrows = useMemo(() => toEditorNumberedArrows(visibleArrows), [visibleArrows]);

  const legalTargets = useMemo(
    () => (selected ? legalMovesFrom(engineState, selected) : []),
    [engineState, selected]
  );

  const styleSet = boardStyles[boardStyle] ?? boardStyles[0];
  const { hiddenSquares, ghosts } = usePieceAnimation(engineState.pieces, CELL, flipped);

  function pushHistory() {
    setUndoStack((s) => [...s, board].slice(-40));
    setRedoStack([]);
  }

  const canBack = isReactions
    ? phase === 'playing'
      ? path.length > 0
      : undoStack.length > 0
    : historyIndex > 0;
  const canForward = isReactions
    ? phase === 'playing'
      ? (cursorNode ? cursorNode.children.length : board.recording.length) > 0
      : redoStack.length > 0
    : historyIndex < activeFace.moves.length;

  function measureGrid(cb?: () => void) {
    gridRef.current?.measureInWindow((x, y) => {
      gridOrigin.current = { x, y };
      cb?.();
    });
  }

  // Measure the grid's on-screen position as soon as it's laid out, not
  // only lazily on the first touch — otherwise a fast tap right at the
  // start could resolve to the wrong square (or silently do nothing) while
  // that first async measurement is still in flight.
  useEffect(() => {
    measureGrid();
  }, []);

  function squareFromPage(pageX: number, pageY: number): string | null {
    const file = Math.floor((pageX - gridOrigin.current.x) / CELL);
    const rank = Math.floor((pageY - gridOrigin.current.y) / CELL);
    return squareFromIndex(flipIndex(file, flipped), flipIndex(rank, flipped));
  }

  // ---------- Committing a move (Reactions setup: advances the base
  // position; Reactions playing: appends to — or reuses — a child of the
  // current tree node; Others/Plan: edits the active face directly) ----------

  function finishMove(from: string, to: string, promotion?: PromotionPiece) {
    const result = makeMove(engineState, from, to, promotion);

    if (!isReactions) {
      const move: BoardMove = {
        from,
        to,
        promotion,
        piecesAfter: result.next.pieces,
        turnAfter: result.next.turn,
        castlingAfter: result.next.castling,
        enPassantAfter: result.next.enPassant
      };
      setBoard((prev) => {
        const movedFace = (old: BoardFace): BoardFace => ({
          ...old,
          pieces: result.next.pieces,
          turn: result.next.turn,
          castling: result.next.castling,
          enPassant: result.next.enPassant,
          // Arrows/circles are annotations on THIS position — a fresh move
          // means a new position, so stale markings from the last one
          // shouldn't linger on top of it.
          arrows: [],
          circles: [],
          // Rewinding (historyIndex < old.moves.length) and then playing a
          // different move truncates the rest of the line rather than
          // branching — this history is linear, unlike Reactions' tree.
          moves: [...old.moves.slice(0, historyIndex), move]
        });
        // Plan's two faces always share one position (and history) — a move
        // updates both, clearing both sides' arrows since the position
        // under them changed. Others' faces are fully independent, so only
        // the active one moves.
        if (mode === 'plan') {
          return { ...prev, front: movedFace(prev.front), back: movedFace(prev.back) };
        }
        return { ...prev, [side]: movedFace(prev[side]) };
      });
      setHistoryIndex((i) => i + 1);
      setSelected(null);
      return;
    }

    if (phase === 'setup') {
      pushHistory();
      setBoard((prev) => ({
        ...prev,
        pieces: result.next.pieces,
        turn: result.next.turn,
        castling: result.next.castling,
        enPassant: result.next.enPassant,
        arrows: [],
        circles: []
      }));
      setSelected(null);
      return;
    }

    const siblings = cursorNode ? cursorNode.children : board.recording;
    const existing = siblings.find((n) => n.from === from && n.to === to && n.promotion === promotion);
    if (existing) {
      setCursorId(existing.id);
      setSelected(null);
      return;
    }

    const newNode: MoveNode = {
      id: uid(),
      san: result.san,
      from,
      to,
      promotion,
      piecesAfter: result.next.pieces,
      turnAfter: result.next.turn,
      castlingAfter: result.next.castling,
      enPassantAfter: result.next.enPassant,
      addedArrows: [],
      addedCircles: [],
      // Whatever was drawn at the position this move is played from doesn't
      // carry forward onto the new position by default — but it's a removal
      // marker on this new node only, not a deletion, so stepping back to
      // the parent still shows it exactly as it was.
      removedArrows: [...visibleArrows],
      removedCircles: [...visibleCircles],
      children: []
    };
    setBoard((prev) => ({
      ...prev,
      recording: cursorId ? mapNode(prev.recording, cursorId, (n) => ({ ...n, children: [...n.children, newNode] })) : [...prev.recording, newNode]
    }));
    setCursorId(newNode.id);
    setSelected(null);
  }

  function handleSquareTap(sq: string) {
    if (!selected) {
      const piece = engineState.pieces[sq];
      if (piece && piece[0] === engineState.turn) setSelected(sq);
      return;
    }
    if (sq === selected) {
      setSelected(null);
      return;
    }
    if (legalTargets.includes(sq)) {
      if (isPromotionMove(engineState, selected, sq)) {
        setPendingPromotion({ from: selected, to: sq });
      } else {
        finishMove(selected, sq);
      }
      return;
    }
    const piece = engineState.pieces[sq];
    setSelected(piece && piece[0] === engineState.turn ? sq : null);
  }

  function choosePromotion(piece: PromotionPiece) {
    if (!pendingPromotion) return;
    finishMove(pendingPromotion.from, pendingPromotion.to, piece);
    setPendingPromotion(null);
  }

  // ---------- Arrows / circles ----------

  // Drawing the same arrow (same from/to) again toggles it off if the color
  // matches, or replaces it if the color differs — same rule toggleCircle
  // already uses for circles on a square.
  function addArrow(arrow: Arrow) {
    const existing = visibleArrows.find((a) => sameArrowSpan(a, arrow));
    const isSameColor = existing?.color === arrow.color;

    if (!isReactions) {
      if (!atHead) return;
      setBoard((prev) => {
        let arrows = prev[side].arrows.filter((a) => !sameArrowSpan(a, arrow));
        if (!isSameColor) arrows = [...arrows, arrow];
        return { ...prev, [side]: { ...prev[side], arrows } };
      });
      return;
    }

    if (cursorId === null) {
      setBoard((prev) => {
        let arrows = prev.arrows.filter((a) => !sameArrowSpan(a, arrow));
        if (!isSameColor) arrows = [...arrows, arrow];
        return { ...prev, arrows };
      });
      return;
    }

    setBoard((prev) => ({
      ...prev,
      recording: mapNode(prev.recording, cursorId, (n) => {
        const addedHere = n.addedArrows.some((a) => sameArrowSpan(a, arrow));
        let addedArrows = n.addedArrows.filter((a) => !sameArrowSpan(a, arrow));
        let removedArrows = n.removedArrows.filter((a) => !sameArrowSpan(a, arrow));
        if (!isSameColor) {
          addedArrows = [...addedArrows, arrow];
        } else if (!addedHere && existing) {
          removedArrows = [...removedArrows, existing];
        }
        return { ...n, addedArrows, removedArrows };
      })
    }));
  }

  function clearAnnotations() {
    if (visibleArrows.length === 0 && visibleCircles.length === 0) return;

    if (!isReactions) {
      if (!atHead) return;
      setBoard((prev) => ({ ...prev, [side]: { ...prev[side], arrows: [], circles: [] } }));
      return;
    }

    pushHistory();
    if (cursorId === null) {
      setBoard((prev) => ({ ...prev, arrows: [], circles: [] }));
      return;
    }
    setBoard((prev) => ({
      ...prev,
      recording: mapNode(prev.recording, cursorId, (n) => {
        const inheritedArrows = visibleArrows.filter((a) => !n.addedArrows.some((o) => sameArrow(o, a)));
        const inheritedCircles = visibleCircles.filter((c) => !n.addedCircles.some((o) => sameCircle(o, c)));
        return {
          ...n,
          addedArrows: [],
          removedArrows: [...n.removedArrows, ...inheritedArrows],
          addedCircles: [],
          removedCircles: [...n.removedCircles, ...inheritedCircles]
        };
      })
    }));
  }

  function toggleCircle(square: string) {
    const existing = visibleCircles.find((c) => c.square === square);
    const isSameColor = existing?.color === annotateColor;

    if (!isReactions) {
      if (!atHead) return;
      setBoard((prev) => {
        let circles = prev[side].circles.filter((c) => c.square !== square);
        if (!isSameColor) circles = [...circles, { square, color: annotateColor }];
        return { ...prev, [side]: { ...prev[side], circles } };
      });
      return;
    }

    if (cursorId === null) {
      setBoard((prev) => {
        let circles = prev.circles.filter((c) => c.square !== square);
        if (!isSameColor) circles = [...circles, { square, color: annotateColor }];
        return { ...prev, circles };
      });
      return;
    }

    setBoard((prev) => ({
      ...prev,
      recording: mapNode(prev.recording, cursorId, (n) => {
        const addedHere = n.addedCircles.some((c) => c.square === square);
        let addedCircles = n.addedCircles.filter((c) => c.square !== square);
        let removedCircles = n.removedCircles.filter((c) => c.square !== square);
        if (!isSameColor) {
          addedCircles = [...addedCircles, { square, color: annotateColor }];
        } else if (!addedHere && existing) {
          removedCircles = [...removedCircles, existing];
        }
        return { ...n, addedCircles, removedCircles };
      })
    }));
  }

  // ---------- Pan responder: move (tap), annotate (tap = circle, drag = arrow) ----------

  const panResponder = useMemo<PanResponderInstance>(() => {
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (evt) => {
        const { pageX, pageY } = evt.nativeEvent;
        measureGrid(() => {
          const sq = squareFromPage(pageX, pageY);
          if (!sq) return;
          if (tool === 'move') {
            handleSquareTap(sq);
          } else {
            arrowStartRef.current = sq;
            setTempArrow(null);
          }
        });
      },
      onPanResponderMove: (evt) => {
        if (tool !== 'annotate' || !arrowStartRef.current) return;
        const { pageX, pageY } = evt.nativeEvent;
        const hoverSq = squareFromPage(pageX, pageY);
        const start = arrowStartRef.current;
        setTempArrow(hoverSq && hoverSq !== start ? { from: start, to: hoverSq } : null);
      },
      onPanResponderRelease: (evt) => {
        if (tool !== 'annotate' || !arrowStartRef.current) return;
        const { pageX, pageY } = evt.nativeEvent;
        const endSq = squareFromPage(pageX, pageY);
        const start = arrowStartRef.current;
        if (endSq && endSq !== start) {
          addArrow({ from: start, to: endSq, color: annotateColor });
        } else {
          toggleCircle(start);
        }
        arrowStartRef.current = null;
        setTempArrow(null);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tool, annotateColor, board, cursorId, selected, phase, side, historyIndex, atHead]);

  // ---------- Reset / undo / play / flip / apply-to-back ----------

  async function handleReset() {
    const hasData = isReactions
      ? board.recording.length > 0
      : true;
    if (hasData) {
      const ok = await confirmDialog('Reset board? All recorded moves/notation for this board will be lost.');
      if (!ok) return;
    }
    if (isReactions) pushHistory();
    // Resets position/annotations/history only — each face's own text is
    // untouched, it isn't part of what "reset the board" means.
    const resetPosition = {
      pieces: startingPosition(),
      turn: 'w' as const,
      castling: { wK: true, wQ: true, bK: true, bQ: true },
      enPassant: null,
      arrows: [],
      circles: [],
      moves: [] as BoardMove[]
    };
    setBoard((prev) => ({
      ...prev,
      pieces: startingPosition(),
      turn: 'w',
      castling: { wK: true, wQ: true, bK: true, bQ: true },
      enPassant: null,
      arrows: [],
      circles: [],
      recording: [],
      front: { ...prev.front, ...resetPosition },
      back: { ...prev.back, ...resetPosition }
    }));
    setPhase('setup');
    setCursorId(null);
    setSelected(null);
    setHistoryIndex(0);
  }

  function handlePlay() {
    setPhase('playing');
    setCursorId(null);
    setSelected(null);
  }

  // Long-press a move in the notation to delete it and everything after it
  // in that branch (main line or variation) — confirmed first since it's
  // destructive and can reach deep into recorded work. If the cursor was on
  // or past the deleted move, it lands on the deleted move's parent (or
  // Start, for a root move) so it's never left pointing at nothing.
  async function handleDeleteMove(id: string) {
    const targetPath = findPath(board.recording, id);
    if (!targetPath) return;
    const ok = await confirmDialog('Delete this move and everything after it? This cannot be undone.');
    if (!ok) return;
    const parentId = targetPath.length >= 2 ? targetPath[targetPath.length - 2].id : null;
    const cursorPath = cursorId ? findPath(board.recording, cursorId) : null;
    const cursorAffected = Boolean(cursorPath?.some((n) => n.id === id));
    setBoard((prev) => ({ ...prev, recording: removeNode(prev.recording, id) }));
    if (cursorAffected) setCursorId(parentId);
    setSelected(null);
  }

  function handleBack() {
    setSelected(null);
    if (isReactions) {
      if (phase === 'playing') {
        if (path.length === 0) return;
        setCursorId(path.length >= 2 ? path[path.length - 2].id : null);
        return;
      }
      if (undoStack.length === 0) return;
      setRedoStack((r) => [...r, board]);
      setBoard(undoStack[undoStack.length - 1]);
      setUndoStack((s) => s.slice(0, -1));
      return;
    }
    if (historyIndex === 0) return;
    setHistoryIndex((i) => i - 1);
  }

  function handleForward() {
    setSelected(null);
    if (isReactions) {
      if (phase === 'playing') {
        const children = cursorNode ? cursorNode.children : board.recording;
        if (children.length === 0) return;
        setCursorId(children[0].id);
        return;
      }
      if (redoStack.length === 0) return;
      setUndoStack((s) => [...s, board]);
      setBoard(redoStack[redoStack.length - 1]);
      setRedoStack((r) => r.slice(0, -1));
      return;
    }
    if (historyIndex >= activeFace.moves.length) return;
    setHistoryIndex((i) => i + 1);
  }

  function handleFlip() {
    const next: Side = side === 'front' ? 'back' : 'front';
    setSide(next);
    setHistoryIndex(board[next].moves.length);
    setSelected(null);
    setTempArrow(null);
  }

  function handleApplyToBack() {
    // Position, annotations and move history come from the front — the
    // back's own text is a separate concern and stays exactly as it was.
    setBoard((prev) => ({ ...prev, back: { ...cloneBoardFace(prev.front), text: prev.back.text } }));
  }

  async function handleCancel() {
    close(null);
  }

  async function handleSave() {
    if (mode === 'plan' && board.back.arrows.length === 0) {
      await alertDialog(
        'A Plan board needs at least one arrow on its back — that arrow is the plan you\'ll have to reproduce in Study. If you don\'t want to use arrows here, switch this card to "Others" mode instead.'
      );
      return;
    }
    close(board);
  }

  return (
    <SafeAreaView style={styles.overlay}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.topBar}>
          <Pressable onPress={handleCancel}>
            <Text style={styles.topBarBtn}>Cancel</Text>
          </Pressable>
          <Text style={styles.title}>{mode === 'reactions' ? 'Reactions board' : 'Board editor'}</Text>
          <Pressable onPress={handleSave}>
            <Text style={[styles.topBarBtn, styles.saveBtn]}>Save</Text>
          </Pressable>
        </View>

        {/* Others has a real front/back flip, so it gets two independent
            descriptions. Reactions and Plan have only one position (Plan's
            "back" is just where that single position/its arrows live, not
            a second face) so they get a single Description field —
            Reactions' shown throughout Study, Plan's alongside the plan. */}
        {isOthers ? (
          <>
            <Text style={styles.fieldLabel}>Front description</Text>
            <TextInput
              style={styles.textArea}
              value={board.front.text}
              onChangeText={(text) => setBoard((prev) => ({ ...prev, front: { ...prev.front, text } }))}
              multiline
              placeholder="Shown in Study on the front..."
              placeholderTextColor={colors.textDim}
            />
            <Text style={styles.fieldLabel}>Back description</Text>
            <TextInput
              style={styles.textArea}
              value={board.back.text}
              onChangeText={(text) => setBoard((prev) => ({ ...prev, back: { ...prev.back, text } }))}
              multiline
              placeholder="Shown in Study on the back..."
              placeholderTextColor={colors.textDim}
            />
          </>
        ) : (
          <>
            <Text style={styles.fieldLabel}>Description</Text>
            <TextInput
              style={styles.textArea}
              value={isPlan ? board.back.text : board.front.text}
              onChangeText={(text) =>
                setBoard((prev) =>
                  isPlan ? { ...prev, back: { ...prev.back, text } } : { ...prev, front: { ...prev.front, text } }
                )
              }
              multiline
              placeholder="Shown in Study..."
              placeholderTextColor={colors.textDim}
            />
          </>
        )}

        {isOthers && (
          <Text style={styles.sideLabel}>{side === 'front' ? 'Front' : 'Back'}</Text>
        )}

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
              const piece = engineState.pieces[sq];
              const isSelected = sq === selected;
              const isTarget = legalTargets.includes(sq);
              // An en-passant destination is an empty square, but it's still
              // a capture — show the red ring, not the quiet-move dot.
              const selPiece = selected ? engineState.pieces[selected] : undefined;
              const isCapture = isTarget && (Boolean(piece) || (selPiece?.[1] === 'P' && sq === engineState.enPassant));
              return (
                <View
                  key={sq}
                  style={{ width: CELL, height: CELL, backgroundColor: isLight ? styleSet.light : styleSet.dark, alignItems: 'center', justifyContent: 'center' }}
                >
                  {piece && !hiddenSquares.has(sq) && <PieceGlyph code={piece} cell={CELL} />}
                  {isSelected && <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.selectedHighlight]} />}
                  {isTarget && !isCapture && <View pointerEvents="none" style={styles.moveDot} />}
                  {isCapture && <View pointerEvents="none" style={styles.captureRing} />}
                </View>
              );
            })}
          </View>
          <View style={StyleSheet.absoluteFill} pointerEvents="none">
            <NumberedArrowsSvg arrows={numberedArrows} size={BOARD_SIZE} flipped={flipped} />
            <CirclesSvg circles={visibleCircles} size={BOARD_SIZE} flipped={flipped} />
            <NumberedArrowBadges arrows={committedNumberedArrows} size={BOARD_SIZE} flipped={flipped} />
            <PieceAnimationGhosts ghosts={ghosts} cell={CELL} />
          </View>
        </View>

        {pendingPromotion && (
          <View style={styles.promoRow}>
            <Text style={styles.promoLabel}>Promote to:</Text>
            {PROMOTION_PIECES.map((p) => (
              <Pressable key={p} onPress={() => choosePromotion(p)} style={styles.promoBtn}>
                <Text style={styles.promoBtnText}>{p}</Text>
              </Pressable>
            ))}
          </View>
        )}

        {mode === 'reactions' && phase === 'setup' && (
          <Pressable onPress={handlePlay} style={styles.playBtn}>
            <Text style={styles.playBtnText}>▶ Play</Text>
          </Pressable>
        )}

        {/* Everything below is deliberately just above Reset, not at the
            top — these are the controls you reach for while actively
            drawing, not one-time setup like board style (now global). */}
        <View style={styles.row}>
          <Text style={styles.label}>Color</Text>
          <View style={styles.swatchRow}>
            {ARROW_KEYS.map((color) => (
              <Pressable
                key={color}
                onPress={() => {
                  setAnnotateColor(color);
                  setTool('annotate');
                  setSelected(null);
                }}
                hitSlop={9}
                style={[
                  styles.arrowSwatch,
                  { backgroundColor: arrowColors[color] },
                  tool === 'annotate' && annotateColor === color && styles.swatchActive
                ]}
              />
            ))}
          </View>
          <View style={{ flex: 1 }} />
          <Pressable onPress={clearAnnotations} style={styles.toolBtn}>
            <Text style={styles.toolBtnText}>✖</Text>
          </Pressable>
        </View>

        <View style={styles.row}>
          <Pressable onPress={() => setTool('move')} style={[styles.toolBtn, tool === 'move' && styles.toolBtnActive]}>
            <Text style={[styles.toolBtnText, tool === 'move' && styles.toolBtnTextActive]}>✥</Text>
          </Pressable>
          <View style={{ flex: 1 }} />
          <View style={styles.navGroup}>
            <Pressable onPress={handleBack} disabled={!canBack} style={[styles.toolBtn, !canBack && styles.stepBtnDisabled]}>
              <Text style={styles.toolBtnText}>‹</Text>
            </Pressable>
            <Pressable onPress={handleForward} disabled={!canForward} style={[styles.toolBtn, !canForward && styles.stepBtnDisabled]}>
              <Text style={styles.toolBtnText}>›</Text>
            </Pressable>
          </View>
        </View>

        {mode === 'reactions' && phase === 'playing' && (
          <>
            <View style={styles.notationHeaderRow}>
              <Text style={styles.notationHeaderText}>Recording</Text>
              <Pressable
                onPress={() =>
                  alertDialog(
                    "Every move you play on the board is added to the notation below. Tap a move to jump back to that position — playing a different move from there starts a variation. Long-press a move to delete it and everything after it. Use ‹ / › (above) to step through the line one move at a time. Tap Save (top right) whenever you're done."
                  )
                }
                hitSlop={10}
                style={styles.infoBtn}
              >
                <Text style={styles.infoBtnText}>ⓘ</Text>
              </Pressable>
            </View>
            <Notation
              recording={board.recording}
              cursorId={cursorId}
              yourColor={yourColor}
              onJump={(id) => {
                setCursorId(id);
                setSelected(null);
              }}
              onDelete={handleDeleteMove}
            />
          </>
        )}

        {mode === 'others' && side === 'front' && (
          <Pressable onPress={handleApplyToBack} style={styles.applyBtn}>
            <Text style={styles.applyBtnText}>Apply to Back</Text>
          </Pressable>
        )}

        <Pressable onPress={handleReset} style={styles.resetBtn}>
          <Text style={styles.resetBtnText}>Reset board</Text>
        </Pressable>

        {isOthers && (
          <Pressable onPress={handleFlip} style={styles.flipBtn}>
            <Text style={styles.flipBtnText}>{side === 'front' ? 'Flip to Back' : 'Flip to Front'}</Text>
          </Pressable>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

// Flat, indented PGN-style notation: the main line reads left to right;
// each variation (a node that isn't its parent's first child) starts a new
// indented "(...)" line directly under the move it branches from. Tap a
// move to jump to it; long-press to delete it and everything after it in
// that branch (a destructive action gated behind its own confirmation, so
// a long-press alone can't accidentally lose recorded work).
function Notation({
  recording,
  cursorId,
  yourColor,
  onJump,
  onDelete
}: {
  recording: MoveNode[];
  cursorId: string | null;
  yourColor: 'w' | 'b';
  onJump: (id: string | null) => void;
  onDelete: (id: string) => void;
}) {
  // Walks the line starting at `startNode`, following children[0] as the
  // main continuation and emitting an indented "(...)" block for every
  // extra child (a variation branching off at that ply).
  function renderLine(startNode: MoveNode, moveNumberStart: number, startsWithWhite: boolean, depth: number): React.ReactNode[] {
    const out: React.ReactNode[] = [];
    let moveNumber = moveNumberStart;
    let whiteToMove = startsWithWhite;
    let node: MoveNode | undefined = startNode;
    let first = true;
    while (node) {
      const prefix = whiteToMove ? `${moveNumber}. ` : first ? `${moveNumber}... ` : '';
      const current: MoveNode = node;
      const isYours = (whiteToMove ? 'w' : 'b') === yourColor;
      out.push(
        <Text
          key={current.id}
          onPress={() => onJump(current.id)}
          onLongPress={() => onDelete(current.id)}
          style={[
            notationStyles.move,
            isYours && notationStyles.moveYours,
            current.id === cursorId && notationStyles.moveActive
          ]}
        >
          {prefix}
          {current.san}{' '}
        </Text>
      );
      if (!whiteToMove) moveNumber += 1;
      whiteToMove = !whiteToMove;
      first = false;

      if (current.children.length > 1) {
        for (let v = 1; v < current.children.length; v++) {
          out.push(
            <View key={`${current.id}-var-${v}`} style={[notationStyles.variation, { marginLeft: (depth + 1) * 14 }]}>
              <Text style={notationStyles.varOpen}>(</Text>
              {renderLine(current.children[v], moveNumber, current.turnAfter === 'w', depth + 1)}
              <Text style={notationStyles.varOpen}>)</Text>
            </View>
          );
        }
      }
      node = current.children[0];
    }
    return out;
  }

  if (recording.length === 0) return null;

  // recording[0].turnAfter === 'b' means White just moved, so the line
  // starts on White's move ("1. ..."); otherwise it starts on Black
  // ("1... ...") — depends on how many set-up moves preceded Play.
  const startsWithWhite = recording[0].turnAfter === 'b';

  return (
    <View style={notationStyles.wrap}>
      <Text onPress={() => onJump(null)} style={[notationStyles.move, cursorId === null && notationStyles.moveActive]}>
        Start{'  '}
      </Text>
      <View style={notationStyles.mainLine}>{renderLine(recording[0], 1, startsWithWhite, 0)}</View>
      {recording.length > 1 &&
        recording.slice(1).map((alt, i) => (
          <View key={`root-var-${i}`} style={[notationStyles.variation, { marginLeft: 14 }]}>
            <Text style={notationStyles.varOpen}>(</Text>
            {renderLine(alt, 1, startsWithWhite, 1)}
            <Text style={notationStyles.varOpen}>)</Text>
          </View>
        ))}
    </View>
  );
}

export function openReactionBoardEditor(
  board: ReactionBoard,
  mode: CardMode = 'reactions',
  yourColor: 'w' | 'b' = 'w',
  boardStyle = 0
): Promise<ReactionBoard | null> {
  return showOverlay<ReactionBoard | null>((close) => (
    <ReactionBoardEditorOverlay initial={board} mode={mode} yourColor={yourColor} boardStyle={boardStyle} close={close} />
  ));
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, paddingBottom: 32 },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  topBarBtn: { color: colors.textDim, ...type.body },
  saveBtn: { color: colors.accentHover, ...type.bodyStrong },
  title: { color: colors.text, ...type.h2 },
  sideLabel: { color: colors.textDim, fontSize: 12.5, fontWeight: '700', textAlign: 'center', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 },
  fieldLabel: { color: colors.textDim, fontSize: 12.5, marginBottom: 6, marginTop: 10 },
  textArea: {
    backgroundColor: colors.panel2,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    color: colors.text,
    padding: 12,
    fontSize: 14,
    minHeight: 60,
    textAlignVertical: 'top'
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 14 },
  label: { color: colors.textDim, fontSize: 12, minWidth: 70 },
  swatchRow: { flexDirection: 'row', gap: 8 },
  arrowSwatch: { width: 26, height: 26, borderRadius: 13, borderWidth: 2, borderColor: 'transparent' },
  swatchActive: { borderColor: colors.accent },
  navGroup: { flexDirection: 'row', gap: 10 },
  toolBtn: { width: 44, height: 44, borderRadius: 10, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.panel2, alignItems: 'center', justifyContent: 'center' },
  toolBtnActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  toolBtnText: { color: colors.text, fontSize: 18 },
  toolBtnTextActive: { color: colors.onPrimary },
  board: { alignSelf: 'center', borderRadius: 6, overflow: 'hidden', borderWidth: 1, borderColor: colors.border, marginTop: 20 },
  selectedHighlight: { backgroundColor: 'rgba(21,128,61,0.35)' },
  moveDot: { position: 'absolute', width: CELL * 0.28, height: CELL * 0.28, borderRadius: (CELL * 0.28) / 2, backgroundColor: 'rgba(21,128,61,0.55)' },
  captureRing: { position: 'absolute', width: CELL - 6, height: CELL - 6, borderRadius: (CELL - 6) / 2, borderWidth: 3, borderColor: 'rgba(220,38,38,0.85)' },
  promoRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12, alignSelf: 'center' },
  promoLabel: { color: colors.textDim, fontSize: 13, marginRight: 4 },
  promoBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  promoBtnText: { color: colors.onPrimary, fontWeight: '700' },
  playBtn: { marginTop: 16, backgroundColor: colors.primary, borderRadius: radius.pill, paddingVertical: 14, alignItems: 'center' },
  playBtnText: { color: colors.onPrimary, fontSize: 15.5, fontWeight: '700' },
  notationHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 14, marginBottom: 2 },
  notationHeaderText: { color: colors.textDim, fontSize: 12.5, fontWeight: '600' },
  infoBtn: { width: 22, height: 22, borderRadius: 11, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  infoBtnText: { color: colors.textDim, fontSize: 13, fontWeight: '700' },
  stepBtnDisabled: { opacity: 0.4 },
  applyBtn: { marginTop: 14, backgroundColor: colors.panel2, borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  applyBtnText: { color: colors.text, fontSize: 14, fontWeight: '600' },
  resetBtn: { marginTop: 14, backgroundColor: colors.panel2, borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingVertical: 13, alignItems: 'center' },
  resetBtnText: { color: colors.text, fontSize: 15, fontWeight: '600' },
  flipBtn: { marginTop: 10, backgroundColor: colors.primary, borderRadius: radius.pill, paddingVertical: 13, alignItems: 'center' },
  flipBtnText: { color: colors.onPrimary, fontSize: 15, fontWeight: '700' }
});

const notationStyles = StyleSheet.create({
  wrap: { backgroundColor: colors.panel, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: 12, marginTop: 16 },
  mainLine: { flexDirection: 'row', flexWrap: 'wrap' },
  move: { color: colors.text, fontSize: 14.5 },
  moveYours: { color: colors.primary },
  // Orange, not colors.accent (identical to moveYours' green) — the cursor
  // needs to stand out from "a move I played", not blend into it.
  moveActive: { color: colors.gold, fontWeight: '700' },
  variation: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 4 },
  varOpen: { color: colors.textDim, fontSize: 13 }
});
