// Board editor: the Lichess opening explorer for the position on the board.
// Each row is a move with its number of games and a white / draw / black bar;
// tap a row to play it. Collapsible; the database (Lichess 2200–2500 or
// Masters) and whether it is open are remembered.
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { GameState } from '../chessEngine';
import { toFen } from '../chess';
import { colors, radius, touchTarget } from '../theme';
import { DB_LABEL, fetchExplorer, getExplorerDb, moveForSan, onExplorerDbChange, setExplorerDb, type ExplorerDb, type ExplorerResult } from '../lichessExplorer';
import type { PromotionPiece } from '../types';

const OPEN_KEY = 'lichess.explorerOpen';

function formatGames(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${Math.round(n / 1000)}k`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

export function ExplorerPanel({ state, onPlay }: { state: GameState; onPlay: (from: string, to: string, promotion?: PromotionPiece) => void }) {
  const [open, setOpen] = useState(true);
  const [db, setDb] = useState<ExplorerDb>('lichess');
  const [result, setResult] = useState<ExplorerResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fen = toFen(state.pieces, state.turn, state.castling, state.enPassant);

  useEffect(() => {
    getExplorerDb().then(setDb);
    AsyncStorage.getItem(OPEN_KEY)
      .then((v) => v === 'false' && setOpen(false))
      .catch(() => undefined);
    return onExplorerDbChange(setDb);
  }, []);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    // A short wait, so stepping quickly through moves asks Lichess only once.
    const t = setTimeout(() => {
      fetchExplorer(fen, db)
        .then((r) => !cancelled && setResult(r))
        .catch((e: Error) => !cancelled && setError(e.message))
        .finally(() => !cancelled && setLoading(false));
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [fen, db, open]);

  function toggleOpen() {
    const next = !open;
    setOpen(next);
    AsyncStorage.setItem(OPEN_KEY, String(next)).catch(() => undefined);
  }

  function chooseDb(next: ExplorerDb) {
    if (next === db) return;
    setDb(next);
    setResult(null);
    void setExplorerDb(next);
  }

  return (
    <View style={styles.panel}>
      <Pressable onPress={toggleOpen} style={styles.head} accessibilityLabel={open ? 'Hide the explorer' : 'Show the explorer'}>
        <Text style={styles.title}>{`Explorer ${open ? '▴' : '▾'}`}</Text>
        {open && loading && <ActivityIndicator size="small" color={colors.textDim} />}
        {open && result && !loading && <Text style={styles.total}>{`${formatGames(result.games)} games`}</Text>}
      </Pressable>
      {open && (
        <>
          <View style={styles.dbRow}>
            {(['lichess', 'masters'] as const).map((d) => (
              <Pressable key={d} onPress={() => chooseDb(d)} style={[styles.dbBtn, db === d && styles.dbBtnOn]} accessibilityRole="radio" accessibilityState={{ selected: db === d }}>
                <Text style={[styles.dbText, db === d && styles.dbTextOn]}>{DB_LABEL[d]}</Text>
              </Pressable>
            ))}
          </View>
          {error ? (
            <Text style={styles.error}>{error}</Text>
          ) : result && result.moves.length === 0 ? (
            <Text style={styles.empty}>No games from this position.</Text>
          ) : (
            result?.moves.map((m) => {
              const w = (m.white / m.games) * 100;
              const d = (m.draws / m.games) * 100;
              const b = 100 - w - d;
              return (
                <Pressable
                  key={m.san}
                  onPress={() => {
                    const mv = moveForSan(state, m.san);
                    if (mv) onPlay(mv.from, mv.to, mv.promotion);
                  }}
                  style={({ pressed }) => [styles.row, pressed && { opacity: 0.6 }]}
                  accessibilityLabel={`Play ${m.san}`}
                >
                  <Text style={styles.san}>{m.san}</Text>
                  <Text style={styles.games}>{formatGames(m.games)}</Text>
                  <View style={styles.bar}>
                    <View style={[styles.barWhite, { flex: w }]}>{w >= 18 && <Text style={styles.barTextDark}>{`${Math.round(w)}%`}</Text>}</View>
                    <View style={[styles.barDraw, { flex: d }]}>{d >= 18 && <Text style={styles.barTextLight}>{`${Math.round(d)}%`}</Text>}</View>
                    <View style={[styles.barBlack, { flex: b }]}>{b >= 18 && <Text style={styles.barTextLight}>{`${Math.round(b)}%`}</Text>}</View>
                  </View>
                </Pressable>
              );
            })
          )}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { marginTop: 12, marginBottom: 10, backgroundColor: colors.panel2, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, overflow: 'hidden' },
  head: { minHeight: touchTarget, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12 },
  title: { color: colors.text, fontSize: 14, fontWeight: '700' },
  total: { color: colors.textDim, fontSize: 12 },
  dbRow: { flexDirection: 'row', gap: 6, paddingHorizontal: 10, paddingBottom: 8 },
  dbBtn: { flex: 1, minHeight: 40, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  dbBtnOn: { backgroundColor: '#E2E8F0', borderColor: '#E2E8F0' },
  dbText: { color: colors.textDim, fontSize: 13, fontWeight: '600' },
  dbTextOn: { color: colors.bg, fontWeight: '700' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 40, paddingHorizontal: 12, borderTopWidth: 1, borderTopColor: colors.border },
  san: { width: 56, color: colors.text, fontSize: 14, fontWeight: '700' },
  games: { width: 44, color: colors.textDim, fontSize: 12, textAlign: 'right' },
  bar: { flex: 1, height: 18, flexDirection: 'row', borderRadius: 4, overflow: 'hidden' },
  barWhite: { backgroundColor: '#F1F5F9', justifyContent: 'center', alignItems: 'center' },
  barDraw: { backgroundColor: '#64748B', justifyContent: 'center', alignItems: 'center' },
  barBlack: { backgroundColor: '#1E293B', justifyContent: 'center', alignItems: 'center' },
  barTextDark: { color: '#0F172A', fontSize: 10, fontWeight: '700' },
  barTextLight: { color: '#F8FAFC', fontSize: 10, fontWeight: '700' },
  error: { color: colors.dangerText, fontSize: 13, paddingHorizontal: 12, paddingBottom: 12 },
  empty: { color: colors.textDim, fontSize: 13, paddingHorizontal: 12, paddingBottom: 12 }
});
