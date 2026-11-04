import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Defs, Marker, Path, Line, Circle as SvgCircle } from 'react-native-svg';
import { allSquares, flipIndex, squareIndex } from '../chess';
import type { Arrow, ArrowColor, BoardState, Circle, PieceCode } from '../types';
import { arrowColors, boardStyles, colors } from '../theme';
import { PieceArt } from './pieceArt';

const ARROW_KEYS = Object.keys(arrowColors) as ArrowColor[];

type Pieces = Partial<Record<string, PieceCode>>;

// An arrow that starts on one of the opponent's pieces (a white piece in a
// Black repertoire, and the other way round) shows the opponent's move
// rather than your own plan: it is drawn darker and dashed. Decided from the
// position on screen only — nothing about it is stored. A Black repertoire
// is always shown flipped (see flipIndex), so `flipped` tells whose side
// you're on unless `yourColor` says otherwise.
// Also used to leave such arrows out of the same-colour numbering.
export function isOpponentArrow(from: string, pieces: Pieces | undefined, yourColor: 'w' | 'b'): boolean {
  const piece = pieces?.[from];
  return !!piece && piece[0] !== yourColor;
}

// The same hue, about 40% darker — works for the palette and for the
// resolved hex colours NumberedArrowsSvg gets.
function darker(color: string): string {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(color);
  if (!m) return color;
  const ch = (h: string) => Math.round(parseInt(h, 16) * 0.6).toString(16).padStart(2, '0');
  return `#${ch(m[1])}${ch(m[2])}${ch(m[3])}`;
}

const OPPONENT_DASH = '0.28 0.18';

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
  return (
    <Svg width={size} height={size} viewBox="0 0 8 8" style={StyleSheet.absoluteFill}>
      <Defs>
        {ARROW_KEYS.map((color) => (
          <React.Fragment key={color}>
            <Marker id={`arrowhead-${color}`} markerWidth={3} markerHeight={3} refX={1.4} refY={1.5} orient="auto">
              <Path d="M0,0 L3,1.5 L0,3 Z" fill={arrowColors[color]} />
            </Marker>
            <Marker id={`arrowhead-${color}-opp`} markerWidth={3} markerHeight={3} refX={1.4} refY={1.5} orient="auto">
              <Path d="M0,0 L3,1.5 L0,3 Z" fill={darker(arrowColors[color])} />
            </Marker>
          </React.Fragment>
        ))}
      </Defs>
      {arrows.map((arrow, i) => {
        const fromRaw = squareIndex(arrow.from);
        const toRaw = squareIndex(arrow.to);
        const from = { file: flipIndex(fromRaw.file, flipped), rank: flipIndex(fromRaw.rank, flipped) };
        const to = { file: flipIndex(toRaw.file, flipped), rank: flipIndex(toRaw.rank, flipped) };
        const x1 = from.file + 0.5;
        const y1 = from.rank + 0.5;
        let x2 = to.file + 0.5;
        let y2 = to.rank + 0.5;
        const dx = x2 - x1;
        const dy = y2 - y1;
        const len = Math.hypot(dx, dy) || 1;
        x2 -= (dx / len) * 0.35;
        y2 -= (dy / len) * 0.35;
        const opp = isOpponentArrow(arrow.from, pieces, side);
        return (
          <Line
            key={i}
            x1={x1}
            y1={y1}
            x2={x2}
            y2={y2}
            stroke={opp ? darker(arrowColors[arrow.color]) : arrowColors[arrow.color]}
            strokeWidth={0.16}
            strokeLinecap={opp ? 'butt' : 'round'}
            strokeDasharray={opp ? OPPONENT_DASH : undefined}
            opacity={0.9}
            markerEnd={`url(#arrowhead-${arrow.color}${opp ? '-opp' : ''})`}
          />
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
  width?: number; // stroke width in board-square units; defaults to the standard 0.16 (e.g. engine best-move arrows go slightly thicker)
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
  const colorOf = (a: NumberedArrow) => (isOpponentArrow(a.from, pieces, side) ? darker(a.color) : a.color);
  return (
    <Svg width={size} height={size} viewBox="0 0 8 8" style={StyleSheet.absoluteFill}>
      <Defs>
        {arrows.map((a) => (
          <Marker key={a.id} id={`numbered-head-${a.id}`} markerWidth={3} markerHeight={3} refX={1.4} refY={1.5} orient="auto">
            <Path d="M0,0 L3,1.5 L0,3 Z" fill={colorOf(a)} />
          </Marker>
        ))}
      </Defs>
      {arrows.map((a) => {
        const fromRaw = squareIndex(a.from);
        const toRaw = squareIndex(a.to);
        const from = { file: flipIndex(fromRaw.file, flipped), rank: flipIndex(fromRaw.rank, flipped) };
        const to = { file: flipIndex(toRaw.file, flipped), rank: flipIndex(toRaw.rank, flipped) };
        const x1 = from.file + 0.5;
        const y1 = from.rank + 0.5;
        let x2 = to.file + 0.5;
        let y2 = to.rank + 0.5;
        const dx = x2 - x1;
        const dy = y2 - y1;
        const len = Math.hypot(dx, dy) || 1;
        x2 -= (dx / len) * 0.35;
        y2 -= (dy / len) * 0.35;
        const opp = isOpponentArrow(a.from, pieces, side);
        return (
          <Line
            key={a.id}
            x1={x1}
            y1={y1}
            x2={x2}
            y2={y2}
            stroke={colorOf(a)}
            strokeWidth={a.width ?? 0.16}
            strokeLinecap={opp ? 'butt' : 'round'}
            strokeDasharray={opp ? OPPONENT_DASH : undefined}
            opacity={0.9}
            markerEnd={`url(#numbered-head-${a.id})`}
          />
        );
      })}
    </Svg>
  );
}

// The number badges for NumberedArrowsSvg, pushed to the side of each
// arrow (alternating left/right) rather than sitting on its midpoint —
// short or near-parallel arrows would otherwise stack their badges.
export function NumberedArrowBadges({
  arrows,
  size,
  flipped = false,
  pieces,
  yourColor
}: {
  arrows: NumberedArrow[];
  size: number;
  flipped?: boolean;
  // As in NumberedArrowsSvg: an opponent's (dashed) arrow gets a darker badge.
  pieces?: Pieces;
  yourColor?: 'w' | 'b';
}) {
  const yourSide = yourColor ?? (flipped ? 'b' : 'w');
  const cell = size / 8;
  function centerPx(square: string) {
    const raw = squareIndex(square);
    const file = flipIndex(raw.file, flipped);
    const rank = flipIndex(raw.rank, flipped);
    return { x: file * cell + cell / 2, y: rank * cell + cell / 2 };
  }
  return (
    <>
      {arrows.map((a, i) => {
        if (a.number === undefined) return null;
        const from = centerPx(a.from);
        const to = centerPx(a.to);
        const dx = to.x - from.x;
        const dy = to.y - from.y;
        const len = Math.hypot(dx, dy) || 1;
        const px = from.x + dx * 0.7;
        const py = from.y + dy * 0.7;
        const nx = -dy / len;
        const ny = dx / len;
        const side = i % 2 === 0 ? 1 : -1;
        const offset = 10;
        const bx = px + nx * offset * side;
        const by = py + ny * offset * side;
        return (
          <View key={a.id} style={[badgeStyles.badge, { left: bx - 9, top: by - 9, backgroundColor: isOpponentArrow(a.from, pieces, yourSide) ? darker(a.color) : a.color }]}>
            <Text style={badgeStyles.text}>{a.number}</Text>
          </View>
        );
      })}
    </>
  );
}

const badgeStyles = StyleSheet.create({
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
        return (
          <SvgCircle
            key={i}
            cx={file + 0.5}
            cy={rank + 0.5}
            r={0.42}
            stroke={isOpponentArrow(c.square, pieces, side) ? darker(arrowColors[c.color]) : arrowColors[c.color]}
            strokeWidth={0.09}
            fill="none"
            opacity={0.9}
          />
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
