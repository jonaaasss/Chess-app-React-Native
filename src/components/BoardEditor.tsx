import React, { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet, PanResponder, PanResponderInstance } from 'react-native';
import { allSquares, cloneBoardState, legalMoves, newBoardState, squareFromIndex } from '../chess';
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

  const [selected, setSelected] = useState<string | null>(null);
  // Snaps to whichever square the finger is currently over (not the raw
  // pixel position), and is rendered with the same ArrowsSvg used for
  // finalized arrows — so the preview already looks like a real arrow and
  // jumps square-to-square instead of following the finger continuously.
  const [tempArrow, setTempArrow] = useState<{ from: string; to: string } | null>(null);
  const arrowStartRef = useRef<string | null>(null);

  const legalTargets = useMemo(() => (selected ? legalMoves(state.pieces, selected) : []), [state, selected]);

  const styleSet = boardStyles[state.style] ?? boardStyles[0];

  function pushHistory() {
    historyRef.current.push(cloneBoardState(state));
    if (historyRef.current.length > 30) historyRef.current.shift();
  }

  function measureGrid(cb?: () => void) {
    gridRef.current?.measureInWindow((x, y) => {
      gridOrigin.current = { x, y };
      cb?.();
    });
  }

  // Measure the grid's on-screen position as soon as it's laid out, instead
  // of only lazily on the first touch — otherwise a fast finger movement
  // right at the start of a drag could fire a few move events before that
  // first (async) measurement resolves, silently dropping the earliest
  // preview updates.
  useEffect(() => {
    measureGrid();
  }, []);

  function squareFromPage(pageX: number, pageY: number): string | null {
    const file = Math.floor((pageX - gridOrigin.current.x) / CELL);
    const rank = Math.floor((pageY - gridOrigin.current.y) / CELL);
    return squareFromIndex(file, rank);
  }

  // Tap-to-select, tap-to-move: no dragging, no turn order — tapping a
  // piece shows where it can legally go (per that piece's own movement
  // pattern only; check/castling/en-passant/promotion don't apply here,
  // this is a position-setup tool, not a game), and tapping a highlighted
  // square moves it there.
  function handleSquareTap(sq: string) {
    if (!selected) {
      if (state.pieces[sq]) setSelected(sq);
      return;
    }
    if (sq === selected) {
      setSelected(null);
      return;
    }
    if (legalMoves(state.pieces, selected).includes(sq)) {
      const source = selected;
      pushHistory();
      setState((prev) => {
        const piece = prev.pieces[source];
        if (!piece) return prev;
        const nextPieces = { ...prev.pieces };
        nextPieces[sq] = piece;
        delete nextPieces[source];
        return { ...prev, pieces: nextPieces };
      });
      setSelected(null);
      return;
    }
    setSelected(state.pieces[sq] ? sq : null);
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
            handleSquareTap(sq);
          } else {
            arrowStartRef.current = sq;
            setTempArrow(null);
          }
        });
      },
      onPanResponderMove: (evt) => {
        if (mode !== 'arrow' || !arrowStartRef.current) return;
        const { pageX, pageY } = evt.nativeEvent;
        const hoverSq = squareFromPage(pageX, pageY);
        const start = arrowStartRef.current;
        setTempArrow(hoverSq && hoverSq !== start ? { from: start, to: hoverSq } : null);
      },
      onPanResponderRelease: (evt) => {
        if (mode !== 'arrow' || !arrowStartRef.current) return;
        const { pageX, pageY } = evt.nativeEvent;
        const endSq = squareFromPage(pageX, pageY);
        const start = arrowStartRef.current;
        if (endSq && endSq !== start) {
          pushHistory();
          setState((prev) => ({ ...prev, arrows: [...prev.arrows, { from: start, to: endSq, color: arrowColor }] }));
        }
        arrowStartRef.current = null;
        setTempArrow(null);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, arrowColor, state, selected]);

  function handleStyleChange(idx: number) {
    pushHistory();
    setState((prev) => ({ ...prev, style: idx }));
  }

  function handleUndo() {
    const prev = historyRef.current.pop();
    if (prev) setState(prev);
    setSelected(null);
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
    setSelected(null);
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
              hitSlop={6}
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
                setSelected(null);
              }}
              hitSlop={9}
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
          <Text style={[styles.toolBtnText, mode === 'move' && styles.toolBtnTextActive]}>✥</Text>
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
        onLayout={() => measureGrid()}
        style={[styles.board, { width: BOARD_SIZE, height: BOARD_SIZE }]}
        {...panResponder.panHandlers}
      >
        <View style={{ width: BOARD_SIZE, height: BOARD_SIZE, flexDirection: 'row', flexWrap: 'wrap' }}>
          {allSquares().map((sq, i) => {
            const file = i % 8;
            const rank = Math.floor(i / 8);
            const isLight = (file + rank) % 2 === 0;
            const piece = state.pieces[sq];
            const isSelected = sq === selected;
            const isTarget = legalTargets.includes(sq);
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
                {isSelected && (
                  <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.selectedHighlight]} />
                )}
                {isTarget && !piece && <View pointerEvents="none" style={styles.moveDot} />}
                {isTarget && piece && <View pointerEvents="none" style={styles.captureRing} />}
              </View>
            );
          })}
        </View>
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          <ArrowsSvg
            arrows={tempArrow ? [...state.arrows, { ...tempArrow, color: arrowColor }] : state.arrows}
            size={BOARD_SIZE}
          />
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
    width: 44,
    height: 44,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.panel2,
    alignItems: 'center',
    justifyContent: 'center'
  },
  toolBtnActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  toolBtnText: { color: colors.text, fontSize: 18 },
  toolBtnTextActive: { color: colors.onPrimary },
  board: {
    alignSelf: 'center',
    borderRadius: 6,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
    marginTop: 4
  },
  selectedHighlight: { backgroundColor: 'rgba(21,128,61,0.35)' },
  moveDot: {
    position: 'absolute',
    width: CELL * 0.28,
    height: CELL * 0.28,
    borderRadius: (CELL * 0.28) / 2,
    backgroundColor: 'rgba(21,128,61,0.55)'
  },
  captureRing: {
    position: 'absolute',
    width: CELL - 6,
    height: CELL - 6,
    borderRadius: (CELL - 6) / 2,
    borderWidth: 3,
    borderColor: 'rgba(220,38,38,0.85)'
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
