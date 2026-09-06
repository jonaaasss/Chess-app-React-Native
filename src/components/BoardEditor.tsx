import React, { forwardRef, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet, PanResponder, PanResponderInstance } from 'react-native';
import Svg, { Line } from 'react-native-svg';
import { allSquares, cloneBoardState, newBoardState, pieceColor, squareFromIndex } from '../chess';
import type { ArrowColor, BoardState } from '../types';
import { arrowColors, boardStyles, colors } from '../theme';
import { ArrowsSvg, PieceGlyph } from './ChessBoard';

const ARROW_KEYS = Object.keys(arrowColors) as ArrowColor[];
const BOARD_SIZE = 320;
const CELL = BOARD_SIZE / 8;

type Mode = 'move' | 'arrow';

export interface BoardEditorHandle {
  getState: () => BoardState;
}

interface Props {
  initial: BoardState;
}

export const BoardEditor = forwardRef<BoardEditorHandle, Props>(function BoardEditor({ initial }, ref) {
  const [state, setState] = useState<BoardState>(() => cloneBoardState(initial));
  useImperativeHandle(ref, () => ({ getState: () => cloneBoardState(state) }), [state]);
  const [mode, setMode] = useState<Mode>('move');
  const [arrowColor, setArrowColor] = useState<ArrowColor>('green');
  const historyRef = useRef<BoardState[]>([]);
  const gridOrigin = useRef({ x: 0, y: 0 });
  const gridRef = useRef<View>(null);

  const [dragGhost, setDragGhost] = useState<{ sq: string; x: number; y: number } | null>(null);
  const [tempLine, setTempLine] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null);
  const dragSourceRef = useRef<string | null>(null);
  const arrowStartRef = useRef<string | null>(null);

  const styleSet = boardStyles[state.style] ?? boardStyles[0];

  function pushHistory() {
    historyRef.current.push(cloneBoardState(state));
    if (historyRef.current.length > 30) historyRef.current.shift();
  }

  function measureGrid(cb: () => void) {
    gridRef.current?.measureInWindow((x, y) => {
      gridOrigin.current = { x, y };
      cb();
    });
  }

  function squareFromPage(pageX: number, pageY: number): string | null {
    const file = Math.floor((pageX - gridOrigin.current.x) / CELL);
    const rank = Math.floor((pageY - gridOrigin.current.y) / CELL);
    return squareFromIndex(file, rank);
  }

  const panResponder = useMemo<PanResponderInstance>(() => {
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (evt) => {
        const { pageX, pageY } = evt.nativeEvent;
        measureGrid(() => {
          const sq = squareFromPage(pageX, pageY);
          if (!sq) return;
          if (mode === 'move') {
            const piece = state.pieces[sq];
            if (!piece) return;
            dragSourceRef.current = sq;
            setDragGhost({ sq, x: pageX - gridOrigin.current.x, y: pageY - gridOrigin.current.y });
          } else {
            arrowStartRef.current = sq;
            const idx = allSquares().indexOf(sq);
            const file = idx % 8;
            const rank = Math.floor(idx / 8);
            const cx = file * CELL + CELL / 2;
            const cy = rank * CELL + CELL / 2;
            setTempLine({ x1: cx, y1: cy, x2: pageX - gridOrigin.current.x, y2: pageY - gridOrigin.current.y });
          }
        });
      },
      onPanResponderMove: (evt) => {
        const { pageX, pageY } = evt.nativeEvent;
        const localX = pageX - gridOrigin.current.x;
        const localY = pageY - gridOrigin.current.y;
        if (mode === 'move' && dragSourceRef.current) {
          setDragGhost({ sq: dragSourceRef.current, x: localX, y: localY });
        } else if (mode === 'arrow' && arrowStartRef.current) {
          setTempLine((prev) => (prev ? { ...prev, x2: localX, y2: localY } : prev));
        }
      },
      onPanResponderRelease: (evt) => {
        const { pageX, pageY } = evt.nativeEvent;
        if (mode === 'move' && dragSourceRef.current) {
          const targetSq = squareFromPage(pageX, pageY);
          const source = dragSourceRef.current;
          if (targetSq && targetSq !== source) {
            pushHistory();
            setState((prev) => {
              const piece = prev.pieces[source];
              if (!piece) return prev;
              const nextPieces = { ...prev.pieces };
              nextPieces[targetSq] = piece;
              delete nextPieces[source];
              return { ...prev, pieces: nextPieces };
            });
          }
          dragSourceRef.current = null;
          setDragGhost(null);
        } else if (mode === 'arrow' && arrowStartRef.current) {
          const endSq = squareFromPage(pageX, pageY);
          const start = arrowStartRef.current;
          if (endSq && endSq !== start) {
            pushHistory();
            setState((prev) => ({ ...prev, arrows: [...prev.arrows, { from: start, to: endSq, color: arrowColor }] }));
          }
          arrowStartRef.current = null;
          setTempLine(null);
        }
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, arrowColor, state]);

  function handleStyleChange(idx: number) {
    pushHistory();
    setState((prev) => ({ ...prev, style: idx }));
  }

  function handleUndo() {
    const prev = historyRef.current.pop();
    if (prev) setState(prev);
  }

  function handleClearArrows() {
    if (state.arrows.length === 0) return;
    pushHistory();
    setState((prev) => ({ ...prev, arrows: [] }));
  }

  function handleReset() {
    pushHistory();
    const fresh = newBoardState(state.style);
    setState((prev) => ({ ...prev, pieces: fresh.pieces, arrows: [] }));
  }

  return (
    <View style={styles.root}>
      <View style={styles.row}>
        <Text style={styles.label}>Board style</Text>
        <View style={styles.swatchRow}>
          {boardStyles.map((s, idx) => (
            <Pressable
              key={idx}
              onPress={() => handleStyleChange(idx)}
              style={[styles.styleSwatch, state.style === idx && styles.swatchActive]}
            >
              {[0, 1, 2, 3].map((cell) => {
                const isLight = cell === 0 || cell === 3;
                return (
                  <View
                    key={cell}
                    style={{ width: '50%', height: '50%', backgroundColor: isLight ? s.light : s.dark }}
                  />
                );
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
                setMode('arrow');
              }}
              style={[
                styles.arrowSwatch,
                { backgroundColor: arrowColors[color] },
                mode === 'arrow' && arrowColor === color && styles.swatchActive
              ]}
            />
          ))}
        </View>
      </View>

      <View style={styles.row}>
        <Pressable onPress={() => setMode('move')} style={[styles.toolBtn, mode === 'move' && styles.toolBtnActive]}>
          <Text style={styles.toolBtnText}>✥</Text>
        </Pressable>
        <Pressable onPress={handleUndo} style={styles.toolBtn}>
          <Text style={styles.toolBtnText}>↶</Text>
        </Pressable>
        <Pressable onPress={handleClearArrows} style={styles.toolBtn}>
          <Text style={styles.toolBtnText}>✖</Text>
        </Pressable>
      </View>

      <View
        ref={gridRef}
        style={[styles.board, { width: BOARD_SIZE, height: BOARD_SIZE }]}
        {...panResponder.panHandlers}
      >
        <View style={{ width: BOARD_SIZE, height: BOARD_SIZE, flexDirection: 'row', flexWrap: 'wrap' }}>
          {allSquares().map((sq, i) => {
            const file = i % 8;
            const rank = Math.floor(i / 8);
            const isLight = (file + rank) % 2 === 0;
            const piece = dragSourceRef.current === sq ? undefined : state.pieces[sq];
            return (
              <View
                key={sq}
                style={{
                  width: CELL,
                  height: CELL,
                  backgroundColor: isLight ? styleSet.light : styleSet.dark,
                  alignItems: 'center',
                  justifyContent: 'center'
                }}
              >
                {piece && <PieceGlyph code={piece} cell={CELL} />}
              </View>
            );
          })}
        </View>
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          <ArrowsSvg arrows={state.arrows} size={BOARD_SIZE} />
          {tempLine && (
            <Svg width={BOARD_SIZE} height={BOARD_SIZE} style={StyleSheet.absoluteFill}>
              <Line
                x1={tempLine.x1}
                y1={tempLine.y1}
                x2={tempLine.x2}
                y2={tempLine.y2}
                stroke={arrowColors[arrowColor]}
                strokeWidth={3}
                strokeLinecap="round"
                opacity={0.9}
              />
            </Svg>
          )}
          {dragGhost && (
            <View style={{ position: 'absolute', left: dragGhost.x - CELL / 2, top: dragGhost.y - CELL / 2 }}>
              {state.pieces[dragGhost.sq] && (
                <PieceGlyph code={state.pieces[dragGhost.sq]!} cell={CELL} />
              )}
            </View>
          )}
        </View>
      </View>

      <Pressable onPress={handleReset} style={styles.resetBtn}>
        <Text style={styles.resetBtnText}>Reset board</Text>
      </Pressable>
    </View>
  );
});

export { BOARD_SIZE };

const styles = StyleSheet.create({
  root: { backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.border, borderRadius: 14, padding: 16 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  label: { color: colors.textDim, fontSize: 12, minWidth: 70 },
  swatchRow: { flexDirection: 'row', gap: 8 },
  styleSwatch: {
    width: 32,
    height: 32,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: 'transparent',
    overflow: 'hidden',
    flexDirection: 'row',
    flexWrap: 'wrap'
  },
  arrowSwatch: { width: 26, height: 26, borderRadius: 13, borderWidth: 2, borderColor: 'transparent' },
  swatchActive: { borderColor: colors.accent },
  toolBtn: {
    width: 34,
    height: 34,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.panel2,
    alignItems: 'center',
    justifyContent: 'center'
  },
  toolBtnActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  toolBtnText: { color: colors.text, fontSize: 16 },
  board: {
    alignSelf: 'center',
    borderRadius: 6,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
    marginTop: 4
  },
  resetBtn: {
    marginTop: 14,
    backgroundColor: colors.panel2,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingVertical: 13,
    alignItems: 'center'
  },
  resetBtnText: { color: colors.text, fontSize: 15, fontWeight: '600' }
});
