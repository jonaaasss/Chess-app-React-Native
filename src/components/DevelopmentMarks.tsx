// Development marks (src/development.ts): a small pie chart at the top right
// of each of your undeveloped knights and bishops, with where it goes in the
// Lichess explorer's lines. `useDevelopmentMarks` works them out for a
// position (after a short pause, so stepping through moves doesn't ask the
// explorer for every position on the way). A tap shows the breakdown in
// words, with where the piece goes after each opponent move (board editor
// and Study; `openDevelopmentText`).
import React, { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { flipIndex, squareIndex, toFen } from '../chess';
import type { GameState } from '../chessEngine';
import { DEV_COLORS, developmentMarks, developmentText, undevelopedMinors, type DevMark } from '../development';
import { alertDialog } from '../overlay';

export function openDevelopmentText(mark: DevMark): void {
  void alertDialog(`${developmentText(mark)}\n\nFrom the Lichess explorer's lines from this position.`);
}
import { fetchExplorer, getExplorerDb, getLichessToken, onExplorerDbChange } from '../lichessExplorer';

export function devMarkSize(boardSize: number): number {
  return Math.max(13, Math.round((boardSize / 8) * 0.32));
}

export function devMarkCenter(square: string, boardSize: number, flipped: boolean): { x: number; y: number } {
  const cell = boardSize / 8;
  const d = devMarkSize(boardSize);
  const raw = squareIndex(square);
  return { x: (flipIndex(raw.file, flipped) + 1) * cell - d / 2 - 2, y: flipIndex(raw.rank, flipped) * cell + d / 2 + 2 };
}

function Pie({ mark, d }: { mark: DevMark; d: number }) {
  const r = d / 2 - 1;
  const c = d / 2;
  let angle = -Math.PI / 2;
  const paths: React.ReactNode[] = [];
  if (mark.slices.length === 1) {
    paths.push(<Circle key="all" cx={c} cy={c} r={r} fill={DEV_COLORS[mark.slices[0].color]} />);
  } else {
    mark.slices.forEach((s, i) => {
      const a2 = angle + s.share * Math.PI * 2;
      const large = a2 - angle > Math.PI ? 1 : 0;
      const p = `M ${c} ${c} L ${c + r * Math.cos(angle)} ${c + r * Math.sin(angle)} A ${r} ${r} 0 ${large} 1 ${c + r * Math.cos(a2)} ${c + r * Math.sin(a2)} Z`;
      paths.push(<Path key={i} d={p} fill={DEV_COLORS[s.color]} />);
      angle = a2;
    });
  }
  return (
    <Svg width={d} height={d}>
      {paths}
      <Circle cx={c} cy={c} r={r} fill="none" stroke="#0F172A" strokeWidth={1.2} />
    </Svg>
  );
}

export function DevelopmentMarks({
  marks,
  size,
  flipped,
  onPress,
  hitSlop = 10
}: {
  marks: DevMark[];
  size: number;
  flipped: boolean;
  onPress?: (mark: DevMark) => void;
  // Smaller in Study, where you draw arrows from the same square.
  hitSlop?: number;
}) {
  const d = devMarkSize(size);
  return (
    <>
      {marks.map((m) => {
        const c = devMarkCenter(m.square, size, flipped);
        const style = [styles.mark, { left: c.x - d / 2, top: c.y - d / 2, width: d, height: d }];
        return onPress ? (
          <Pressable key={m.square} onPress={() => onPress(m)} hitSlop={hitSlop} style={style} accessibilityRole="button" accessibilityLabel={`Where the piece on ${m.square} goes`}>
            <Pie mark={m} d={d} />
          </Pressable>
        ) : (
          <View key={m.square} pointerEvents="none" style={style}>
            <Pie mark={m} d={d} />
          </View>
        );
      })}
    </>
  );
}

// The marks for a position; empty without a Lichess token, without
// undeveloped pieces, or when `enabled` is false.
export function useDevelopmentMarks(state: GameState | null | undefined, yourColor: 'w' | 'b', enabled = true): DevMark[] {
  const fen = state ? toFen(state.pieces, state.turn, state.castling, state.enPassant) : '';
  const [result, setResult] = useState<{ fen: string; marks: DevMark[] }>({ fen: '', marks: [] });
  const [dbTick, setDbTick] = useState(0);
  const stateRef = useRef(state);
  stateRef.current = state;
  useEffect(() => onExplorerDbChange(() => setDbTick((n) => n + 1)), []);
  useEffect(() => {
    const st = stateRef.current;
    if (!enabled || !st || undevelopedMinors(st.pieces, yourColor).length === 0) {
      setResult({ fen, marks: [] });
      return undefined;
    }
    let alive = true;
    const timer = setTimeout(async () => {
      try {
        if (!(await getLichessToken())) return;
        const db = await getExplorerDb();
        const marks = await developmentMarks(st, yourColor, (f) => fetchExplorer(f, db), db, () => !alive);
        if (alive) setResult({ fen, marks });
      } catch {
        // Nothing shown.
      }
    }, 350);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [fen, yourColor, enabled, dbTick]);
  if (!state || !enabled) return [];
  // Until the new position is worked out, the marks of the previous one stay
  // on the pieces that are still on their square.
  return result.fen === fen ? result.marks : result.marks.filter((m) => state.pieces[m.square] === m.piece);
}

const styles = StyleSheet.create({
  mark: { position: 'absolute' }
});
