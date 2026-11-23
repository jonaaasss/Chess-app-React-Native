// "29% of games (i)" under a board (card editor and Study): how often the
// board's position comes up from the opening's start position, counting only
// the opponent's choices (`boardShare.ts`). Tapping it explains the number.
// Shows nothing when it can't be worked out (no Lichess token, the board
// does not start from the opening's start position, …).
import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { alertDialog } from '../overlay';
import { colors, touchTarget } from '../theme';
import { boardShare, shareText } from '../boardShare';
import { sansForBoardMoves } from '../chessEngine';
import { DB_LABEL, getExplorerDb } from '../lichessExplorer';
import { getOpening } from '../storage';
import type { CardMode, Opening, ReactionBoard } from '../types';

function InfoIcon({ size = 16, color = colors.textDim }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Circle cx={12} cy={12} r={10} stroke={color} strokeWidth={2} fill="none" />
      <Path d="M12 10.5v6.5" stroke={color} strokeWidth={2.4} strokeLinecap="round" />
      <Circle cx={12} cy={7.2} r={1.5} fill={color} />
    </Svg>
  );
}

// "after 4...Nf6", or "the start position" for an opening without one.
function startLabel(opening: Opening | undefined): string {
  const moves = opening?.startPosition?.setupMoves ?? [];
  if (moves.length === 0) return 'the start position';
  const sans = sansForBoardMoves(moves);
  const ply = moves.length - 1;
  const n = Math.floor(ply / 2) + 1;
  return `after ${n}${ply % 2 === 0 ? '.' : '...'}${sans[sans.length - 1]}`;
}

export function BoardShare({ board, mode, yourColor, openingId }: { board: ReactionBoard; mode: CardMode; yourColor: 'w' | 'b'; openingId: string }) {
  const [share, setShare] = useState<number | null>(null);
  const [opening, setOpening] = useState<Opening | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    setShare(null);
    (async () => {
      const o = await getOpening(openingId);
      if (cancelled) return;
      setOpening(o);
      const s = await boardShare(board, mode, o?.startPosition, yourColor);
      if (!cancelled) setShare(s);
    })().catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [board, mode, yourColor, openingId]);

  if (share === null) return null;
  async function explain() {
    const db = await getExplorerDb();
    await alertDialog(
      `This position comes up in ${shareText(share!)} of the games from this opening's start position (${startLabel(opening)}).\n\n` +
        `Only your opponent's choices count: your own moves are taken as played every time.\n\nSource: Lichess explorer (${DB_LABEL[db]}).`
    );
  }
  return (
    <Pressable onPress={explain} hitSlop={8} style={styles.row} accessibilityRole="button" accessibilityLabel={`${shareText(share)} of games. What does this mean?`}>
      <Text style={styles.text}>{`${shareText(share)} of games`}</Text>
      <InfoIcon />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 5, minHeight: touchTarget - 16, alignSelf: 'center' },
  text: { color: colors.textDim, fontSize: 13, fontWeight: '600' }
});
