import React from 'react';
import { View, StyleSheet } from 'react-native';
import Svg, { Defs, Marker, Path, Line, Circle as SvgCircle } from 'react-native-svg';
import { allSquares, squareIndex } from '../chess';
import type { Arrow, ArrowColor, BoardState, Circle, PieceCode } from '../types';
import { arrowColors, boardStyles, colors } from '../theme';
import { PieceArt } from './pieceArt';

const ARROW_KEYS = Object.keys(arrowColors) as ArrowColor[];

export function ArrowsSvg({ arrows, size }: { arrows: Arrow[]; size: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 8 8" style={StyleSheet.absoluteFill}>
      <Defs>
        {ARROW_KEYS.map((color) => (
          <Marker
            key={color}
            id={`arrowhead-${color}`}
            markerWidth={3}
            markerHeight={3}
            refX={1.4}
            refY={1.5}
            orient="auto"
          >
            <Path d="M0,0 L3,1.5 L0,3 Z" fill={arrowColors[color]} />
          </Marker>
        ))}
      </Defs>
      {arrows.map((arrow, i) => {
        const from = squareIndex(arrow.from);
        const to = squareIndex(arrow.to);
        const x1 = from.file + 0.5;
        const y1 = from.rank + 0.5;
        let x2 = to.file + 0.5;
        let y2 = to.rank + 0.5;
        const dx = x2 - x1;
        const dy = y2 - y1;
        const len = Math.hypot(dx, dy) || 1;
        x2 -= (dx / len) * 0.35;
        y2 -= (dy / len) * 0.35;
        return (
          <Line
            key={i}
            x1={x1}
            y1={y1}
            x2={x2}
            y2={y2}
            stroke={arrowColors[arrow.color]}
            strokeWidth={0.16}
            strokeLinecap="round"
            opacity={0.9}
            markerEnd={`url(#arrowhead-${arrow.color})`}
          />
        );
      })}
    </Svg>
  );
}

export function CirclesSvg({ circles, size }: { circles: Circle[]; size: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 8 8" style={StyleSheet.absoluteFill}>
      {circles.map((c, i) => {
        const { file, rank } = squareIndex(c.square);
        return (
          <SvgCircle
            key={i}
            cx={file + 0.5}
            cy={rank + 0.5}
            r={0.42}
            stroke={arrowColors[c.color]}
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

export function ChessBoardView({ board, size }: { board: BoardState; size: number }) {
  const cell = size / 8;
  const squares = allSquares();
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
        <ArrowsSvg arrows={board.arrows} size={size} />
        {board.circles && board.circles.length > 0 && <CirclesSvg circles={board.circles} size={size} />}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { borderRadius: 6, overflow: 'hidden', borderWidth: 1, alignSelf: 'center' }
});
