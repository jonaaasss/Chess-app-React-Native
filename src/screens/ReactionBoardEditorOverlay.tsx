import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, PanResponder, PanResponderInstance, ScrollView, ActivityIndicator } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  allSquares,
  cloneBoardFace,
  faceAnnotations,
  faceAnnotationsAt,
  flipIndex,
  squareFromIndex,
  squareIndex,
  startingPosition,
  toFen,
  withFaceAnnotationsAt
} from '../chess';
import { legalMovesFrom, makeMove, isPromotionMove, sansForBoardMoves, type GameState } from '../chessEngine';
import type { Arrow, ArrowColor, BoardFace, BoardMove, CardMode, Circle, MoveNode, PieceCode, PromotionPiece, ReactionBoard } from '../types';
import { arrowColors, boardStyles, colors, engineColors, radius, spacing, type, variationColor } from '../theme';
import { BoardCoords, CirclesSvg, PieceGlyph, NumberedArrowsSvg, NumberedArrowBadges, type NumberedArrow } from '../components/ChessBoard';
import { usePieceAnimation, PieceAnimationGhosts } from '../components/PieceAnimation';
import { alertDialog, confirmDialog, dismissSnackbar, showOverlay, showSnackbar, SnackbarLayer, useOverlayBack } from '../overlay';
import { hasArrowNotes } from '../arrowNotes';
import { openArrowNotesDialog } from './ArrowNotesOverlay';
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

// The "jump further back" button's Reactions logic: the nearest ancestor
// of the cursor (root-to-cursor `path`, from findPath) that has more than
// one child — i.e. a point where a variation branches off. Walks from the
// cursor's parent upward, excluding the cursor itself. `null` means no such
// ancestor exists (cursor sits on a plain, unbranched line back to the root).
function findPreviousBranch(path: MoveNode[]): string | null {
  for (let i = path.length - 2; i >= 0; i--) {
    if (path[i].children.length > 1) return path[i].id;
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
function EngineEvalBar({
  lines,
  stale,
  flipped,
  height
}: {
  lines: EngineLine[];
  stale?: boolean;
  flipped: boolean;
  height: number;
}) {
  const best = lines.find((l) => l.multipv === 1);
  let whiteShare = 0.5;
  if (best) {
    if (best.mate !== null) whiteShare = best.mate > 0 ? 1 : 0;
    else if (best.cp !== null) whiteShare = 1 / (1 + Math.exp(-best.cp / 300));
  }
  return (
    <View style={[evalBarStyles.wrap, { height }, stale && { opacity: 0.5 }]}>
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

// The description-badge glyph — a plain "+" when an arrow has no note yet, a
// small filled dot (see ArrowNoteBadges below) once it does, so the two
// states read as distinct at a glance rather than just a color change.
function PlusIcon({ size, color }: { size: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6z" fill={color} />
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
  stale,
  onPlayMove,
  panelRef
}: {
  lines: EngineLine[];
  engineState: GameState;
  // Showing the last result while the new position is analysed.
  stale?: boolean;
  onPlayMove: (line: EngineLine) => void;
  // Lets the tutorial spotlight the panel.
  panelRef?: React.RefObject<View | null>;
}) {
  const movePrefix = engineState.turn === 'w' ? '1.' : '1...';
  return (
    <View ref={panelRef} collapsable={false} style={[engineMovesStyles.panel, stale && { opacity: 0.5 }]}>
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
          <Pressable key={slot} onPress={() => onPlayMove(line)} disabled={stale} style={rowStyle}>
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

// Plan mode only: one tappable badge per arrow, offset to the side near the
// start (same side/perpendicular-offset math as ChessBoard's own
// NumberedArrowBadges, just closer to `from` so it doesn't collide with a
// same-color-group number badge further along the same arrow). A plain "+"
// means no note yet; a filled dot means one's already there — tap either way
// to open/edit it.
interface ArrowNoteTarget {
  id: string;
  from: string;
  to: string;
  hasDescription: boolean;
  onPress: () => void;
}

// Shared by ArrowNoteBadges (to draw the badge) and the board's own
// PanResponder (to know when a touch has landed on one, so it can let go and
// let the badge's own Pressable handle it instead of claiming the gesture
// for arrow-drawing/piece-moving).
const NOTE_BADGE_RADIUS = 11;

function noteBadgeCenter(from: string, to: string, size: number, flipped: boolean) {
  const cell = size / 8;
  function centerPx(square: string) {
    const raw = squareIndex(square);
    const file = flipIndex(raw.file, flipped);
    const rank = flipIndex(raw.rank, flipped);
    return { x: file * cell + cell / 2, y: rank * cell + cell / 2 };
  }
  const a = centerPx(from);
  const b = centerPx(to);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const px = a.x + dx * 0.35;
  const py = a.y + dy * 0.35;
  const nx = -dy / len;
  const ny = dx / len;
  const offset = 12;
  return { x: px + nx * offset, y: py + ny * offset };
}

// Nudges any badges that ended up overlapping apart from each other — two
// arrows starting close together (or nearly parallel) otherwise land their
// badges right on top of one another. A handful of relaxation passes:
// each overlapping pair is pushed apart along the line between their
// centers, repeated until nothing overlaps any more (or the pass limit
// runs out, for a pathological cluster of many badges at once).
const NOTE_BADGE_MIN_DIST = NOTE_BADGE_RADIUS * 2 + 6;

function separateNoteBadgeCenters(centers: { x: number; y: number }[]): { x: number; y: number }[] {
  const points = centers.map((c) => ({ ...c }));
  for (let iter = 0; iter < 8; iter++) {
    let moved = false;
    for (let i = 0; i < points.length; i++) {
      for (let j = i + 1; j < points.length; j++) {
        const dx = points[j].x - points[i].x;
        const dy = points[j].y - points[i].y;
        const dist = Math.hypot(dx, dy);
        if (dist >= NOTE_BADGE_MIN_DIST) continue;
        moved = true;
        // Coincident centers have no direction to push apart along — pick
        // an arbitrary one rather than dividing by zero.
        const ux = dist > 0.01 ? dx / dist : 1;
        const uy = dist > 0.01 ? dy / dist : 0;
        const push = (NOTE_BADGE_MIN_DIST - dist) / 2;
        points[i].x -= ux * push;
        points[i].y -= uy * push;
        points[j].x += ux * push;
        points[j].y += uy * push;
      }
    }
    if (!moved) break;
  }
  return points;
}

function noteBadgeCenters(arrows: { from: string; to: string }[], size: number, flipped: boolean): { x: number; y: number }[] {
  return separateNoteBadgeCenters(arrows.map((a) => noteBadgeCenter(a.from, a.to, size, flipped)));
}

function ArrowNoteBadges({ arrows, size, flipped }: { arrows: ArrowNoteTarget[]; size: number; flipped: boolean }) {
  const centers = useMemo(() => noteBadgeCenters(arrows, size, flipped), [arrows, size, flipped]);
  return (
    <>
      {arrows.map((a, i) => {
        const { x: bx, y: by } = centers[i];
        return (
          <Pressable
            key={a.id}
            onPress={a.onPress}
            hitSlop={8}
            style={[
              noteStyles.badge,
              { left: bx - NOTE_BADGE_RADIUS, top: by - NOTE_BADGE_RADIUS },
              a.hasDescription ? noteStyles.badgeFilled : noteStyles.badgeEmpty
            ]}
          >
            {a.hasDescription ? <View style={noteStyles.dot} /> : <PlusIcon size={12} color={colors.textDim} />}
          </Pressable>
        );
      })}
    </>
  );
}

const noteStyles = StyleSheet.create({
  badge: {
    position: 'absolute',
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1
  },
  badgeEmpty: { backgroundColor: colors.panel2, borderColor: colors.border },
  badgeFilled: { backgroundColor: colors.gold, borderColor: colors.gold },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.onGold }
});

// ---------- The overlay ----------

function ReactionBoardEditorOverlay({
  initial,
  mode,
  yourColor,
  boardStyle,
  initialCursorId,
  close
}: {
  initial: ReactionBoard;
  mode: CardMode;
  yourColor: 'w' | 'b';
  boardStyle: number;
  // Opened from Study: the move it was actually showing, so the editor
  // lands there instead of at the mainline's end. `undefined` (opened from
  // the card list, or Study wasn't reviewing a Reactions card) keeps the
  // old default.
  initialCursorId?: string | null;
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
    initial.recording.length > 0 ? (initialCursorId !== undefined ? initialCursorId : mainLineLeafId(initial.recording)) : null
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
  // Reactions' setup line's own "historyIndex" — how many of
  // `board.setupMoves` are applied/viewed, same idea as Others/Plan's
  // `historyIndex` over `activeFace.moves` below. Also doubles as the
  // "peek before Play" position once phase is 'playing' and cursorId is
  // null (see `setupPeeking`): a read-only look back at the setup line,
  // since the recording tree only ever branches off `cursorId`, never off
  // this index.
  const [setupIndex, setSetupIndex] = useState(initial.setupMoves.length);
  // If a peek back into the setup line (cursorId null, setupIndex behind
  // head) is interrupted by tapping straight into a recording move —
  // possible since the notation's setup segment and recording tree are
  // both always tappable — snap the peek back to head so a later Back from
  // the recording's own start resumes there, not from that stale index.
  useEffect(() => {
    if (isReactions && cursorId !== null) setSetupIndex(board.setupMoves.length);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cursorId]);
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

  // The how-it-works tip: open the first time this mode's editor is used (and
  // folded from then on — it takes up a good part of the screen), closable
  // with its ✕ and reopenable via the ⓘ next to the title, remembered per
  // mode. null until the saved flag has loaded, so a tip you've hidden never
  // flashes open.
  const [tipHidden, setTipHiddenState] = useState<boolean | null>(null);
  useEffect(() => {
    getBoardEditorTipHidden(mode).then((hidden) => {
      setTipHiddenState(hidden);
      if (!hidden) setBoardEditorTipHidden(mode, true);
    });
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

  // SAN isn't stored on BoardMove (unlike Reactions' MoveNode) — Others/Plan
  // always starts from the standard position and only ever advances via
  // legal moves, so it's always re-derivable by replaying `.moves` through
  // the engine. Doing it here instead of storing it means old saved cards
  // (from before this notation existed) display correctly with no migration.
  const activeFaceSans = useMemo(() => sansForBoardMoves(activeFace.moves), [activeFace.moves]);
  // Reactions only — the moves played before "Play", shown ahead of the
  // recording in the notation panel so the pre-Play line isn't invisible.
  const setupSans = useMemo(() => sansForBoardMoves(board.setupMoves), [board.setupMoves]);

  const path = useMemo(
    () => (isReactions && cursorId ? findPath(board.recording, cursorId) ?? [] : []),
    [isReactions, board.recording, cursorId]
  );
  const cursorNode = path.length > 0 ? path[path.length - 1] : null;

  // Reactions only. `setupAtHead` mirrors Others/Plan's `atHead`, but over
  // `board.setupMoves`/`board.pieces` instead of a face's own `.moves`.
  // Drives both phase==='setup' navigation and, at the recording root
  // (cursorId null) during phase==='playing', the read-only "peek before
  // Play" (`setupPeeking`) — moving a piece is disabled while peeking (see
  // finishMove/onPointerDown) since there's no sensible place for a new
  // move to go: not a step in `setupMoves` (that line already continued
  // into a recording), not a recording node (there's no cursor here).
  const setupAtHead = setupIndex >= board.setupMoves.length;
  const setupEngineState: GameState = setupAtHead
    ? { pieces: board.pieces, turn: board.turn, castling: board.castling, enPassant: board.enPassant }
    : setupIndex === 0
      ? { pieces: startingPosition(), turn: 'w', castling: { wK: true, wQ: true, bK: true, bQ: true }, enPassant: null }
      : {
          pieces: board.setupMoves[setupIndex - 1].piecesAfter,
          turn: board.setupMoves[setupIndex - 1].turnAfter,
          castling: board.setupMoves[setupIndex - 1].castlingAfter,
          enPassant: board.setupMoves[setupIndex - 1].enPassantAfter
        };
  const setupPeeking = isReactions && phase === 'playing' && cursorId === null && !setupAtHead;

  const engineState: GameState = isReactions
    ? cursorNode
      ? { pieces: cursorNode.piecesAfter, turn: cursorNode.turnAfter, castling: cursorNode.castlingAfter, enPassant: cursorNode.enPassantAfter }
      : setupEngineState
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

  // Others/Plan: each position in the (linear) history keeps its own
  // arrows/circles now (see chess.ts's faceAnnotationsAt) — stepping back
  // shows exactly what was drawn there, same idea as Reactions' per-node
  // add/remove for its tree.
  const { arrows: visibleArrows, circles: visibleCircles } = useMemo(() => {
    if (!isReactions) return faceAnnotationsAt(activeFace, historyIndex);
    return activeAnnotations(board, path);
  }, [isReactions, activeFace, historyIndex, board, path]);

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
  // While the next position is still being analysed the panel keeps showing
  // the last result, dimmed and not tappable, instead of three spinners (the
  // arrows are never kept: they'd point at the wrong position). It shows the
  // position they were for, so their notation still reads right.
  const lastEngine = useRef<{ lines: EngineLine[]; state: GameState } | null>(null);
  if (engineLines.length > 0) lastEngine.current = { lines: engineLines, state: engineState };
  const engineStale = engineLines.length === 0 && lastEngine.current !== null;
  const panelLines = engineStale ? lastEngine.current!.lines : engineLines;
  const panelState = engineStale ? lastEngine.current!.state : engineState;

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

  // While playing, plain Back only steps back within the recording itself
  // now (see handleBack) — reaching the setup line from here takes the "«"
  // button (see canBigBack below) or a direct tap in the notation instead.
  const canBack = isReactions
    ? phase === 'playing'
      ? path.length > 0
      : setupIndex > 0
    : historyIndex > 0;
  // "«" can still reach the setup line from the recording's own start
  // (handleBigBack warns first — see confirmPeekBeforeRecording), so it
  // stays enabled there even though plain Back no longer is.
  const canBigBack = isReactions
    ? phase === 'playing'
      ? path.length > 0 || setupIndex > 0
      : setupIndex > 0
    : historyIndex > 0;
  const canForward = isReactions
    ? phase === 'playing'
      ? (cursorNode ? cursorNode.children.length : board.recording.length) > 0 || setupIndex < board.setupMoves.length
      : setupIndex < board.setupMoves.length
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
        enPassantAfter: result.next.enPassant,
        // A brand-new position — nothing's been drawn on it yet. Whatever
        // was drawn on the position this move is played from is untouched:
        // it lives on that earlier move (or the face itself, for position 0),
        // neither of which this touches.
        arrowsAfter: [],
        circlesAfter: []
      };
      setBoard((prev) => {
        const movedFace = (old: BoardFace): BoardFace => ({
          ...old,
          pieces: result.next.pieces,
          turn: result.next.turn,
          castling: result.next.castling,
          enPassant: result.next.enPassant,
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

    if (phase === 'setup' || setupPeeking) {
      // Peeking back before Play and then playing a different move here
      // means the whole recording — built on top of the setup line as it
      // was — no longer has a position to stand on. It's left alone for now
      // rather than wiped immediately (so a peek that turns out not to lead
      // anywhere doesn't cost you anything): Play is what actually commits
      // to it, discarding the stale recording at that point (see handlePlay).
      if (setupPeeking) setPhase('setup');
      const setupMove: BoardMove = {
        from,
        to,
        promotion,
        piecesAfter: result.next.pieces,
        turnAfter: result.next.turn,
        castlingAfter: result.next.castling,
        enPassantAfter: result.next.enPassant,
        // setupMoves never carries per-position annotations (unlike
        // BoardFace.moves for Others/Plan) — the same BoardMove shape is
        // reused here, so these are just always empty.
        arrowsAfter: [],
        circlesAfter: []
      };
      // Rewinding (setupIndex < setupMoves.length) and then playing a
      // different move truncates the rest of the line, same as Others/Plan's
      // own `.moves` — this list is linear, not a branching tree.
      setBoard((prev) => ({
        ...prev,
        pieces: result.next.pieces,
        turn: result.next.turn,
        castling: result.next.castling,
        enPassant: result.next.enPassant,
        arrows: [],
        circles: [],
        setupMoves: [...prev.setupMoves.slice(0, setupIndex), setupMove]
      }));
      setSetupIndex((i) => i + 1);
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

  // Reactions' arrows/circles can only ever be drawn once the recording has
  // actually started — never during setup at all (not even at its own
  // head), and not while peeking back into the setup line from inside a
  // recording either. There's no per-position storage for them the way
  // Others/Plan's history (or the recording tree) has, so they're only ever
  // "whatever's on the recording's own starting position" — drawing earlier
  // than that would silently land on that one shared field regardless of
  // which position is actually on screen.
  async function ensureSetupHeadForDrawing(): Promise<boolean> {
    if (phase === 'playing' && setupAtHead) return true;
    await alertDialog(
      phase === 'setup'
        ? 'Arrows and circles can only be drawn once the recording has started — press Play first.'
        : "You're viewing an earlier position. Arrows and circles only belong to the recording's own starting position — step forward to it first."
    );
    return false;
  }

  // Drawing the same arrow (same from/to) again toggles it off if the color
  // matches, or replaces it if the color differs — same rule toggleCircle
  // already uses for circles on a square.
  async function addArrow(arrow: Arrow) {
    const existing = visibleArrows.find((a) => sameArrowSpan(a, arrow));
    const isSameColor = existing?.color === arrow.color;

    if (!isReactions) {
      setBoard((prev) => {
        const at = faceAnnotationsAt(prev[side], historyIndex);
        let arrows = at.arrows.filter((a) => !sameArrowSpan(a, arrow));
        if (!isSameColor) arrows = [...arrows, arrow];
        return { ...prev, [side]: withFaceAnnotationsAt(prev[side], historyIndex, arrows, at.circles) };
      });
      return;
    }

    if (cursorId === null) {
      if (!(await ensureSetupHeadForDrawing())) return;
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

  // Plan mode only — the "+"/note badge's popup. Matched by from/to span
  // rather than array index, since a span is unique within one face's arrow
  // list (see addArrow above) and stays stable across re-renders.
  async function handleArrowNote(arrow: Arrow) {
    const result = await openArrowNotesDialog(arrow.notes);
    if (result === null) return;
    setBoard((prev) => {
      const at = faceAnnotationsAt(prev[side], historyIndex);
      const arrows = at.arrows.map((a) => (sameArrowSpan(a, arrow) ? { ...a, notes: result.notes } : a));
      return { ...prev, [side]: withFaceAnnotationsAt(prev[side], historyIndex, arrows, at.circles) };
    });
  }

  function clearAnnotations() {
    if (visibleArrows.length === 0 && visibleCircles.length === 0) return;

    if (!isReactions) {
      setBoard((prev) => ({ ...prev, [side]: withFaceAnnotationsAt(prev[side], historyIndex, [], []) }));
      return;
    }

    if (cursorId === null) {
      // Same restriction as drawing (see ensureSetupHeadForDrawing) — arrows/
      // circles only ever belong to the recording's own starting position.
      // Silent no-op rather than an error: unlike drawing something new,
      // there's no action here that could reasonably surprise you by
      // silently doing nothing.
      if (!(phase === 'playing' && setupAtHead)) return;
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

  async function toggleCircle(square: string) {
    const existing = visibleCircles.find((c) => c.square === square);
    const isSameColor = existing?.color === annotateColor;

    if (!isReactions) {
      setBoard((prev) => {
        const at = faceAnnotationsAt(prev[side], historyIndex);
        let circles = at.circles.filter((c) => c.square !== square);
        if (!isSameColor) circles = [...circles, { square, color: annotateColor }];
        return { ...prev, [side]: withFaceAnnotationsAt(prev[side], historyIndex, at.arrows, circles) };
      });
      return;
    }

    if (cursorId === null) {
      if (!(await ensureSetupHeadForDrawing())) return;
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

  // A touch landing on a Plan arrow's "+"/note badge has to be left for that
  // badge's own Pressable — this responder otherwise always wants a Plan
  // touch (same `!setupPeeking` fallback below, which is always true outside
  // Reactions) and would claim it first, so the badge's onPress never fires.
  function hitsArrowNoteBadge(pageX: number, pageY: number): boolean {
    if (!isPlan || !atHead) return false;
    const localX = pageX - gridOrigin.current.x;
    const localY = pageY - gridOrigin.current.y;
    // Same centers ArrowNoteBadges actually renders at (post-separation) —
    // not the raw per-arrow ones — so the exclusion zone lines up with
    // wherever a badge visually ended up after overlap avoidance.
    return noteBadgeCenters(visibleArrows, BOARD_SIZE, flipped).some(
      (center) => Math.hypot(localX - center.x, localY - center.y) <= NOTE_BADGE_RADIUS + 8
    );
  }

  const panResponder = useMemo<PanResponderInstance>(() => {
    return PanResponder.create({
      // Peeking at the setup line (before Play, viewed from the recording
      // root) allows playing a different move there (see finishMove/
      // handlePlay) — but not drawing, since a setup move carries no
      // annotations of its own to attach one to (see `setupPeeking`).
      onStartShouldSetPanResponder: (evt) => {
        if (hitsArrowNoteBadge(evt.nativeEvent.pageX, evt.nativeEvent.pageY)) return false;
        return tool === 'move' || !setupPeeking;
      },
      onMoveShouldSetPanResponder: (evt) => {
        if (hitsArrowNoteBadge(evt.nativeEvent.pageX, evt.nativeEvent.pageY)) return false;
        return tool === 'move' || !setupPeeking;
      },
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
  }, [tool, annotateColor, board, cursorId, selected, pendingPromotion, branchChoices, phase, side, historyIndex, setupIndex, atHead, setupPeeking, expectMove?.from, expectMove?.to, expectArrow?.from, expectArrow?.to, expectArrow?.color]);

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
      ? board.recording.length > 0 || board.setupMoves.length > 0
      : true;
    if (hasData) {
      const ok = await confirmDialog('Reset board? All recorded moves/notation for this board will be lost.');
      if (!ok) return;
    }
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
      setupMoves: [],
      recording: [],
      front: { ...prev.front, ...resetPosition },
      back: { ...prev.back, ...resetPosition }
    }));
    setPhase('setup');
    setCursorId(null);
    setSelected(null);
    setHistoryIndex(0);
    setSetupIndex(0);
  }

  // Pressable at any point in the setup line, not just its head — pressing
  // it while reviewing an earlier point commits right there: everything
  // after it (in the setup line, and any recording, which was necessarily
  // built on a head this call is about to move) is discarded, same as
  // playing a move elsewhere already truncates-and-replaces rather than
  // branching. There's no per-position storage for the setup line's own
  // arrows/circles (unlike Others/Plan's history, or the recording tree),
  // so whatever was drawn is only ever the *current* head's — pressing Play
  // here also means starting that fresh, blank, at the new head.
  function handlePlay() {
    setBoard((prev) =>
      setupAtHead
        ? prev.recording.length > 0
          ? { ...prev, recording: [] }
          : prev
        : {
            ...prev,
            pieces: setupEngineState.pieces,
            turn: setupEngineState.turn,
            castling: setupEngineState.castling,
            enPassant: setupEngineState.enPassant,
            arrows: [],
            circles: [],
            setupMoves: prev.setupMoves.slice(0, setupIndex),
            recording: []
          }
    );
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

  // Others/Plan equivalent of handleDeleteMove/handleDeleteRecording above —
  // `.moves` is a flat, non-branching list (no tree, no ids), so a target is
  // just "how many moves to keep" rather than a node id. `keepCount === 0`
  // is the same "wipe everything, keep the starting position" case as
  // handleDeleteRecording. Plan's two faces share one history (kept in sync
  // wherever moves are made, e.g. finishMove), so both are truncated
  // together; Others' faces are independent, so only the active side is.
  // Shared by the "Delete from here" action and the drawing wizard below —
  // the actual truncation, with no confirmation of its own (each caller
  // shows its own, worded for what it's actually about to do).
  function truncateActiveFaceMoves(keepCount: number) {
    const prevState =
      keepCount === 0
        ? { pieces: startingPosition(), turn: 'w' as const, castling: { wK: true, wQ: true, bK: true, bQ: true }, enPassant: null }
        : {
            pieces: activeFace.moves[keepCount - 1].piecesAfter,
            turn: activeFace.moves[keepCount - 1].turnAfter,
            castling: activeFace.moves[keepCount - 1].castlingAfter,
            enPassant: activeFace.moves[keepCount - 1].enPassantAfter
          };
    const truncatedFace = (old: BoardFace): BoardFace => ({
      ...old,
      ...prevState,
      arrows: [],
      circles: [],
      moves: old.moves.slice(0, keepCount)
    });
    setBoard((prev) =>
      mode === 'plan'
        ? { ...prev, front: truncatedFace(prev.front), back: truncatedFace(prev.back) }
        : { ...prev, [side]: truncatedFace(prev[side]) }
    );
    setHistoryIndex(keepCount);
    setSelected(null);
  }

  async function deleteFaceMovesFrom(keepCount: number) {
    const ok = await confirmDialog(
      keepCount === 0
        ? 'Delete all recorded moves? The starting position stays. This cannot be undone.'
        : 'Delete this move and everything after it? This cannot be undone.'
    );
    if (!ok) return;
    truncateActiveFaceMoves(keepCount);
  }

  // Shared by the "«" jump-to-start button and tapping a setup move directly
  // in the notation — the two remaining, deliberate ways to look at the
  // setup line from inside a recording (repeatedly pressing plain Back no
  // longer gets you there at all, see handleBack).
  function confirmPeekBeforeRecording(): Promise<boolean> {
    return confirmDialog("You're about to view moves from before this recording started. Continue?", {
      confirmLabel: 'View setup',
      cancelLabel: 'Stay here'
    });
  }

  function handleBack() {
    setSelected(null);
    if (isReactions) {
      if (phase === 'playing') {
        if (cursorId !== null) {
          if (path.length === 0) return;
          setCursorId(path.length >= 2 ? path[path.length - 2].id : null);
          tutorial.event('backPressed');
          return;
        }
        // At the recording's own start — Back stops here. Viewing the setup
        // line from this point on is a deliberate act (tap a move in the
        // notation, or the "«" jump-to-start button below), never something
        // repeated presses land you in by accident.
        return;
      }
      if (setupIndex === 0) return;
      setSetupIndex((i) => i - 1);
      return;
    }
    if (historyIndex === 0) return;
    setHistoryIndex((i) => i - 1);
  }

  // "Jump further back": for Reactions this steps straight back to the
  // previous branch point, or the recording's own start, or — one more
  // press — all the way back to the very start of the setup line. Others/
  // Plan have no branches to stop at, so it's just "go to the start".
  async function handleBigBack() {
    setSelected(null);
    if (isReactions) {
      if (phase === 'playing' && cursorId !== null) {
        setCursorId(findPreviousBranch(path));
        tutorial.event('backPressed');
        return;
      }
      // Reached here with cursorId already null: jumping to setupIndex 0
      // means leaving the recording (whose own start you're already at) for
      // moves from before it — a deliberate step, not something to land in
      // silently. Nothing to warn about if there's no recording yet at all,
      // or no setup line before it to see.
      if (phase === 'playing' && setupIndex > 0 && !(await confirmPeekBeforeRecording())) return;
      setSetupIndex(0);
      return;
    }
    setHistoryIndex(0);
  }

  function handleForward() {
    setSelected(null);
    if (isReactions) {
      if (phase === 'playing') {
        if (cursorId !== null || setupAtHead) {
          const children = cursorNode ? cursorNode.children : board.recording;
          if (children.length === 0) return;
          setCursorId(children[0].id);
          return;
        }
        // Stepping forward through the setup peek, back toward the
        // recording's own start (and, past that, into the recording itself
        // on the next press, via the branch above).
        setSetupIndex((i) => i + 1);
        return;
      }
      if (setupIndex >= board.setupMoves.length) return;
      setSetupIndex((i) => i + 1);
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
    if (mode === 'plan' && faceAnnotations(board.back).arrows.length === 0) {
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
      {/* Outside the scrolling part, so Cancel and Save never scroll away. */}
      <View style={styles.header}>
        <Pressable onPress={handleCancel} style={styles.headerCancel}>
          <Text style={styles.topBarBtn}>Cancel</Text>
        </Pressable>
        <View style={styles.titleGroup}>
          <Text style={styles.title}>{mode === 'reactions' ? 'Reactions board' : 'Board editor'}</Text>
          <Pressable onPress={() => setTipHidden(tipOpen)} hitSlop={12}>
            <Text style={[styles.tipToggle, tipOpen && styles.tipToggleOpen]}>ⓘ</Text>
          </Pressable>
        </View>
        <Pressable ref={saveRef} collapsable={false} onPress={handleSave} style={styles.headerSave}>
          <Text style={styles.headerSaveText}>Save</Text>
        </Pressable>
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>

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
          <EngineMovesRow
            lines={panelLines}
            engineState={panelState}
            stale={engineStale}
            onPlayMove={playEngineMove}
            panelRef={engineMovesRef}
          />
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
          <BoardCoords size={BOARD_SIZE} flipped={flipped} styleSet={styleSet} />
          <View style={StyleSheet.absoluteFill} pointerEvents="none">
            <NumberedArrowsSvg arrows={engineArrows} size={BOARD_SIZE} flipped={flipped} />
            <NumberedArrowsSvg arrows={numberedArrows} size={BOARD_SIZE} flipped={flipped} />
            <NumberedArrowsSvg arrows={branchArrows} size={BOARD_SIZE} flipped={flipped} />
            <CirclesSvg circles={visibleCircles} size={BOARD_SIZE} flipped={flipped} />
            <NumberedArrowBadges arrows={committedNumberedArrows} size={BOARD_SIZE} flipped={flipped} />
            <NumberedArrowBadges arrows={branchArrows} size={BOARD_SIZE} flipped={flipped} />
            <PieceAnimationGhosts ghosts={ghosts} cell={CELL} />
          </View>
          {isPlan && atHead && (
            <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
              <ArrowNoteBadges
                arrows={visibleArrows.map((a) => ({
                  id: `${a.from}-${a.to}`,
                  from: a.from,
                  to: a.to,
                  hasDescription: hasArrowNotes(a),
                  onPress: () => handleArrowNote(a)
                }))}
                size={BOARD_SIZE}
                flipped={flipped}
              />
            </View>
          )}
        </View>
        {!hideEngine && <EngineEvalBar lines={panelLines} stale={engineStale} flipped={flipped} height={BOARD_SIZE} />}
        </View>

        {pendingPromotion && (
          <View style={styles.promoRow}>
            <Text style={styles.promoLabel}>Promote to:</Text>
            {PROMOTION_PIECES.map((p) => (
              <Pressable key={p} onPress={() => choosePromotion(p)} style={styles.promoBtn}>
                <PieceGlyph code={`${engineState.turn}${p}` as PieceCode} cell={42} />
              </Pressable>
            ))}
          </View>
        )}

        {mode === 'reactions' && phase === 'setup' && (
          <Pressable ref={playRef} collapsable={false} onPress={handlePlay} style={styles.playBtn}>
            <Text style={styles.playBtnText}>▶ Play</Text>
          </Pressable>
        )}

        {mode === 'reactions' && phase === 'setup' && setupSans.length > 0 && (
          <View style={notationStyles.wrap}>
            <SetupLine
              sans={setupSans}
              setupIndex={setupIndex}
              onJump={(i) => {
                setSetupIndex(i);
                setSelected(null);
              }}
            />
          </View>
        )}

        {/* Everything below is deliberately just above Reset, not at the
            top — these are the controls you reach for while actively
            drawing, not one-time setup like board style (now global). */}
        <View style={styles.row}>
          <Text style={styles.label}>Color</Text>
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
          <Pressable onPress={handleClearArrows} style={styles.clearBtn}>
            <Text style={styles.clearBtnText}>Clear arrows</Text>
          </Pressable>
        </View>

        {mode === 'reactions' && phase === 'playing' && (
          <>
            <View style={styles.notationHeaderRow}>
              <Text style={styles.notationHeaderText}>Recording</Text>
              <View style={styles.notationHeaderActions}>
                {cursorId ? (
                  <Pressable onPress={() => handleDeleteMove(cursorId)} style={styles.notationAction}>
                    <Text style={styles.deleteRecordingText}>Delete from here</Text>
                  </Pressable>
                ) : (
                  <Pressable onPress={handleDeleteRecording} style={styles.notationAction}>
                    <Text style={styles.deleteRecordingText}>Delete recording</Text>
                  </Pressable>
                )}
              </View>
            </View>
            <View ref={notationRef} collapsable={false}>
            <Notation
              recording={board.recording}
              setupSans={setupSans}
              setupIndex={setupIndex}
              onJumpSetup={async (i) => {
                // Only a "leaving the recording" moment while one exists —
                // plain setup-line browsing (phase 'setup', no Play yet)
                // needs no warning at all.
                if (phase === 'playing' && !(await confirmPeekBeforeRecording())) return;
                setSetupIndex(i);
                setCursorId(null);
                setSelected(null);
              }}
              cursorId={cursorId}
              yourColor={yourColor}
              onJump={(id) => {
                setCursorId(id);
                setSelected(null);
              }}
              onDelete={handleDeleteMove}
            />
            </View>
            <Text style={styles.notationHint}>Tap a move to jump to it. Long-press to delete it and everything after it.</Text>
          </>
        )}

        {!isReactions && activeFace.moves.length > 0 && (
          <>
            <View style={styles.notationHeaderRow}>
              <Text style={styles.notationHeaderText}>Moves</Text>
              <View style={styles.notationHeaderActions}>
                {historyIndex > 0 ? (
                  <Pressable onPress={() => deleteFaceMovesFrom(historyIndex - 1)} style={styles.notationAction}>
                    <Text style={styles.deleteRecordingText}>Delete from here</Text>
                  </Pressable>
                ) : (
                  <Pressable onPress={() => deleteFaceMovesFrom(0)} style={styles.notationAction}>
                    <Text style={styles.deleteRecordingText}>Delete recording</Text>
                  </Pressable>
                )}
              </View>
            </View>
            <LinearNotation
              moves={activeFace.moves}
              sans={activeFaceSans}
              historyIndex={historyIndex}
              onJump={(i) => {
                setHistoryIndex(i);
                setSelected(null);
              }}
              onDelete={deleteFaceMovesFrom}
            />
            <Text style={styles.notationHint}>Tap a move to jump to it. Long-press to delete it and everything after it.</Text>
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
        <View style={styles.toolSegment}>
          <Pressable
            onPress={() => setTool('move')}
            style={[styles.toolSegBtn, tool === 'move' && styles.toolSegBtnActive]}
          >
            <Text style={[styles.toolSegText, tool === 'move' && styles.toolSegTextActive]}>Move</Text>
          </Pressable>
          <Pressable
            onPress={() => {
              setTool('annotate');
              setSelected(null);
            }}
            style={[styles.toolSegBtn, tool === 'annotate' && styles.toolSegBtnActive]}
          >
            <Text style={[styles.toolSegText, tool === 'annotate' && styles.toolSegTextActive]}>Draw</Text>
          </Pressable>
        </View>
        <View style={{ flex: 1 }} />
        <View style={styles.navGroup}>
          <Pressable onPress={handleBigBack} disabled={!canBigBack} style={[styles.toolBtn, !canBigBack && styles.stepBtnDisabled]}>
            <Text style={styles.toolBtnText}>«</Text>
          </Pressable>
          <Pressable ref={backRef} collapsable={false} onPress={handleBack} disabled={!canBack} style={[styles.toolBtn, !canBack && styles.stepBtnDisabled]}>
            <Text style={styles.toolBtnText}>‹</Text>
          </Pressable>
          <Pressable onPress={handleForward} disabled={!canForward} style={[styles.toolBtn, !canForward && styles.stepBtnDisabled]}>
            <Text style={styles.toolBtnText}>›</Text>
          </Pressable>
        </View>
      </View>
      <SnackbarLayer bottom={88} />
      <TutorialLayer surface="boardEditor" flipped={flipped} />
    </SafeAreaView>
  );
}

// Tappable "1. e4 e5 2. Nf3 ..." line for the setup moves (before Play) —
// same flat-list approach as LinearNotation below (Others/Plan), since
// `setupMoves` is linear too, no branching. Tapping a move jumps the
// editor's `setupIndex` there (a read-only peek once phase is 'playing' —
// see `setupPeeking`); `setupIndex` itself highlights the current one.
function SetupLine({ sans, setupIndex, onJump }: { sans: string[]; setupIndex: number; onJump: (index: number) => void }) {
  const out: React.ReactNode[] = [];
  let moveNumber = 1;
  let whiteToMove = true;
  for (let i = 0; i < sans.length; i++) {
    const prefix = whiteToMove ? `${moveNumber}. ` : '';
    out.push(
      <Text
        key={i}
        onPress={() => onJump(i + 1)}
        style={[notationStyles.move, notationStyles.setupMove, setupIndex === i + 1 && notationStyles.moveActive]}
      >
        {prefix}
        {sans[i]}{' '}
      </Text>
    );
    if (!whiteToMove) moveNumber += 1;
    whiteToMove = !whiteToMove;
  }
  return <View style={notationStyles.mainLine}>{out}</View>;
}

// Flat, indented PGN-style notation: the main line reads left to right;
// each variation (a node that isn't its parent's first child) starts a new
// indented "(...)" line directly under the move it branches from. Tap a
// move to jump to it; long-press to delete it and everything after it in
// that branch (a destructive action gated behind its own confirmation, so
// a long-press alone can't accidentally lose recorded work). `setupSans` (the
// moves played before Play) render above a "Recording" divider when present,
// read-only — they're not part of `recording` and have no node id.
function Notation({
  recording,
  setupSans,
  setupIndex,
  onJumpSetup,
  cursorId,
  yourColor,
  onJump,
  onDelete
}: {
  recording: MoveNode[];
  setupSans: string[];
  setupIndex: number;
  onJumpSetup: (index: number) => void;
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

  if (recording.length === 0 && setupSans.length === 0) return null;

  // recording[0].turnAfter === 'b' means White just moved, so the line
  // starts on White's move ("1. ..."); otherwise it starts on Black
  // ("1... ...") — depends on how many set-up moves preceded Play.
  const startsWithWhite = recording.length > 0 && recording[0].turnAfter === 'b';

  return (
    <View style={notationStyles.wrap}>
      {setupSans.length > 0 && (
        <>
          <SetupLine sans={setupSans} setupIndex={setupIndex} onJump={onJumpSetup} />
          <Text style={notationStyles.recordingDivider}>Recording</Text>
        </>
      )}
      <Text onPress={() => onJump(null)} style={[notationStyles.move, cursorId === null && notationStyles.moveActive]}>
        Start{'  '}
      </Text>
      {recording.length > 0 && (
        <>
          <View style={notationStyles.mainLine}>{renderLine(recording[0], 1, startsWithWhite, 0)}</View>
          {recording.length > 1 &&
            recording.slice(1).map((alt, i) => (
              <View key={`root-var-${i}`} style={[notationStyles.variation, { marginLeft: 14 }]}>
                <Text style={notationStyles.varOpen}>(</Text>
                {renderLine(alt, 1, startsWithWhite, 1)}
                <Text style={notationStyles.varOpen}>)</Text>
              </View>
            ))}
        </>
      )}
    </View>
  );
}

// Others/Plan's equivalent of Notation above — `.moves` is a flat,
// non-branching list (no ids, no variations), so it's a plain left-to-right
// PGN line rather than a recursive tree walk. `historyIndex` doubles as both
// "how many moves are applied" and "the cursor", same as `cursorId` does for
// Reactions: index i's move is highlighted when `historyIndex === i + 1`.
// Always starts on White's move — Others/Plan has no Reactions-style setup
// phase before recording begins, so `.moves[0]` is always the game's first
// ply from the standard starting position.
function LinearNotation({
  moves,
  sans,
  historyIndex,
  onJump,
  onDelete
}: {
  moves: BoardMove[];
  sans: string[];
  historyIndex: number;
  onJump: (index: number) => void;
  onDelete: (index: number) => void;
}) {
  if (moves.length === 0) return null;

  const out: React.ReactNode[] = [];
  let moveNumber = 1;
  let whiteToMove = true;
  for (let i = 0; i < moves.length; i++) {
    const prefix = whiteToMove ? `${moveNumber}. ` : '';
    out.push(
      <Text
        key={i}
        onPress={() => onJump(i + 1)}
        onLongPress={() => onDelete(i)}
        style={[notationStyles.move, historyIndex === i + 1 && notationStyles.moveActive]}
      >
        {prefix}
        {sans[i]}{' '}
      </Text>
    );
    if (!whiteToMove) moveNumber += 1;
    whiteToMove = !whiteToMove;
  }

  return (
    <View style={notationStyles.wrap}>
      <Text onPress={() => onJump(0)} style={[notationStyles.move, historyIndex === 0 && notationStyles.moveActive]}>
        Start{'  '}
      </Text>
      <View style={notationStyles.mainLine}>{out}</View>
    </View>
  );
}

export function openReactionBoardEditor(
  board: ReactionBoard,
  mode: CardMode = 'reactions',
  yourColor: 'w' | 'b' = 'w',
  boardStyle = 0,
  initialCursorId?: string | null
): Promise<ReactionBoard | null> {
  return showOverlay<ReactionBoard | null>(
    (close) => (
      <ReactionBoardEditorOverlay
        initial={board}
        mode={mode}
        yourColor={yourColor}
        boardStyle={boardStyle}
        initialCursorId={initialCursorId}
        close={close}
      />
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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.bg
  },
  headerCancel: { minHeight: 48, minWidth: 64, justifyContent: 'center' },
  headerSave: {
    minHeight: 48,
    minWidth: 84,
    paddingHorizontal: 22,
    borderRadius: radius.pill,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center'
  },
  headerSaveText: { color: colors.onPrimary, ...type.bodyStrong },
  topBarBtn: { color: colors.textDim, ...type.body },
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
  fieldLabel: { color: colors.textDim, fontSize: 12.5, marginBottom: 6, marginTop: 6 },
  // One line high until there's more to show (then it grows to about four).
  textArea: {
    backgroundColor: colors.panel2,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    color: colors.text,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    minHeight: 44,
    maxHeight: 112,
    textAlignVertical: 'top'
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 14 },
  label: { color: colors.textDim, fontSize: 12, minWidth: 70 },
  swatchRow: { flexDirection: 'row', gap: 8 },
  arrowSwatch: { width: 26, height: 26, borderRadius: 13, borderWidth: 2, borderColor: 'transparent' },
  swatchActive: { borderColor: colors.accent },
  navGroup: { flexDirection: 'row', gap: 10 },
  toolBtn: { width: 48, height: 48, borderRadius: 10, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.panel2, alignItems: 'center', justifyContent: 'center' },
  toolBtnActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  toolBtnText: { color: colors.text, fontSize: 18 },
  toolBtnTextActive: { color: colors.onPrimary },
  toolSegment: { flexDirection: 'row', backgroundColor: colors.panel2, borderRadius: 12, borderWidth: 1, borderColor: colors.border, padding: 2 },
  toolSegBtn: { minHeight: 44, minWidth: 74, paddingHorizontal: 14, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  toolSegBtnActive: { backgroundColor: colors.accent },
  toolSegText: { color: colors.textDim, fontSize: 14, fontWeight: '700' },
  toolSegTextActive: { color: colors.onPrimary },
  clearBtn: { minHeight: 48, justifyContent: 'center', paddingLeft: 12 },
  clearBtnText: { color: colors.textDim, fontSize: 13, fontWeight: '600' },
  boardRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: 20 },
  board: { alignSelf: 'center', borderRadius: 6, overflow: 'hidden', borderWidth: 1, borderColor: colors.border },
  selectedHighlight: { backgroundColor: 'rgba(21,128,61,0.35)' },
  moveDot: { position: 'absolute', width: CELL * 0.28, height: CELL * 0.28, borderRadius: (CELL * 0.28) / 2, backgroundColor: 'rgba(21,128,61,0.55)' },
  captureRing: { position: 'absolute', width: CELL - 6, height: CELL - 6, borderRadius: (CELL - 6) / 2, borderWidth: 3, borderColor: 'rgba(220,38,38,0.85)' },
  promoRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12, alignSelf: 'center' },
  promoLabel: { color: colors.textDim, fontSize: 13, marginRight: 4 },
  promoBtn: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.pieceBadgeBg, alignItems: 'center', justifyContent: 'center' },
  playBtn: { marginTop: 16, backgroundColor: colors.primary, borderRadius: radius.pill, paddingVertical: 14, alignItems: 'center' },
  playBtnText: { color: colors.onPrimary, fontSize: 15.5, fontWeight: '700' },
  notationHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 14, marginBottom: 2, minHeight: 48 },
  notationAction: { minHeight: 48, justifyContent: 'center' },
  notationHint: { color: colors.textDim, fontSize: 12, lineHeight: 17, marginTop: 8 },
  notationHeaderText: { color: colors.textDim, fontSize: 12.5, fontWeight: '600' },
  notationHeaderActions: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  deleteRecordingText: { color: colors.danger, fontSize: 12.5, fontWeight: '700' },
  stepBtnDisabled: { opacity: 0.4 },
  applyBtn: { marginTop: 14, backgroundColor: colors.primary, borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  applyBtnText: { color: colors.onPrimary, fontSize: 14, fontWeight: '600' },
  resetBtn: { marginTop: 14, backgroundColor: colors.danger, borderRadius: 10, paddingVertical: 13, alignItems: 'center' },
  resetBtnText: { color: 'white', fontSize: 15, fontWeight: '600' },
});

const notationStyles = StyleSheet.create({
  wrap: { backgroundColor: colors.panel, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: 12, marginTop: 16 },
  mainLine: { flexDirection: 'row', flexWrap: 'wrap' },
  // The padding is the touch target: a move is a tap (jump) or long-press
  // (delete), so it needs to be more than a line of small text tall.
  move: { color: colors.text, fontSize: 14.5, paddingVertical: 9, paddingHorizontal: 2 },
  moveYours: { color: colors.primary },
  // Orange, not colors.accent (identical to moveYours' green) — the cursor
  // needs to stand out from "a move I played", not blend into it.
  moveActive: { color: colors.gold, fontWeight: '700' },
  // `alignItems: 'center'` keeps the "(" / ")" (no vertical padding) level
  // with the moves next to them (which have paddingVertical for a bigger
  // tap target) instead of sitting above them.
  variation: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 4, alignItems: 'center' },
  varOpen: { color: colors.textDim, fontSize: 13 },
  setupMove: { color: colors.textDim },
  recordingDivider: { color: colors.textDim, fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 8, marginBottom: 4 }
});
