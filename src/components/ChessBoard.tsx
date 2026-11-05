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

// The colour an arrow is shown (and studied) in: its own, or for an
// opponent's arrow the dark tint of it.
export function effectiveArrowColor(arrow: Arrow, pieces: Pieces | undefined, yourColor: 'w' | 'b'): ArrowColor {
  return isOpponentArrow(arrow.from, pieces, yourColor) ? opponentTint(arrow.color) : arrow.color;
}

const OPPONENT_DASH = '0.28 0.18';
// The light outline under an opponent's dashed arrow (and circle).
const HALO = 'rgba(255,255,255,0.7)';
const HALO_EXTRA = 0.1;

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
              <Path d="M0,0 L3,1.5 L0,3 Z" fill={arrowColors[color]} stroke={HALO} strokeWidth={0.3} />
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
        const color = opp ? opponentTint(arrow.color) : arrow.color;
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
  return (
    <Svg width={size} height={size} viewBox="0 0 8 8" style={StyleSheet.absoluteFill}>
      <Defs>
        {arrows.map((a) => (
          <Marker key={a.id} id={`numbered-head-${a.id}`} markerWidth={3} markerHeight={3} refX={1.4} refY={1.5} orient="auto">
            <Path d="M0,0 L3,1.5 L0,3 Z" fill={a.color} stroke={isOpponentArrow(a.from, pieces, side) ? HALO : undefined} strokeWidth={0.3} />
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
        if (a.number === undefined && !a.label) return null;
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
          <View key={a.id} style={[badgeStyles.badge, { left: bx - 9, top: by - 9, backgroundColor: a.color }, isOpponentArrow(a.from, pieces, yourSide) && badgeStyles.opponent]}>
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
