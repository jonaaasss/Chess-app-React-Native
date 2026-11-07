import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Defs, Marker, Path, Line, Circle as SvgCircle } from 'react-native-svg';
import { allSquares, flipIndex, squareIndex } from '../chess';
import type { Arrow, ArrowColor, BoardState, Circle, PieceCode } from '../types';
import { arrowColors, boardStyles, colors, DARK_TINT } from '../theme';
import { PieceArt } from './pieceArt';

const ARROW_KEYS = Object.keys(arrowColors) as ArrowColor[];

type Pieces = Partial<Record<string, PieceCode>>;

// An arrow that starts on one of the opponent's pieces (a white piece in a
// Black repertoire, and the other way round) shows the opponent's move
// rather than your own plan: it is drawn dashed, over a light halo that keeps
// it readable on dark and light squares alike (any palette colour, including
// the dark tints, stays itself). Decided from the
// position on screen only — nothing about it is stored. A Black repertoire
// is always shown flipped (see flipIndex), so `flipped` tells whose side
// you're on unless `yourColor` says otherwise.
// Also used to leave such arrows out of the same-colour numbering.
export function isOpponentArrow(from: string, pieces: Pieces | undefined, yourColor: 'w' | 'b'): boolean {
  const piece = pieces?.[from];
  return !!piece && piece[0] !== yourColor;
}

// An opponent's arrow or circle is always drawn in the dark tint of its colour.
export function opponentTint(color: ArrowColor): ArrowColor {
  return (DARK_TINT as Record<string, ArrowColor>)[color] ?? color;
}

// Whose move a threat arrow is (Summary). 1) the piece on its start square;
// 2) on an empty square, the piece at the start of a chain of arrows that
// ends there (e.g. g1-f3 before f3-g5); 3) otherwise the kind of threat: an
// opponent threat's arrow is the opponent's, one of yours is yours. Every
// other arrow: only rule 1, as before.
export function arrowIsOpponent(arrow: Arrow, pieces: Pieces | undefined, yourColor: 'w' | 'b', arrows: Arrow[] = []): boolean {
  const kind = arrow.notes?.threat ? 'opp' : arrow.notes?.myThreat ? 'mine' : null;
  if (!kind) return isOpponentArrow(arrow.from, pieces, yourColor);
  const seen = new Set<string>();
  const ownerOf = (square: string): 'w' | 'b' | null => {
    const piece = pieces?.[square];
    if (piece) return piece[0] as 'w' | 'b';
    if (seen.has(square)) return null;
    seen.add(square);
    for (const a of arrows) {
      if (a.to !== square || a === arrow) continue;
      const owner = ownerOf(a.from);
      if (owner) return owner;
    }
    return null;
  };
  const owner = ownerOf(arrow.from);
  return owner ? owner !== yourColor : kind === 'opp';
}

// The colour an arrow is shown (and studied) in: its own, or for an
// opponent's arrow the dark tint of it. A threat arrow is always its threat's
// colour (purple / teal), dark when it is the opponent's (see arrowIsOpponent).
export function effectiveArrowColor(arrow: Arrow, pieces: Pieces | undefined, yourColor: 'w' | 'b', arrows: Arrow[] = []): ArrowColor {
  if (arrow.notes?.threat || arrow.notes?.myThreat) {
    const base: ArrowColor = arrow.notes?.threat ? 'purple' : 'teal';
    return arrowIsOpponent(arrow, pieces, yourColor, arrows) ? opponentTint(base) : base;
  }
  return isOpponentArrow(arrow.from, pieces, yourColor) ? opponentTint(arrow.color) : arrow.color;
}

const OPPONENT_DASH = '0.28 0.18';
// The light outline under an opponent's dashed arrow (and circle).
const HALO = 'rgba(255,255,255,0.7)';
const HALO_EXTRA = 0.1;

// Arrows for the very same move (a Summary allows one per colour) are drawn
// side by side instead of on top of each other: each gets a sideways offset
// in board squares (0 for an arrow that is alone on its move).
const PARALLEL_STEP = 0.24;
export function parallelOffsets(arrows: { from: string; to: string }[]): number[] {
  const count = new Map<string, number>();
  for (const a of arrows) count.set(`${a.from}-${a.to}`, (count.get(`${a.from}-${a.to}`) ?? 0) + 1);
  const seen = new Map<string, number>();
  return arrows.map((a) => {
    const key = `${a.from}-${a.to}`;
    const n = count.get(key) ?? 1;
    const k = seen.get(key) ?? 0;
    seen.set(key, k + 1);
    return (k - (n - 1) / 2) * PARALLEL_STEP;
  });
}

// Start and end (in board squares) of an arrow, shortened at the head and
// shifted sideways by `offset`.
function arrowLine(from: string, to: string, flipped: boolean, offset: number) {
  const fromRaw = squareIndex(from);
  const toRaw = squareIndex(to);
  let x1 = flipIndex(fromRaw.file, flipped) + 0.5;
  let y1 = flipIndex(fromRaw.rank, flipped) + 0.5;
  let x2 = flipIndex(toRaw.file, flipped) + 0.5;
  let y2 = flipIndex(toRaw.rank, flipped) + 0.5;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  const ox = (-dy / len) * offset;
  const oy = (dx / len) * offset;
  x1 += ox;
  y1 += oy;
  x2 += ox - (dx / len) * 0.35;
  y2 += oy - (dy / len) * 0.35;
  return { x1, y1, x2, y2 };
}

export function ArrowsSvg({
  arrows,
  size,
  flipped = false,
  pieces,
  yourColor
}: {
  arrows: Arrow[];
  size: number;
  flipped?: boolean;
  // The position the arrows are drawn on; without it every arrow looks like your own.
  pieces?: Pieces;
  yourColor?: 'w' | 'b';
}) {
  const side = yourColor ?? (flipped ? 'b' : 'w');
  const offsets = parallelOffsets(arrows);
  return (
    <Svg width={size} height={size} viewBox="0 0 8 8" style={StyleSheet.absoluteFill}>
      <Defs>
        {ARROW_KEYS.map((color) => (
          <React.Fragment key={color}>
            <Marker id={`arrowhead-${color}`} markerWidth={3} markerHeight={3} refX={1.4} refY={1.5} orient="auto">
              <Path d="M0,0 L3,1.5 L0,3 Z" fill={arrowColors[color]} />
            </Marker>
            <Marker id={`arrowhead-${color}-opp`} markerWidth={3} markerHeight={3} refX={1.4} refY={1.5} orient="auto">
              <Path d="M0,0 L3,1.5 L0,3 Z" fill={arrowColors[color]} stroke={HALO} strokeWidth={0.3} />
            </Marker>
          </React.Fragment>
        ))}
      </Defs>
      {arrows.map((arrow, i) => {
        const { x1, y1, x2, y2 } = arrowLine(arrow.from, arrow.to, flipped, offsets[i]);
        const opp = arrowIsOpponent(arrow, pieces, side, arrows);
        const color = effectiveArrowColor(arrow, pieces, side, arrows);
        return (
          <React.Fragment key={i}>
            {opp && <Line x1={x1} y1={y1} x2={x2} y2={y2} stroke={HALO} strokeWidth={0.16 + HALO_EXTRA} strokeLinecap="butt" strokeDasharray={OPPONENT_DASH} />}
            <Line
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              stroke={arrowColors[color]}
              strokeWidth={0.16}
              strokeLinecap={opp ? 'butt' : 'round'}
              strokeDasharray={opp ? OPPONENT_DASH : undefined}
              opacity={opp ? 1 : 0.9}
              markerEnd={`url(#arrowhead-${color}${opp ? '-opp' : ''})`}
            />
          </React.Fragment>
        );
      })}
    </Svg>
  );
}

export interface NumberedArrow {
  id: string;
  from: string;
  to: string;
  color: string; // resolved hex/rgba, not an ArrowColor key — callers may use non-palette colors (e.g. Study's green/red)
  number?: number; // omit to draw the arrow without a badge
  label?: string; // shown in the badge instead of a number (e.g. "!" for a threat)
  width?: number; // stroke width in board-square units; defaults to the standard 0.16 (e.g. engine best-move arrows go slightly thicker)
  opponent?: boolean; // whose arrow it is, when the start square alone can't tell (threat arrows); otherwise worked out from `pieces`
}

// Same thin-line arrow look as the board editor's plain ArrowsSvg — used
// wherever an arrow needs a number badge attached (the editor's own
// same-color arrow numbering, and Study's variant callouts). Shared so the
// two look identical.
export function NumberedArrowsSvg({
  arrows,
  size,
  flipped = false,
  pieces,
  yourColor
}: {
  arrows: NumberedArrow[];
  size: number;
  flipped?: boolean;
  // Only for hand-drawn arrows (see ArrowsSvg); engine and variation arrows leave it out.
  pieces?: Pieces;
  yourColor?: 'w' | 'b';
}) {
  const side = yourColor ?? (flipped ? 'b' : 'w');
  const offsets = parallelOffsets(arrows);
  return (
    <Svg width={size} height={size} viewBox="0 0 8 8" style={StyleSheet.absoluteFill}>
      <Defs>
        {arrows.map((a) => (
          <Marker key={a.id} id={`numbered-head-${a.id}`} markerWidth={3} markerHeight={3} refX={1.4} refY={1.5} orient="auto">
            <Path d="M0,0 L3,1.5 L0,3 Z" fill={a.color} stroke={(a.opponent ?? isOpponentArrow(a.from, pieces, side)) ? HALO : undefined} strokeWidth={0.3} />
          </Marker>
        ))}
      </Defs>
      {arrows.map((a, i) => {
        const { x1, y1, x2, y2 } = arrowLine(a.from, a.to, flipped, offsets[i]);
        const opp = a.opponent ?? isOpponentArrow(a.from, pieces, side);
        const width = a.width ?? 0.16;
        return (
          <React.Fragment key={a.id}>
            {opp && <Line x1={x1} y1={y1} x2={x2} y2={y2} stroke={HALO} strokeWidth={width + HALO_EXTRA} strokeLinecap="butt" strokeDasharray={OPPONENT_DASH} />}
            <Line
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              stroke={a.color}
              strokeWidth={width}
              strokeLinecap={opp ? 'butt' : 'round'}
              strokeDasharray={opp ? OPPONENT_DASH : undefined}
              opacity={opp ? 1 : 0.9}
              markerEnd={`url(#numbered-head-${a.id})`}
            />
          </React.Fragment>
        );
      })}
    </Svg>
  );
}

// The number badges for NumberedArrowsSvg, pushed to the side of each
// arrow (alternating left/right) rather than sitting on its midpoint —
// short or near-parallel arrows would otherwise stack their badges.
export interface Point {
  x: number;
  y: number;
}

// Where an arrow's number badge sits by default: 70% along the arrow, pushed
// to alternating sides so near-parallel arrows don't stack their badges.
export function numberBadgeCenter(a: { from: string; to: string }, i: number, size: number, flipped: boolean, offset = 0): Point {
  const cell = size / 8;
  const centerPx = (square: string) => {
    const raw = squareIndex(square);
    return { x: (flipIndex(raw.file, flipped) + 0.5) * cell, y: (flipIndex(raw.rank, flipped) + 0.5) * cell };
  };
  const from = centerPx(a.from);
  const to = centerPx(a.to);
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  // A side-by-side arrow (see parallelOffsets) keeps its badge on its own side.
  const side = offset !== 0 ? Math.sign(offset) : i % 2 === 0 ? 1 : -1;
  const push = 10 + Math.abs(offset) * cell;
  return { x: from.x + dx * 0.7 + (-dy / len) * push * side, y: from.y + dy * 0.7 + (dx / len) * push * side };
}

// Moves badges that overlap apart until each has room (a few relaxation
// passes: every overlapping pair is pushed apart along the line between
// them), kept inside the board. Used for all badges of a board together —
// numbers, "!", note and link badges — so none ends up hidden under another.
export function separateBadgeCenters(points: Point[], minDist: number, size: number): Point[] {
  const p = points.map((c) => ({ ...c }));
  for (let iter = 0; iter < 12; iter++) {
    let moved = false;
    for (let i = 0; i < p.length; i++) {
      for (let j = i + 1; j < p.length; j++) {
        const dx = p[j].x - p[i].x;
        const dy = p[j].y - p[i].y;
        const dist = Math.hypot(dx, dy);
        if (dist >= minDist) continue;
        moved = true;
        const ux = dist > 0.01 ? dx / dist : 1;
        const uy = dist > 0.01 ? dy / dist : 0;
        const push = (minDist - dist) / 2;
        p[i].x -= ux * push;
        p[i].y -= uy * push;
        p[j].x += ux * push;
        p[j].y += uy * push;
      }
    }
    for (const c of p) {
      c.x = Math.min(size - 10, Math.max(10, c.x));
      c.y = Math.min(size - 10, Math.max(10, c.y));
    }
    if (!moved) break;
  }
  return p;
}

export function NumberedArrowBadges({
  arrows,
  size,
  flipped = false,
  pieces,
  yourColor,
  centers
}: {
  arrows: NumberedArrow[];
  size: number;
  flipped?: boolean;
  // As in NumberedArrowsSvg: an opponent's (dashed) arrow gets an outlined badge.
  pieces?: Pieces;
  yourColor?: 'w' | 'b';
  // Positions worked out together with other badges (see separateBadgeCenters).
  centers?: (Point | undefined)[];
}) {
  const yourSide = yourColor ?? (flipped ? 'b' : 'w');
  return (
    <>
      {arrows.map((a, i) => {
        if (a.number === undefined && !a.label) return null;
        const { x: bx, y: by } = centers?.[i] ?? numberBadgeCenter(a, i, size, flipped);
        return (
          <View key={a.id} style={[badgeStyles.badge, { left: bx - 9, top: by - 9, backgroundColor: a.color }, (a.opponent ?? isOpponentArrow(a.from, pieces, yourSide)) && badgeStyles.opponent]}>
            <Text style={badgeStyles.text}>{a.label ?? a.number}</Text>
          </View>
        );
      })}
    </>
  );
}

const badgeStyles = StyleSheet.create({
  // An opponent's arrow badge gets the same light outline as its dashed line.
  opponent: { borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.85)' },
  badge: {
    position: 'absolute',
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center'
  },
  text: { color: '#fff', fontSize: 10, fontWeight: '700' }
});

// A circle on an opponent's piece is drawn in the darker shade too (solid,
// unlike the dashed opponent arrows), so it reads as being about their piece.
export function CirclesSvg({
  circles,
  size,
  flipped = false,
  pieces,
  yourColor
}: {
  circles: Circle[];
  size: number;
  flipped?: boolean;
  pieces?: Pieces;
  yourColor?: 'w' | 'b';
}) {
  const side = yourColor ?? (flipped ? 'b' : 'w');
  return (
    <Svg width={size} height={size} viewBox="0 0 8 8" style={StyleSheet.absoluteFill}>
      {circles.map((c, i) => {
        const raw = squareIndex(c.square);
        const file = flipIndex(raw.file, flipped);
        const rank = flipIndex(raw.rank, flipped);
        const opp = isOpponentArrow(c.square, pieces, side);
        return (
          <React.Fragment key={i}>
            {opp && <SvgCircle cx={file + 0.5} cy={rank + 0.5} r={0.42} stroke={HALO} strokeWidth={0.09 + HALO_EXTRA} fill="none" />}
            <SvgCircle cx={file + 0.5} cy={rank + 0.5} r={0.42} stroke={arrowColors[opp ? opponentTint(c.color) : c.color]} strokeWidth={0.09} fill="none" opacity={opp ? 1 : 0.9} />
          </React.Fragment>
        );
      })}
    </Svg>
  );
}

export function PieceGlyph({ code, cell }: { code: PieceCode; cell: number }) {
  return (
    <View style={{ width: cell, height: cell, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={cell * 0.9} height={cell * 0.9} viewBox="0 0 45 45">
        <PieceArt code={code} />
      </Svg>
    </View>
  );
}

// a-h / 1-8 labels drawn inside the squares of the left column and bottom
// row (like chess.com), following the board's orientation. Decorative only.
export function BoardCoords({ size, flipped = false, styleSet }: { size: number; flipped?: boolean; styleSet: { light: string; dark: string } }) {
  const cell = size / 8;
  const fs = Math.max(8, Math.round(cell * 0.24));
  const labelColor = (row: number, col: number) => ((row + col) % 2 === 0 ? styleSet.dark : styleSet.light);
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {Array.from({ length: 8 }, (_, r) => (
        <Text key={`r${r}`} style={{ position: 'absolute', left: 2, top: r * cell + 1, fontSize: fs, fontWeight: '700', color: labelColor(r, 0) }}>
          {flipped ? r + 1 : 8 - r}
        </Text>
      ))}
      {Array.from({ length: 8 }, (_, c) => (
        <Text key={`f${c}`} style={{ position: 'absolute', left: c * cell, width: cell - 3, textAlign: 'right', top: size - fs - 3, fontSize: fs, fontWeight: '700', color: labelColor(7, c) }}>
          {String.fromCharCode((flipped ? 104 - c : 97 + c))}
        </Text>
      ))}
    </View>
  );
}

export function ChessBoardView({ board, size, flipped = false }: { board: BoardState; size: number; flipped?: boolean }) {
  const cell = size / 8;
  const squares = flipped ? [...allSquares()].reverse() : allSquares();
  const styleSet = boardStyles[board.style] ?? boardStyles[0];
  return (
    <View style={[styles.wrap, { width: size, height: size, borderColor: colors.border }]}>
      <View style={{ width: size, height: size, flexDirection: 'row', flexWrap: 'wrap' }}>
        {squares.map((sq, i) => {
          const file = i % 8;
          const rank = Math.floor(i / 8);
          const isLight = (file + rank) % 2 === 0;
          const piece = board.pieces[sq];
          return (
            <View
              key={sq}
              style={{
                width: cell,
                height: cell,
                backgroundColor: isLight ? styleSet.light : styleSet.dark,
                alignItems: 'center',
                justifyContent: 'center'
              }}
            >
              {piece && <PieceGlyph code={piece} cell={cell} />}
            </View>
          );
        })}
      </View>
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        <ArrowsSvg arrows={board.arrows} size={size} flipped={flipped} pieces={board.pieces} />
        {board.circles && board.circles.length > 0 && (
          <CirclesSvg circles={board.circles} size={size} flipped={flipped} pieces={board.pieces} />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { borderRadius: 6, overflow: 'hidden', borderWidth: 1, alignSelf: 'center' }
});
