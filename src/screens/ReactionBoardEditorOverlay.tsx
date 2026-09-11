import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet, PanResponder, PanResponderInstance, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { allSquares, squareFromIndex, startingPosition } from '../chess';
import { legalMovesFrom, makeMove, isPromotionMove, type GameState } from '../chessEngine';
import type { Arrow, ArrowColor, Circle, MoveNode, PromotionPiece, ReactionBoard } from '../types';
import { arrowColors, boardStyles, colors, radius, spacing, type } from '../theme';
import { ArrowsSvg, CirclesSvg, PieceGlyph } from '../components/ChessBoard';
import { usePieceAnimation, PieceAnimationGhosts } from '../components/PieceAnimation';
import { confirmDialog, showOverlay } from '../overlay';
import { uid } from '../storage';

const ARROW_KEYS = Object.keys(arrowColors) as ArrowColor[];
const BOARD_SIZE = 320;
const CELL = BOARD_SIZE / 8;
const PROMOTION_PIECES: PromotionPiece[] = ['Q', 'R', 'B', 'N'];

type Tool = 'move' | 'arrow' | 'circle';

// ---------- Tree helpers (all immutable — return new trees/boards) ----------

function mapNode(nodes: MoveNode[], id: string, fn: (n: MoveNode) => MoveNode): MoveNode[] {
  return nodes.map((n) => (n.id === id ? fn(n) : { ...n, children: mapNode(n.children, id, fn) }));
}

function findNode(nodes: MoveNode[], id: string): MoveNode | null {
  for (const n of nodes) {
    if (n.id === id) return n;
    const found = findNode(n.children, id);
    if (found) return found;
  }
  return null;
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

function mainLineLeafId(nodes: MoveNode[]): string | null {
  if (nodes.length === 0) return null;
  let node = nodes[0];
  while (node.children.length > 0) node = node.children[0];
  return node.id;
}

function sameArrow(a: Arrow, b: Arrow) {
  return a.from === b.from && a.to === b.to && a.color === b.color;
}
function sameCircle(a: Circle, b: Circle) {
  return a.square === b.square && a.color === b.color;
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
  close
}: {
  initial: ReactionBoard;
  close: (result: ReactionBoard | null) => void;
}) {
  const [board, setBoard] = useState<ReactionBoard>(initial);
  const [phase, setPhase] = useState<'setup' | 'playing'>(initial.recording.length > 0 ? 'playing' : 'setup');
  const [cursorId, setCursorId] = useState<string | null>(
    initial.recording.length > 0 ? mainLineLeafId(initial.recording) : null
  );
  const [tool, setTool] = useState<Tool>('move');
  const [arrowColor, setArrowColor] = useState<ArrowColor>('green');
  const [circleColor, setCircleColor] = useState<ArrowColor>('green');
  const [selected, setSelected] = useState<string | null>(null);
  const [tempArrow, setTempArrow] = useState<{ from: string; to: string } | null>(null);
  const [pendingPromotion, setPendingPromotion] = useState<{ from: string; to: string } | null>(null);
  // Setup-phase step back/forward: undo/redo stacks of whole-board
  // snapshots. (In the playing phase, ‹ / › walk the recorded tree instead.)
  const [undoStack, setUndoStack] = useState<ReactionBoard[]>([]);
  const [redoStack, setRedoStack] = useState<ReactionBoard[]>([]);
  const arrowStartRef = useRef<string | null>(null);
  const gridOrigin = useRef({ x: 0, y: 0 });
  const gridRef = useRef<View>(null);

  const path = useMemo(() => (cursorId ? findPath(board.recording, cursorId) ?? [] : []), [board.recording, cursorId]);
  const cursorNode = path.length > 0 ? path[path.length - 1] : null;

  const engineState: GameState = cursorNode
    ? { pieces: cursorNode.piecesAfter, turn: cursorNode.turnAfter, castling: cursorNode.castlingAfter, enPassant: cursorNode.enPassantAfter }
    : { pieces: board.pieces, turn: board.turn, castling: board.castling, enPassant: board.enPassant };

  const { arrows: visibleArrows, circles: visibleCircles } = useMemo(
    () => activeAnnotations(board, path),
    [board, path]
  );

  const legalTargets = useMemo(
    () => (selected ? legalMovesFrom(engineState, selected) : []),
    [engineState, selected]
  );

  const styleSet = boardStyles[board.style] ?? boardStyles[0];
  const { hiddenSquares, ghosts } = usePieceAnimation(engineState.pieces, CELL);

  function pushHistory() {
    setUndoStack((s) => [...s, board].slice(-40));
    setRedoStack([]);
  }

  const canBack = phase === 'setup' ? undoStack.length > 0 : path.length > 0;
  const canForward =
    phase === 'setup'
      ? redoStack.length > 0
      : (cursorNode ? cursorNode.children.length : board.recording.length) > 0;

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
    return squareFromIndex(file, rank);
  }

  // ---------- Committing a move (setup: just advances the base position;
  // playing: appends to — or reuses — a child of the current tree node) ----------

  function finishMove(from: string, to: string, promotion?: PromotionPiece) {
    const result = makeMove(engineState, from, to, promotion);

    if (phase === 'setup') {
      pushHistory();
      setBoard((prev) => ({
        ...prev,
        pieces: result.next.pieces,
        turn: result.next.turn,
        castling: result.next.castling,
        enPassant: result.next.enPassant
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
      removedArrows: [],
      removedCircles: [],
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

  function addArrow(arrow: Arrow) {
    if (cursorId === null) {
      setBoard((prev) => ({ ...prev, arrows: [...prev.arrows, arrow] }));
    } else {
      setBoard((prev) => ({ ...prev, recording: mapNode(prev.recording, cursorId, (n) => ({ ...n, addedArrows: [...n.addedArrows, arrow] })) }));
    }
  }

  function clearArrows() {
    if (visibleArrows.length === 0) return;
    pushHistory();
    if (cursorId === null) {
      setBoard((prev) => ({ ...prev, arrows: [] }));
      return;
    }
    setBoard((prev) => ({
      ...prev,
      recording: mapNode(prev.recording, cursorId, (n) => {
        const inherited = visibleArrows.filter((a) => !n.addedArrows.some((o) => sameArrow(o, a)));
        return { ...n, addedArrows: [], removedArrows: [...n.removedArrows, ...inherited] };
      })
    }));
  }

  function toggleCircle(square: string) {
    const existing = visibleCircles.find((c) => c.square === square);
    const isSameColor = existing?.color === circleColor;

    if (cursorId === null) {
      setBoard((prev) => {
        let circles = prev.circles.filter((c) => c.square !== square);
        if (!isSameColor) circles = [...circles, { square, color: circleColor }];
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
          addedCircles = [...addedCircles, { square, color: circleColor }];
        } else if (!addedHere && existing) {
          removedCircles = [...removedCircles, existing];
        }
        return { ...n, addedCircles, removedCircles };
      })
    }));
  }

  // ---------- Pan responder: move (tap), arrow (drag, snapping to tile), circle (tap) ----------

  const panResponder = useMemo<PanResponderInstance>(() => {
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (evt) => {
        const { pageX, pageY } = evt.nativeEvent;
        measureGrid(() => {
          const sq = squareFromPage(pageX, pageY);
          if (!sq) return;
          if (tool === 'move') handleSquareTap(sq);
          else if (tool === 'circle') toggleCircle(sq);
          else {
            arrowStartRef.current = sq;
            setTempArrow(null);
          }
        });
      },
      onPanResponderMove: (evt) => {
        if (tool !== 'arrow' || !arrowStartRef.current) return;
        const { pageX, pageY } = evt.nativeEvent;
        const hoverSq = squareFromPage(pageX, pageY);
        const start = arrowStartRef.current;
        setTempArrow(hoverSq && hoverSq !== start ? { from: start, to: hoverSq } : null);
      },
      onPanResponderRelease: (evt) => {
        if (tool !== 'arrow' || !arrowStartRef.current) return;
        const { pageX, pageY } = evt.nativeEvent;
        const endSq = squareFromPage(pageX, pageY);
        const start = arrowStartRef.current;
        if (endSq && endSq !== start) addArrow({ from: start, to: endSq, color: arrowColor });
        arrowStartRef.current = null;
        setTempArrow(null);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tool, arrowColor, circleColor, board, cursorId, selected, phase]);

  // ---------- Style / reset / undo / play / stop ----------

  function handleStyleChange(idx: number) {
    pushHistory();
    setBoard((prev) => ({ ...prev, style: idx }));
  }

  async function handleReset() {
    const hasData = board.recording.length > 0;
    if (hasData) {
      const ok = await confirmDialog('Reset board? All recorded moves/notation for this board will be lost.');
      if (!ok) return;
    }
    pushHistory();
    setBoard((prev) => ({
      ...prev,
      pieces: startingPosition(),
      turn: 'w',
      castling: { wK: true, wQ: true, bK: true, bQ: true },
      enPassant: null,
      arrows: [],
      circles: [],
      recording: []
    }));
    setPhase('setup');
    setCursorId(null);
    setSelected(null);
  }

  function handlePlay() {
    setPhase('playing');
    setCursorId(null);
    setSelected(null);
  }

  function handleBack() {
    setSelected(null);
    if (phase === 'setup') {
      if (undoStack.length === 0) return;
      setRedoStack((r) => [...r, board]);
      setBoard(undoStack[undoStack.length - 1]);
      setUndoStack((s) => s.slice(0, -1));
      return;
    }
    if (path.length === 0) return;
    setCursorId(path.length >= 2 ? path[path.length - 2].id : null);
  }

  function handleForward() {
    setSelected(null);
    if (phase === 'setup') {
      if (redoStack.length === 0) return;
      setUndoStack((s) => [...s, board]);
      setBoard(redoStack[redoStack.length - 1]);
      setRedoStack((r) => r.slice(0, -1));
      return;
    }
    const children = cursorNode ? cursorNode.children : board.recording;
    if (children.length === 0) return;
    setCursorId(children[0].id);
  }

  async function handleCancel() {
    close(null);
  }

  return (
    <SafeAreaView style={styles.overlay}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.topBar}>
          <Pressable onPress={handleCancel}>
            <Text style={styles.topBarBtn}>Cancel</Text>
          </Pressable>
          <Text style={styles.title}>Reactions board</Text>
          <Pressable onPress={() => close(board)}>
            <Text style={[styles.topBarBtn, styles.saveBtn]}>Save</Text>
          </Pressable>
        </View>

        <View style={styles.row}>
          <Text style={styles.label}>Board style</Text>
          <View style={styles.swatchRow}>
            {boardStyles.map((s, idx) => (
              <Pressable
                key={idx}
                onPress={() => handleStyleChange(idx)}
                hitSlop={6}
                style={[styles.styleSwatch, board.style === idx && styles.swatchActive]}
              >
                {[0, 1, 2, 3].map((cell) => {
                  const isLight = cell === 0 || cell === 3;
                  return <View key={cell} style={{ width: '50%', height: '50%', backgroundColor: isLight ? s.light : s.dark }} />;
                })}
              </Pressable>
            ))}
          </View>
        </View>

        <View style={styles.row}>
          <Text style={styles.label}>Arrows</Text>
          <View style={styles.swatchRow}>
            {ARROW_KEYS.map((color) => (
              <Pressable
                key={color}
                onPress={() => {
                  setArrowColor(color);
                  setTool('arrow');
                  setSelected(null);
                }}
                hitSlop={9}
                style={[styles.arrowSwatch, { backgroundColor: arrowColors[color] }, tool === 'arrow' && arrowColor === color && styles.swatchActive]}
              />
            ))}
          </View>
        </View>

        <View style={styles.row}>
          <Text style={styles.label}>Circles</Text>
          <View style={styles.swatchRow}>
            {ARROW_KEYS.map((color) => (
              <Pressable
                key={color}
                onPress={() => {
                  setCircleColor(color);
                  setTool('circle');
                  setSelected(null);
                }}
                hitSlop={9}
                style={[
                  styles.circleSwatch,
                  { borderColor: arrowColors[color] },
                  tool === 'circle' && circleColor === color && styles.circleSwatchActive
                ]}
              />
            ))}
          </View>
        </View>

        <View style={styles.row}>
          <Pressable onPress={() => setTool('move')} style={[styles.toolBtn, tool === 'move' && styles.toolBtnActive]}>
            <Text style={[styles.toolBtnText, tool === 'move' && styles.toolBtnTextActive]}>✥</Text>
          </Pressable>
          <Pressable onPress={handleBack} disabled={!canBack} style={[styles.toolBtn, !canBack && styles.stepBtnDisabled]}>
            <Text style={styles.toolBtnText}>‹</Text>
          </Pressable>
          <Pressable onPress={handleForward} disabled={!canForward} style={[styles.toolBtn, !canForward && styles.stepBtnDisabled]}>
            <Text style={styles.toolBtnText}>›</Text>
          </Pressable>
          <Pressable onPress={clearArrows} style={styles.toolBtn}>
            <Text style={styles.toolBtnText}>✖</Text>
          </Pressable>
        </View>

        <View
          ref={gridRef}
          onLayout={() => measureGrid()}
          style={[styles.board, { width: BOARD_SIZE, height: BOARD_SIZE }]}
          {...panResponder.panHandlers}
        >
          <View style={{ width: BOARD_SIZE, height: BOARD_SIZE, flexDirection: 'row', flexWrap: 'wrap' }}>
            {allSquares().map((sq, i) => {
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
            <ArrowsSvg
              arrows={tempArrow ? [...visibleArrows, { ...tempArrow, color: arrowColor }] : visibleArrows}
              size={BOARD_SIZE}
            />
            <CirclesSvg circles={visibleCircles} size={BOARD_SIZE} />
            <ArrowNumbers arrows={visibleArrows} />
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

        {phase === 'setup' ? (
          <Pressable onPress={handlePlay} style={styles.playBtn}>
            <Text style={styles.playBtnText}>▶ Play</Text>
          </Pressable>
        ) : (
          <>
            <Text style={styles.playingHint}>
              Recording: every move you play on the board is added to the notation below. Tap a move to jump back to
              that position — playing a different move from there starts a variation. Use ‹ / › (above the board) to
              step through the line one move at a time. Tap Save (top right) whenever you're done.
            </Text>
            <Notation
              recording={board.recording}
              cursorId={cursorId}
              onJump={(id) => {
                setCursorId(id);
                setSelected(null);
              }}
            />
          </>
        )}

        <Pressable onPress={handleReset} style={styles.resetBtn}>
          <Text style={styles.resetBtnText}>Reset board</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

// Small pixel-positioned number badges at each same-colored arrow's
// midpoint (drawn in the same 0..BOARD_SIZE pixel space the grid uses).
function ArrowNumbers({ arrows }: { arrows: Arrow[] }) {
  const byColor: Record<string, Arrow[]> = {};
  for (const a of arrows) {
    (byColor[a.color] ??= []).push(a);
  }
  const badges: { key: string; x: number; y: number; n: number; color: ArrowColor }[] = [];
  for (const color of Object.keys(byColor) as ArrowColor[]) {
    const list = byColor[color];
    if (list.length < 2) continue;
    list.forEach((a, i) => {
      const from = squareCenterPx(a.from);
      const to = squareCenterPx(a.to);
      badges.push({ key: `${color}-${i}`, x: (from.x + to.x) / 2, y: (from.y + to.y) / 2, n: i + 1, color });
    });
  }
  return (
    <>
      {badges.map((b) => (
        <View key={b.key} style={[numStyles.badge, { left: b.x - 9, top: b.y - 9, backgroundColor: arrowColors[b.color] }]}>
          <Text style={numStyles.badgeText}>{b.n}</Text>
        </View>
      ))}
    </>
  );
}

function squareCenterPx(square: string) {
  const file = 'abcdefgh'.indexOf(square[0]);
  const rank = '87654321'.indexOf(square[1]);
  return { x: file * CELL + CELL / 2, y: rank * CELL + CELL / 2 };
}

// Flat, indented PGN-style notation: the main line reads left to right;
// each variation (a node that isn't its parent's first child) starts a new
// indented "(...)" line directly under the move it branches from.
function Notation({
  recording,
  cursorId,
  onJump
}: {
  recording: MoveNode[];
  cursorId: string | null;
  onJump: (id: string | null) => void;
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
      out.push(
        <Text
          key={current.id}
          onPress={() => onJump(current.id)}
          style={[notationStyles.move, current.id === cursorId && notationStyles.moveActive]}
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

export function openReactionBoardEditor(board: ReactionBoard): Promise<ReactionBoard | null> {
  return showOverlay<ReactionBoard | null>((close) => <ReactionBoardEditorOverlay initial={board} close={close} />);
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, paddingBottom: 32 },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  topBarBtn: { color: colors.textDim, ...type.body },
  saveBtn: { color: colors.accentHover, ...type.bodyStrong },
  title: { color: colors.text, ...type.h2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  label: { color: colors.textDim, fontSize: 12, minWidth: 70 },
  swatchRow: { flexDirection: 'row', gap: 8 },
  styleSwatch: { width: 32, height: 32, borderRadius: 8, borderWidth: 2, borderColor: 'transparent', overflow: 'hidden', flexDirection: 'row', flexWrap: 'wrap' },
  arrowSwatch: { width: 26, height: 26, borderRadius: 13, borderWidth: 2, borderColor: 'transparent' },
  circleSwatch: { width: 26, height: 26, borderRadius: 13, borderWidth: 3, backgroundColor: 'transparent' },
  // Selection is shown by filling the swatch white, not by recoloring its
  // ring — the ring's own color is the actual circle color and must stay
  // put so you can tell which color is selected.
  circleSwatchActive: { backgroundColor: '#fff' },
  swatchActive: { borderColor: colors.accent },
  toolBtn: { width: 44, height: 44, borderRadius: 10, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.panel2, alignItems: 'center', justifyContent: 'center' },
  toolBtnActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  toolBtnText: { color: colors.text, fontSize: 18 },
  toolBtnTextActive: { color: colors.onPrimary },
  board: { alignSelf: 'center', borderRadius: 6, overflow: 'hidden', borderWidth: 1, borderColor: colors.border, marginTop: 4 },
  selectedHighlight: { backgroundColor: 'rgba(21,128,61,0.35)' },
  moveDot: { position: 'absolute', width: CELL * 0.28, height: CELL * 0.28, borderRadius: (CELL * 0.28) / 2, backgroundColor: 'rgba(21,128,61,0.55)' },
  captureRing: { position: 'absolute', width: CELL - 6, height: CELL - 6, borderRadius: (CELL - 6) / 2, borderWidth: 3, borderColor: 'rgba(220,38,38,0.85)' },
  promoRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12, alignSelf: 'center' },
  promoLabel: { color: colors.textDim, fontSize: 13, marginRight: 4 },
  promoBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  promoBtnText: { color: colors.onPrimary, fontWeight: '700' },
  playBtn: { marginTop: 16, backgroundColor: colors.primary, borderRadius: radius.pill, paddingVertical: 14, alignItems: 'center' },
  playBtnText: { color: colors.onPrimary, fontSize: 15.5, fontWeight: '700' },
  playingHint: { color: colors.textDim, fontSize: 12.5, lineHeight: 18, marginTop: 14 },
  stepBtnDisabled: { opacity: 0.4 },
  resetBtn: { marginTop: 14, backgroundColor: colors.panel2, borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingVertical: 13, alignItems: 'center' },
  resetBtnText: { color: colors.text, fontSize: 15, fontWeight: '600' }
});

const numStyles = StyleSheet.create({
  badge: { position: 'absolute', width: 18, height: 18, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  badgeText: { color: '#fff', fontSize: 10, fontWeight: '700' }
});

const notationStyles = StyleSheet.create({
  wrap: { backgroundColor: colors.panel, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: 12, marginTop: 16 },
  mainLine: { flexDirection: 'row', flexWrap: 'wrap' },
  move: { color: colors.text, fontSize: 14.5 },
  moveActive: { color: colors.accent, fontWeight: '700' },
  variation: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 4 },
  varOpen: { color: colors.textDim, fontSize: 13 }
});
