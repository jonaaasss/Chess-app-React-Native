import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, PanResponder, PanResponderInstance, ScrollView, ActivityIndicator } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { allSquares, cloneBoardFace, flipIndex, squareFromIndex, squareIndex, startingPosition, toFen } from '../chess';
import { legalMovesFrom, makeMove, isPromotionMove, type GameState } from '../chessEngine';
import type { Arrow, ArrowColor, BoardFace, BoardMove, CardMode, Circle, MoveNode, PromotionPiece, ReactionBoard } from '../types';
import { arrowColors, boardStyles, colors, engineColors, radius, spacing, type, variationColor } from '../theme';
import { CirclesSvg, PieceGlyph, NumberedArrowsSvg, NumberedArrowBadges, type NumberedArrow } from '../components/ChessBoard';
import { usePieceAnimation, PieceAnimationGhosts } from '../components/PieceAnimation';
import { alertDialog, confirmDialog, dismissSnackbar, showOverlay, showSnackbar, SnackbarLayer, useOverlayBack } from '../overlay';
import { getBoardEditorTipHidden, setBoardEditorTipHidden, uid } from '../storage';
import { ModeTip } from '../components/ModeTip';
import { TutorialLayer, useTutorial, useTutorialTarget } from '../tutorial';
import { useStockfishEngine, type EngineLine } from '../engine/useStockfishEngine';

const ENGINE_ANALYSIS_DEBOUNCE_MS = 350;

const ARROW_KEYS = Object.keys(arrowColors) as ArrowColor[];
const BOARD_SIZE = 320;
const CELL = BOARD_SIZE / 8;
const PROMOTION_PIECES: PromotionPiece[] = ['Q', 'R', 'B', 'N'];

type Tool = 'move' | 'annotate';
type Side = 'front' | 'back';

// A touch this close (in board squares) to a continuation's arrow follows it.
const BRANCH_HIT = 0.3;

function distanceToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

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

// Compared square-by-square (not JSON.stringify) since `pieces` objects
// built by different code paths (allSquares' rank-major order vs.
// startingPosition's file-major order) can hold identical contents under
// different key insertion order.
function isStartingFace(face: BoardFace): boolean {
  const start = startingPosition();
  return (
    face.turn === 'w' &&
    face.enPassant === null &&
    face.castling.wK &&
    face.castling.wQ &&
    face.castling.bK &&
    face.castling.bQ &&
    allSquares().every((sq) => (face.pieces[sq] ?? null) === (start[sq] ?? null))
  );
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

// ---------- Engine analysis (eval bar + top moves) ----------

function evalLabel(line: EngineLine): string {
  if (line.mate !== null) return `M${Math.abs(line.mate)}`;
  if (line.cp !== null) return `${line.cp > 0 ? '+' : ''}${(line.cp / 100).toFixed(1)}`;
  return '';
}

// A vertical bar next to the board showing the best line's evaluation from
// White's perspective — filled white/dark proportionally on a logistic
// curve (not linear), so small edges near equal still read as "close" and
// big ones saturate instead of needing an unbounded scale. Flips which end
// is White's when the board itself is flipped, so it always agrees with
// whichever side is visually on top. The track itself is pinned to exactly
// `height` — matching the board's own height, top-to-top and bottom-to-
// bottom — so the track's true middle lands exactly on the board's middle.
// The number floats above that box (absolutely positioned, so it doesn't
// add to its height) rather than sharing space inside it.
function EngineEvalBar({ lines, flipped, height }: { lines: EngineLine[]; flipped: boolean; height: number }) {
  const best = lines.find((l) => l.multipv === 1);
  let whiteShare = 0.5;
  if (best) {
    if (best.mate !== null) whiteShare = best.mate > 0 ? 1 : 0;
    else if (best.cp !== null) whiteShare = 1 / (1 + Math.exp(-best.cp / 300));
  }
  return (
    <View style={[evalBarStyles.wrap, { height }]}>
      <Text style={evalBarStyles.label}>{best ? evalLabel(best) : '—'}</Text>
      <View style={[evalBarStyles.track, { height, justifyContent: flipped ? 'flex-start' : 'flex-end' }]}>
        <View style={{ width: '100%', height: `${whiteShare * 100}%`, backgroundColor: '#e7e9ee' }} />
        {/* Marks the 0.0/even point at the bar's actual midpoint — always
            here regardless of `flipped`, since that only changes which end
            is White's, not where "even" sits. */}
        <View style={evalBarStyles.centerLine} pointerEvents="none" />
      </View>
    </View>
  );
}

const evalBarStyles = StyleSheet.create({
  wrap: { alignItems: 'center', marginLeft: 10 },
  label: {
    position: 'absolute',
    top: -20,
    left: -20,
    right: -20,
    textAlign: 'center',
    color: colors.textDim,
    fontSize: 12,
    fontWeight: '700'
  },
  track: {
    width: 22,
    borderRadius: 4,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: '#2b2f36'
  },
  centerLine: { position: 'absolute', left: 0, right: 0, top: '50%', height: 1, backgroundColor: 'rgba(148,163,184,0.9)' }
});

// Same circular-arrow glyph as Study's RewindIcon (just smaller) — signals
// the Front/Back label is tappable (flips the board) rather than just a
// static status indicator. Drawn as a path rather than a Unicode glyph per
// this app's convention for icons that need to look intentional.
function FlipIcon({ size, color }: { size: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path
        d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"
        fill={color}
      />
    </Svg>
  );
}

const MULTIPV_SLOTS = [1, 2, 3];

// Top-3 engine moves shown above the board, one per line ("+0.2 1.e4"),
// deliberately no continuation (that's what the arrows on the board are
// for). Always renders all 3 slots in the exact same row layout — a slot
// without a line yet (engine not ready, position not analyzed, or just that
// particular multipv hasn't come back) shows an inline "Loading…" spinner
// in place of the move/eval text rather than swapping to a different panel
// shape, so the panel never resizes or jumps as results arrive. Tap a
// resolved line to play it on the board directly.
function EngineMovesRow({
  lines,
  engineState,
  onPlayMove,
  panelRef
}: {
  lines: EngineLine[];
  engineState: GameState;
  onPlayMove: (line: EngineLine) => void;
  // Lets the tutorial spotlight the panel.
  panelRef?: React.RefObject<View | null>;
}) {
  const movePrefix = engineState.turn === 'w' ? '1.' : '1...';
  return (
    <View ref={panelRef} collapsable={false} style={engineMovesStyles.panel}>
      {MULTIPV_SLOTS.map((slot) => {
        const isBest = slot === 1;
        const rowStyle = [engineMovesStyles.row, isBest && engineMovesStyles.rowBest, slot !== MULTIPV_SLOTS.length && engineMovesStyles.rowDivider];
        const line = lines.find((l) => l.multipv === slot);
        if (!line) {
          return (
            <View key={slot} style={rowStyle}>
              <Text style={[engineMovesStyles.rank, isBest && engineMovesStyles.rankBest]}>{slot}</Text>
              <View style={engineMovesStyles.loadingInline}>
                <ActivityIndicator size="small" color={colors.textDim} />
                <Text style={engineMovesStyles.loadingText}>Loading…</Text>
              </View>
            </View>
          );
        }
        let san = `${line.from}${line.to}`;
        try {
          san = makeMove(engineState, line.from, line.to, line.promotion).san;
        } catch {
          // A line from a search that hasn't caught up to the latest
          // position yet — show the raw squares rather than crash.
        }
        return (
          <Pressable key={slot} onPress={() => onPlayMove(line)} style={rowStyle}>
            <Text style={[engineMovesStyles.rank, isBest && engineMovesStyles.rankBest]}>{slot}</Text>
            <Text style={[engineMovesStyles.move, isBest && engineMovesStyles.moveBest]}>
              {movePrefix}
              {san}
            </Text>
            <Text style={[engineMovesStyles.eval, isBest && engineMovesStyles.evalBest]}>{evalLabel(line)}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const engineMovesStyles = StyleSheet.create({
  panel: {
    marginTop: 16,
    marginBottom: 10,
    backgroundColor: colors.panel2,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    overflow: 'hidden'
  },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 7, paddingHorizontal: 12, gap: 10 },
  loadingInline: { flexDirection: 'row', alignItems: 'center', flex: 1, gap: 8 },
  loadingText: { color: colors.textDim, fontSize: 13, fontWeight: '600' },
  rowDivider: { borderBottomWidth: 1, borderBottomColor: colors.border },
  rowBest: { backgroundColor: 'rgba(59,130,246,0.14)' },
  rank: { color: colors.textDim, fontSize: 11, fontWeight: '700', width: 12, textAlign: 'center' },
  rankBest: { color: engineColors.best },
  move: { color: colors.text, fontSize: 14, fontWeight: '600', flex: 1 },
  moveBest: { color: engineColors.best, fontWeight: '700' },
  eval: { color: colors.textDim, fontSize: 13, fontWeight: '600' },
  evalBest: { color: engineColors.best }
});

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
  // The board as it was when this editor opened, to tell whether there's
  // anything to lose on Cancel.
  const initialJson = useRef('');
  if (!initialJson.current) initialJson.current = JSON.stringify(initial);
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
  // The board is also the tutorial's spotlight target, hence this hook rather
  // than a plain ref (it's still what measureGrid measures).
  const gridRef = useTutorialTarget('boardEditor.board');
  const playRef = useTutorialTarget('boardEditor.play');
  const backRef = useTutorialTarget('boardEditor.back');
  const notationRef = useTutorialTarget('boardEditor.notation');
  const saveRef = useTutorialTarget('boardEditor.save');
  const tipRef = useTutorialTarget('boardEditor.tip');
  const swatchesRef = useTutorialTarget('boardEditor.swatches');
  const swatchGreenRef = useTutorialTarget('boardEditor.swatch.green');
  const swatchOrangeRef = useTutorialTarget('boardEditor.swatch.orange');
  const engineMovesRef = useTutorialTarget('boardEditor.engineMoves');
  const boardRowRef = useTutorialTarget('boardEditor.boardRow');
  const descriptionRef = useTutorialTarget('boardEditor.description');
  const insets = useSafeAreaInsets();

  // Make-your-first-card tutorial. While one of its board-editor steps is up
  // the editor is "guided": the engine's suggestions (clickable, and they'd
  // pull the user off the move being asked for) and the tip box are hidden,
  // and a step that asks for one specific move accepts only that move.
  const tutorial = useTutorial();
  useOverlayBack(() => handleCancel());
  const guided = tutorial.step?.surface === 'boardEditor';
  const expectMove = guided ? tutorial.step?.expectMove : undefined;
  const expectArrow = guided ? tutorial.step?.expectArrow : undefined;
  // Hidden while guided, except during the steps that point at them.
  const hideEngine = guided && !tutorial.step?.showEngine;

  // The how-it-works tip: shown by default, closable with its ✕ and
  // reopenable via the ⓘ next to the title, remembered per mode. null until
  // the saved flag has loaded, so a tip you've hidden never flashes open.
  const [tipHidden, setTipHiddenState] = useState<boolean | null>(null);
  useEffect(() => {
    getBoardEditorTipHidden(mode).then(setTipHiddenState);
  }, [mode]);
  const tipOpen = tipHidden === false;
  function setTipHidden(hidden: boolean) {
    setTipHiddenState(hidden);
    setBoardEditorTipHidden(mode, hidden);
  }

  const activeFace: BoardFace = side === 'front' ? board.front : board.back;

  // Whether a description has been typed (a tutorial step can require it).
  const { setFlag } = tutorial;
  useEffect(() => {
    setFlag('description', activeFace.text.trim().length > 0);
  }, [activeFace.text, setFlag]);
  // A tutorial step that suggests a description writes it into the field when
  // it starts — but never over something the user already typed.
  const prefillDescription = guided ? tutorial.step?.prefillDescription : undefined;
  useEffect(() => {
    if (prefillDescription && !activeFace.text.trim()) {
      setBoard((prev) => ({ ...prev, [side]: { ...prev[side], text: prefillDescription } }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefillDescription]);

  // Others/Plan only — how many of `activeFace.moves` are currently
  // "applied"/visible. Equal to `activeFace.moves.length` means you're at
  // the live head (matching `activeFace.pieces`, which is always kept at
  // the head); a smaller value means you've stepped back to review how the
  // position was built. Reset on every flip to the newly active face's own
  // head, since Others' two faces can have differently-sized histories.
  const [historyIndex, setHistoryIndex] = useState(isPlan ? initial.back.moves.length : initial.front.moves.length);
  // `>=`, not `===` — if historyIndex is ever stale/out of range for
  // `activeFace` (e.g. it was captured against the other face, or a face
  // was just replaced wholesale by Apply-to-Back/Reset), treating anything
  // past the end as "at head" falls back to the always-safe
  // `activeFace.pieces` below instead of indexing off the end of `moves`.
  const atHead = historyIndex >= activeFace.moves.length;

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

  // Engine analysis — runs for whatever position is currently on screen,
  // in any mode/phase. Debounced so rapid moves/navigation don't spam the
  // engine with a search per intermediate position.
  const engine = useStockfishEngine();
  const fen = toFen(engineState.pieces, engineState.turn, engineState.castling, engineState.enPassant);
  useEffect(() => {
    if (!engine.ready) return;
    const t = setTimeout(() => engine.evaluate(fen, fen.split(' ')[1] as 'w' | 'b'), ENGINE_ANALYSIS_DEBOUNCE_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine.ready, fen]);
  // Only trust `engine.lines` once they actually belong to the position
  // currently on screen — otherwise a slow-to-cancel previous search could
  // flash stale arrows/eval for a moment after a move.
  const engineLines = engine.analyzedFen === fen ? engine.lines : [];

  // Where the recorded line branches (two or more continuations from this
  // position): one numbered arrow per continuation, 1 being the main line
  // that › plays, the rest in the order they're listed in the notation. Not
  // while a tutorial step is asking for one specific move. Two promotions on
  // the same squares share one arrow.
  const branchChoices = useMemo(() => {
    if (!isReactions || phase !== 'playing' || expectMove) return [];
    const seen = new Set<string>();
    const choices = (cursorNode ? cursorNode.children : board.recording)
      .map((node, i) => ({ node, number: i + 1 }))
      .filter(({ node }) => {
        const key = node.from + node.to;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    return choices.length >= 2 ? choices : [];
  }, [isReactions, phase, expectMove, cursorNode, board.recording]);
  const branchArrows: NumberedArrow[] = branchChoices.map(({ node, number }) => ({
    id: `branch-${node.id}`,
    from: node.from,
    to: node.to,
    color: variationColor,
    number
  }));

  // The engine's own arrows would sit on top of the same moves; its panel and
  // eval bar stay.
  const engineArrows: NumberedArrow[] = (hideEngine || branchChoices.length > 0 ? [] : engineLines).map((line) => ({
    id: `engine-${line.multipv}`,
    from: line.from,
    to: line.to,
    color: line.multipv === 1 ? engineColors.best : engineColors.alt,
    width: line.multipv === 1 ? 0.22 : 0.15
  }));

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

  // The continuation whose arrow a touch landed on, if any. Selecting a piece
  // always wins: a piece of the side to move under the touch is never taken
  // over by an arrow passing through its square (the arrow's own start square
  // holds exactly such a piece).
  function branchAt(pageX: number, pageY: number, sq: string): MoveNode | null {
    if (branchChoices.length === 0) return null;
    const under = engineState.pieces[sq];
    if (under && under[0] === engineState.turn) return null;
    const px = (pageX - gridOrigin.current.x) / CELL;
    const py = (pageY - gridOrigin.current.y) / CELL;
    const center = (square: string) => {
      const raw = squareIndex(square);
      return { x: flipIndex(raw.file, flipped) + 0.5, y: flipIndex(raw.rank, flipped) + 0.5 };
    };
    let best: MoveNode | null = null;
    let bestDistance = BRANCH_HIT;
    // Numbered in order, so on an exact tie the lower number wins.
    for (const { node } of branchChoices) {
      const a = center(node.from);
      const b = center(node.to);
      const d = distanceToSegment(px, py, a.x, a.y, b.x, b.y);
      if (d < bestDistance) {
        best = node;
        bestDistance = d;
      }
    }
    return best;
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
      tutorial.event('moved');
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
      tutorial.event('moved');
      return;
    }

    const siblings = cursorNode ? cursorNode.children : board.recording;
    const existing = siblings.find((n) => n.from === from && n.to === to && n.promotion === promotion);
    if (existing) {
      setCursorId(existing.id);
      setSelected(null);
      tutorial.event('moved');
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
    tutorial.event('moved');
  }

  function handleSquareTap(sq: string) {
    // A tutorial step asking for one specific move: piece first, then its
    // destination; every other tap is ignored (tapping the picked piece again
    // just puts it back down).
    if (expectMove) {
      if (!selected) {
        if (sq !== expectMove.from) return;
      } else if (sq !== expectMove.to) {
        if (sq === selected) setSelected(null);
        return;
      }
    }
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

  // Tapping a resolved engine line plays it directly — the engine already
  // resolved any promotion piece as part of its own best move, so there's no
  // need to route this through the promotion picker like a manual move.
  function playEngineMove(line: EngineLine) {
    finishMove(line.from, line.to, line.promotion);
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
      // In the move tool, dragging across the board never does anything —
      // only a tap (select) followed by another tap (destination) moves a
      // piece — so a drag that turns out to be a scroll gesture can safely
      // be handed over to the enclosing ScrollView. Annotate mode must keep
      // it: dragging there draws an arrow, so the ScrollView must not be
      // able to steal it mid-gesture.
      onPanResponderTerminationRequest: () => tool === 'move',
      // PanResponder blocks Android's native view hierarchy (the
      // ScrollView's own touch interception) from ever seeing the gesture
      // by default, regardless of the JS-level termination request above —
      // that's the actual reason scrolling was still fully dead over the
      // board in move mode. This is the Android-specific switch that
      // actually lets it through.
      onShouldBlockNativeResponder: () => tool !== 'move',
      onPanResponderGrant: (evt) => {
        const { pageX, pageY } = evt.nativeEvent;
        measureGrid(() => {
          const sq = squareFromPage(pageX, pageY);
          if (!sq) return;
          if (tool === 'move') {
            // With nothing selected, a tap on one of the numbered arrows
            // follows that continuation, same as playing its move.
            const branch = !selected && !pendingPromotion ? branchAt(pageX, pageY, sq) : null;
            if (branch) {
              setCursorId(branch.id);
              return;
            }
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
        if (expectArrow) {
          // A tutorial step asking for one specific arrow: exactly that drag
          // draws it; anything else (other arrows, circles) is ignored.
          if (endSq && start === expectArrow.from && endSq === expectArrow.to) {
            addArrow({ from: start, to: endSq, color: expectArrow.color });
            tutorial.event('arrowDrawn');
          }
        } else if (endSq && endSq !== start) {
          addArrow({ from: start, to: endSq, color: annotateColor });
        } else {
          toggleCircle(start);
        }
        arrowStartRef.current = null;
        setTempArrow(null);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tool, annotateColor, board, cursorId, selected, pendingPromotion, branchChoices, phase, side, historyIndex, atHead, expectMove?.from, expectMove?.to, expectArrow?.from, expectArrow?.to, expectArrow?.color]);

  // "Arrows cleared" + Undo. Undo only puts the arrows back while nothing else
  // has changed on the board since; the moment something has, it goes away
  // (so it can never wipe moves played afterwards).
  const clearUndo = useRef<{ before: ReactionBoard; after: ReactionBoard | null; snackbar: number | null } | null>(null);
  useEffect(() => {
    const undo = clearUndo.current;
    if (!undo) return;
    if (undo.after === null) {
      if (board === undo.before) return;
      undo.after = board;
      undo.snackbar = showSnackbar({
        message: 'Arrows cleared',
        actionLabel: 'Undo',
        onAction: () => {
          setBoard((current) => (current === undo.after ? undo.before : current));
          clearUndo.current = null;
        }
      });
    } else if (board !== undo.after) {
      if (undo.snackbar !== null) dismissSnackbar(undo.snackbar);
      clearUndo.current = null;
    }
  }, [board]);
  useEffect(
    () => () => {
      const undo = clearUndo.current;
      if (undo?.snackbar != null) dismissSnackbar(undo.snackbar);
    },
    []
  );

  function handleClearArrows() {
    if (visibleArrows.length === 0 && visibleCircles.length === 0) return;
    clearUndo.current = { before: board, after: null, snackbar: null };
    clearAnnotations();
  }

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
    tutorial.event('playPressed');
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

  // Clears every recorded move and variation at once and drops back to
  // setup, so the starting position (what the board was when you pressed
  // Play, plus any arrows drawn before it) is kept and can be adjusted or
  // played again — unlike Reset board, which also throws that away.
  async function handleDeleteRecording() {
    const ok = await confirmDialog(
      'Delete the whole recording? All recorded moves and variations are removed. The starting position stays. This cannot be undone.'
    );
    if (!ok) return;
    setBoard((prev) => ({ ...prev, recording: [] }));
    setCursorId(null);
    setPhase('setup');
    setSelected(null);
  }

  function handleBack() {
    setSelected(null);
    if (isReactions) {
      if (phase === 'playing') {
        if (path.length === 0) return;
        setCursorId(path.length >= 2 ? path[path.length - 2].id : null);
        tutorial.event('backPressed');
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
    // Flipping to a back that's never been touched, while the front has a
    // real position on it, is almost always "I built the front, now let me
    // annotate the same position on the back" — so carry the front's
    // position/annotations/history over automatically (same as Apply to
    // Back), rather than dropping the user onto an empty starting board.
    if (next === 'back' && isStartingFace(board.back) && !isStartingFace(board.front)) {
      setBoard((prev) => ({ ...prev, back: { ...cloneBoardFace(prev.front), text: prev.back.text } }));
      setHistoryIndex(board.front.moves.length);
    } else {
      setHistoryIndex(board[next].moves.length);
    }
    setSide(next);
    setSelected(null);
    setTempArrow(null);
  }

  function handleApplyToBack() {
    // Position, annotations and move history come from the front — the
    // back's own text is a separate concern and stays exactly as it was.
    setBoard((prev) => ({ ...prev, back: { ...cloneBoardFace(prev.front), text: prev.back.text } }));
  }

  async function handleCancel() {
    // Not during the tutorial, which handles leaving on its own.
    if (!tutorial.step && JSON.stringify(board) !== initialJson.current) {
      const ok = await confirmDialog('Discard your changes?', { confirmLabel: 'Discard', cancelLabel: 'Keep editing' });
      if (!ok) return;
    }
    tutorial.event('boardCancel');
    close(null);
  }

  async function handleSave() {
    if (mode === 'plan' && board.back.arrows.length === 0) {
      await alertDialog(
        'A Plan board needs at least one arrow on its back — that arrow is the plan you\'ll have to reproduce in Study. If you don\'t want to use arrows here, switch this card to "Front & back" mode instead.'
      );
      return;
    }
    tutorial.event('boardSaved');
    close(board);
  }

  return (
    <SafeAreaView style={styles.overlay}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        <View style={styles.topBar}>
          <Pressable onPress={handleCancel} hitSlop={{ top: 14, bottom: 14, left: 14, right: 14 }}>
            <Text style={styles.topBarBtn}>Cancel</Text>
          </Pressable>
          <View style={styles.titleGroup}>
            <Text style={styles.title}>{mode === 'reactions' ? 'Reactions board' : 'Board editor'}</Text>
            <Pressable onPress={() => setTipHidden(tipOpen)} hitSlop={10}>
              <Text style={[styles.tipToggle, tipOpen && styles.tipToggleOpen]}>ⓘ</Text>
            </Pressable>
          </View>
          <Pressable ref={saveRef} collapsable={false} onPress={handleSave} hitSlop={{ top: 14, bottom: 14, left: 14, right: 14 }}>
            <Text style={[styles.topBarBtn, styles.saveBtn]}>Save</Text>
          </Pressable>
        </View>

        {guided && tutorial.step?.showTip ? (
          // Shown for the tutorial's intro whatever the user's own hidden/shown
          // setting is; it has nothing to close, that setting is left alone.
          <View ref={tipRef} collapsable={false}>
            <ModeTip mode={mode} />
          </View>
        ) : (
          tipOpen && !guided && <ModeTip mode={mode} onClose={() => setTipHidden(true)} />
        )}

        {engine.element}

        {isOthers && (
          <Pressable
            onPress={handleFlip}
            style={[styles.sideLabelBtn, side === 'back' && styles.sideLabelBtnBack]}
            hitSlop={6}
          >
            <Text style={styles.sideLabelText}>{side === 'front' ? 'SWITCH TO BACK' : 'SWITCH TO FRONT'}</Text>
            <View style={side === 'back' && styles.flipIconRotated}>
              <FlipIcon size={13} color={colors.onPrimary} />
            </View>
          </Pressable>
        )}

        {/* One Description field for every mode — for Others it follows
            the Flip button just like the position does (`side` is fixed to
            'front' for Reactions and 'back' for Plan, so `activeFace`
            already resolves to the right face in every case without
            needing to branch on mode here). */}
        <Text style={styles.fieldLabel}>Description</Text>
        <View ref={descriptionRef} collapsable={false}>
          <TextInput
            style={styles.textArea}
            value={activeFace.text}
            onChangeText={(text) => setBoard((prev) => ({ ...prev, [side]: { ...prev[side], text } }))}
            multiline
            placeholder="Shown in Study..."
            placeholderTextColor={colors.textDim}
          />
        </View>

        {!hideEngine && (
          <EngineMovesRow lines={engineLines} engineState={engineState} onPlayMove={playEngineMove} panelRef={engineMovesRef} />
        )}

        <View ref={boardRowRef} collapsable={false} style={styles.boardRow}>
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
            <NumberedArrowsSvg arrows={engineArrows} size={BOARD_SIZE} flipped={flipped} />
            <NumberedArrowsSvg arrows={numberedArrows} size={BOARD_SIZE} flipped={flipped} />
            <NumberedArrowsSvg arrows={branchArrows} size={BOARD_SIZE} flipped={flipped} />
            <CirclesSvg circles={visibleCircles} size={BOARD_SIZE} flipped={flipped} />
            <NumberedArrowBadges arrows={committedNumberedArrows} size={BOARD_SIZE} flipped={flipped} />
            <NumberedArrowBadges arrows={branchArrows} size={BOARD_SIZE} flipped={flipped} />
            <PieceAnimationGhosts ghosts={ghosts} cell={CELL} />
          </View>
        </View>
        {!hideEngine && <EngineEvalBar lines={engineLines} flipped={flipped} height={BOARD_SIZE} />}
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
          <Pressable ref={playRef} collapsable={false} onPress={handlePlay} style={styles.playBtn}>
            <Text style={styles.playBtnText}>▶ Play</Text>
          </Pressable>
        )}

        {/* Everything below is deliberately just above Reset, not at the
            top — these are the controls you reach for while actively
            drawing, not one-time setup like board style (now global). */}
        <View style={styles.row}>
          <Text style={styles.label}>Arrow</Text>
          <View ref={swatchesRef} collapsable={false} style={styles.swatchRow}>
            {ARROW_KEYS.map((color) => (
              <Pressable
                key={color}
                ref={color === 'green' ? swatchGreenRef : color === 'orange' ? swatchOrangeRef : undefined}
                collapsable={false}
                onPress={() => {
                  setAnnotateColor(color);
                  setTool('annotate');
                  setSelected(null);
                  tutorial.event(`colorPicked:${color}`);
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
          <Pressable onPress={handleClearArrows} style={styles.toolBtn}>
            <Text style={styles.toolBtnText}>✖</Text>
          </Pressable>
        </View>

        {mode === 'reactions' && phase === 'playing' && (
          <>
            <View style={styles.notationHeaderRow}>
              <Text style={styles.notationHeaderText}>Recording</Text>
              <View style={styles.notationHeaderActions}>
                <Pressable onPress={handleDeleteRecording} hitSlop={8}>
                  <Text style={styles.deleteRecordingText}>Delete recording</Text>
                </Pressable>
                <Pressable
                  onPress={() =>
                    alertDialog(
                      "Every move you play on the board is added to the notation below. Tap a move to jump back to that position — playing a different move from there starts a variation. Long-press a move to delete it and everything after it, or use \"Delete recording\" to clear the whole recording and start over from the starting position. Use ‹ / › (above) to step through the line one move at a time. Tap Save (top right) whenever you're done."
                    )
                  }
                  hitSlop={10}
                  style={styles.infoBtn}
                >
                  <Text style={styles.infoBtnText}>?</Text>
                </Pressable>
              </View>
            </View>
            <View ref={notationRef} collapsable={false}>
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
            </View>
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
      </ScrollView>

      {/* Fixed below the ScrollView (not part of its scrollable content) and
          padded out to the safe-area inset so the move tool is always fully
          visible on screen the moment this editor opens, regardless of
          device height or scroll position — no more relying on the content
          above it happening to be short enough to fit. */}
      <View style={[styles.footer, { paddingBottom: insets.bottom + 10 }]}>
        <Pressable onPress={() => setTool('move')} style={[styles.toolBtn, tool === 'move' && styles.toolBtnActive]}>
          <Text style={[styles.toolBtnText, tool === 'move' && styles.toolBtnTextActive]}>✥</Text>
        </Pressable>
        <View style={{ flex: 1 }} />
        <View style={styles.navGroup}>
          <Pressable ref={backRef} collapsable={false} onPress={handleBack} disabled={!canBack} style={[styles.toolBtn, !canBack && styles.stepBtnDisabled]}>
            <Text style={styles.toolBtnText}>‹</Text>
          </Pressable>
          <Pressable onPress={handleForward} disabled={!canForward} style={[styles.toolBtn, !canForward && styles.stepBtnDisabled]}>
            <Text style={styles.toolBtnText}>›</Text>
          </Pressable>
        </View>
      </View>
      <SnackbarLayer bottom={76} />
      <TutorialLayer surface="boardEditor" flipped={flipped} />
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
  return showOverlay<ReactionBoard | null>(
    (close) => (
      <ReactionBoardEditorOverlay initial={board} mode={mode} yourColor={yourColor} boardStyle={boardStyle} close={close} />
    ),
    { animation: 'none' }
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: colors.bg },
  scroll: { flex: 1 },
  content: { padding: 16, paddingBottom: 32 },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.bg
  },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  topBarBtn: { color: colors.textDim, ...type.body },
  saveBtn: { color: colors.accentHover, ...type.bodyStrong },
  title: { color: colors.text, ...type.h2 },
  titleGroup: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  tipToggle: { color: colors.textDim, fontSize: 18, fontWeight: '700' },
  tipToggleOpen: { color: colors.accent },
  sideLabelBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    alignSelf: 'center',
    backgroundColor: colors.primary,
    borderRadius: radius.pill,
    paddingVertical: 6,
    paddingHorizontal: 14,
    marginBottom: 8
  },
  sideLabelBtnBack: { backgroundColor: colors.danger },
  flipIconRotated: { transform: [{ rotate: '180deg' }] },
  sideLabelText: { color: colors.onPrimary, fontSize: 12.5, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
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
  boardRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: 20 },
  board: { alignSelf: 'center', borderRadius: 6, overflow: 'hidden', borderWidth: 1, borderColor: colors.border },
  selectedHighlight: { backgroundColor: 'rgba(21,128,61,0.35)' },
  moveDot: { position: 'absolute', width: CELL * 0.28, height: CELL * 0.28, borderRadius: (CELL * 0.28) / 2, backgroundColor: 'rgba(21,128,61,0.55)' },
  captureRing: { position: 'absolute', width: CELL - 6, height: CELL - 6, borderRadius: (CELL - 6) / 2, borderWidth: 3, borderColor: 'rgba(220,38,38,0.85)' },
  promoRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12, alignSelf: 'center' },
  promoLabel: { color: colors.textDim, fontSize: 13, marginRight: 4 },
  promoBtn: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  promoBtnText: { color: colors.onPrimary, fontWeight: '700' },
  playBtn: { marginTop: 16, backgroundColor: colors.primary, borderRadius: radius.pill, paddingVertical: 14, alignItems: 'center' },
  playBtnText: { color: colors.onPrimary, fontSize: 15.5, fontWeight: '700' },
  notationHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 14, marginBottom: 2 },
  notationHeaderText: { color: colors.textDim, fontSize: 12.5, fontWeight: '600' },
  notationHeaderActions: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  deleteRecordingText: { color: colors.danger, fontSize: 12.5, fontWeight: '700' },
  infoBtn: { width: 22, height: 22, borderRadius: 11, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  infoBtnText: { color: colors.textDim, fontSize: 13, fontWeight: '700' },
  stepBtnDisabled: { opacity: 0.4 },
  applyBtn: { marginTop: 14, backgroundColor: colors.primary, borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  applyBtnText: { color: colors.onPrimary, fontSize: 14, fontWeight: '600' },
  resetBtn: { marginTop: 14, backgroundColor: colors.danger, borderRadius: 10, paddingVertical: 13, alignItems: 'center' },
  resetBtnText: { color: 'white', fontSize: 15, fontWeight: '600' },
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
