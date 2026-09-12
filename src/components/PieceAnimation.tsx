import React, { useLayoutEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet } from 'react-native';
import type { PieceCode } from '../types';
import { PieceGlyph } from './ChessBoard';

// Slow enough to always actually see the piece travel, not just flicker.
export const PIECE_ANIM_DURATION_MS = 290;

type Pieces = Partial<Record<string, PieceCode>>;

interface Ghost {
  id: string;
  code: PieceCode;
  to: string;
  anim: Animated.ValueXY;
}

function squareIndexOf(square: string, flipped: boolean) {
  const file = 'abcdefgh'.indexOf(square[0]);
  const rank = '87654321'.indexOf(square[1]);
  return flipped ? { file: 7 - file, rank: 7 - rank } : { file, rank };
}

// Diffs two position maps into up-to-two (from, to) slides of the same
// piece — a plain move is one pair, castling is two (king + rook). A
// capture's disappearing piece has no matching "appeared" entry so it's
// left out (it's just gone, not slid anywhere); bigger changes (reset,
// switching boards) fall outside the 1-2 pair range and aren't animated —
// they snap instantly, which is what you want for those.
function diffMoves(prev: Pieces, next: Pieces): { from: string; to: string; code: PieceCode }[] {
  const removed: { sq: string; code: PieceCode }[] = [];
  const added: { sq: string; code: PieceCode }[] = [];
  const squares = new Set([...Object.keys(prev), ...Object.keys(next)]);
  for (const sq of squares) {
    const a = prev[sq];
    const b = next[sq];
    if (a === b) continue;
    if (a) removed.push({ sq, code: a });
    if (b) added.push({ sq, code: b });
  }
  const used = new Set<number>();
  const moves: { from: string; to: string; code: PieceCode }[] = [];
  for (const r of removed) {
    const idx = added.findIndex((a, i) => !used.has(i) && a.code === r.code);
    if (idx !== -1) {
      used.add(idx);
      moves.push({ from: r.sq, to: added[idx].sq, code: r.code });
    }
  }
  return moves;
}

// Shared by the board editor and Study mode so a move looks and feels
// identical in both: tracks the previous position, and on each change
// animates any simple moves (or castling's two) as sliding ghosts,
// hiding the destination square's static piece until the ghost lands.
export function usePieceAnimation(pieces: Pieces, cell: number, flipped = false) {
  const prevRef = useRef(pieces);
  const [ghosts, setGhosts] = useState<Ghost[]>([]);
  const [hiddenSquares, setHiddenSquares] = useState<Set<string>>(new Set());

  // useLayoutEffect, not useEffect: this must set hiddenSquares/ghosts
  // BEFORE the browser/native paints the render that already moved the
  // piece to its destination — otherwise that unhidden frame is briefly
  // visible first, reading as "the move happens instantly, then snaps back
  // to the start, then animates".
  useLayoutEffect(() => {
    const prev = prevRef.current;
    prevRef.current = pieces;
    if (prev === pieces) return;
    const moves = diffMoves(prev, pieces);
    if (moves.length === 0 || moves.length > 2) return;

    const newGhosts: Ghost[] = moves.map((m, i) => {
      const from = squareIndexOf(m.from, flipped);
      return {
        id: `${m.from}-${m.to}-${i}-${Date.now()}`,
        code: m.code,
        to: m.to,
        anim: new Animated.ValueXY({ x: from.file * cell, y: from.rank * cell })
      };
    });
    setHiddenSquares(new Set(moves.map((m) => m.to)));
    setGhosts(newGhosts);

    Animated.parallel(
      newGhosts.map((g, i) => {
        const to = squareIndexOf(moves[i].to, flipped);
        return Animated.timing(g.anim, {
          toValue: { x: to.file * cell, y: to.rank * cell },
          duration: PIECE_ANIM_DURATION_MS,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true
        });
      })
    ).start(() => {
      setGhosts([]);
      setHiddenSquares(new Set());
    });
  }, [pieces, cell, flipped]);

  return { hiddenSquares, ghosts };
}

export function PieceAnimationGhosts({ ghosts, cell }: { ghosts: Ghost[]; cell: number }) {
  return (
    <>
      {ghosts.map((g) => (
        <Animated.View
          key={g.id}
          pointerEvents="none"
          style={[styles.ghost, { width: cell, height: cell, transform: g.anim.getTranslateTransform() }]}
        >
          <PieceGlyph code={g.code} cell={cell} />
        </Animated.View>
      ))}
    </>
  );
}

const styles = StyleSheet.create({
  ghost: { position: 'absolute', left: 0, top: 0, alignItems: 'center', justifyContent: 'center' }
});
