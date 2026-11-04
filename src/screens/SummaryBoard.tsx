// The look-only board used by Summary cards in Study and by the card viewer:
// the position with every arrow and circle already drawn, plus two kinds of
// tappable badges on Summary arrows — a link badge (opens the linked card)
// and an orange note badge (shows the arrow's notes underneath the board).
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Svg, { Circle as SvgCircle, Path } from 'react-native-svg';
import { flipIndex, squareIndex } from '../chess';
import { ChessBoardView } from '../components/ChessBoard';
import type { Arrow, Circle, PieceCode } from '../types';
import { colors } from '../theme';

const BADGE = 26;
const HIT = (48 - BADGE) / 2;

// Notes with something to read (a link alone is not a note).
export function hasNoteText(arrow: Arrow): boolean {
  const n = arrow.notes;
  return !!(n?.reason?.trim() || n?.next?.trim() || n?.responses?.some((r) => r.text.trim()));
}

function LinkIcon({ size, color }: { size: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M10 13a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07l-1.5 1.5M14 11a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07l1.5-1.5"
        stroke={color}
        strokeWidth={2.4}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

function NoteIcon({ size }: { size: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <SvgCircle cx={12} cy={12} r={4} fill={colors.onGold} />
    </Svg>
  );
}

// A point `t` of the way along the arrow, pushed sideways so the two badges
// of one arrow (and badges of crossing arrows) don't sit on the line itself.
function pointOn(arrow: Arrow, t: number, size: number, flipped: boolean, side: number) {
  const cell = size / 8;
  const center = (sq: string) => {
    const raw = squareIndex(sq);
    return { x: (flipIndex(raw.file, flipped) + 0.5) * cell, y: (flipIndex(raw.rank, flipped) + 0.5) * cell };
  };
  const a = center(arrow.from);
  const b = center(arrow.to);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  return { x: a.x + dx * t + (-dy / len) * 12 * side, y: a.y + dy * t + (dx / len) * 12 * side };
}

export function SummaryBoard({
  pieces,
  arrows,
  circles,
  size,
  flipped,
  boardStyle,
  onOpenLink,
  onShowNote
}: {
  pieces: Partial<Record<string, PieceCode>>;
  arrows: Arrow[];
  circles: Circle[];
  size: number;
  flipped: boolean;
  boardStyle: number;
  // Leave out to show the board without badges (e.g. a linked Plan card).
  onOpenLink?: (cardId: string) => void;
  onShowNote?: (arrow: Arrow) => void;
}) {
  return (
    <View style={{ width: size, height: size, alignSelf: 'center' }}>
      <ChessBoardView board={{ pieces, style: boardStyle, arrows, circles }} size={size} flipped={flipped} />
      {arrows.map((arrow, i) => {
        const side = i % 2 === 0 ? 1 : -1;
        const link = onOpenLink && arrow.notes?.linkCardId;
        const note = onShowNote && hasNoteText(arrow);
        const linkAt = pointOn(arrow, 0.4, size, flipped, side);
        const noteAt = pointOn(arrow, 0.7, size, flipped, side);
        return (
          <React.Fragment key={`${arrow.from}-${arrow.to}-${i}`}>
            {link && (
              <Pressable
                onPress={() => onOpenLink(arrow.notes!.linkCardId!)}
                hitSlop={HIT}
                accessibilityLabel="Open linked card"
                style={[styles.badge, styles.linkBadge, { left: linkAt.x - BADGE / 2, top: linkAt.y - BADGE / 2 }]}
              >
                <LinkIcon size={16} color={colors.text} />
              </Pressable>
            )}
            {note && (
              <Pressable
                onPress={() => onShowNote(arrow)}
                hitSlop={HIT}
                accessibilityLabel="Show notes"
                style={[styles.badge, styles.noteBadge, { left: noteAt.x - BADGE / 2, top: noteAt.y - BADGE / 2 }]}
              >
                <NoteIcon size={18} />
              </Pressable>
            )}
          </React.Fragment>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    position: 'absolute',
    width: BADGE,
    height: BADGE,
    borderRadius: BADGE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1
  },
  linkBadge: { backgroundColor: colors.panel, borderColor: colors.text },
  noteBadge: { backgroundColor: colors.gold, borderColor: colors.gold }
});
