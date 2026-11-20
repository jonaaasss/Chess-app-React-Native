// Variations (new opening → "Variations (Lichess)"): scans the explorer for
// the opening's main variations (`variationMap.ts`) and creates the opening
// with one Reactions card "Variations": one board per ticked variation (at
// most 6), each the complete line from the opening's start, so you always
// see how its position is reached. Nothing is saved until "Create"; Cancel
// leaves no opening behind.
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { showOverlay, useOverlayBack, alertDialog } from '../overlay';
import { colors, radius, touchTarget, type } from '../theme';
import type { GameState } from '../chessEngine';
import { DB_LABEL, fetchExplorer, getExplorerDb, type ExplorerDb } from '../lichessExplorer';
import { closest, DEFAULT_VARIATION_OPTIONS, scanVariations, variationLine, type VarMove, type Variation, type VariationChoice } from '../variationMap';
import { makeReactionsBoard } from '../importOpening';
import { allowScreenOff, keepScreenOn } from '../keepAwake';
import { addOpening, deleteOpening, saveCard, uid } from '../storage';
import type { BoardMove, OpeningStartPosition } from '../types';

const MAX_BOARDS = 6;

function VariationMapOverlay({
  repertoireId,
  name,
  start,
  yourColor,
  close
}: {
  repertoireId: string;
  name: string;
  start: OpeningStartPosition;
  yourColor: 'w' | 'b';
  close: (openingId: string | null) => void;
}) {
  const [variations, setVariations] = useState<Variation[] | null>(null);
  const [choices, setChoices] = useState<VariationChoice[]>([]);
  const [status, setStatus] = useState<string | null>('Starting…');
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [overrides, setOverrides] = useState<Map<string, string>>(new Map());
  const [db, setDb] = useState<ExplorerDb>('lichess');
  const cancelled = useRef(false);
  const startState: GameState = { pieces: start.pieces, turn: start.turn, castling: start.castling, enPassant: start.enPassant };
  const startPly = start.setupMoves.length;

  useEffect(() => {
    if (status) keepScreenOn();
    else allowScreenOff();
  }, [status]);
  useEffect(() => () => allowScreenOff(), []);

  useOverlayBack(() => {
    cancelled.current = true;
    close(null);
  });

  async function scan(over: Map<string, string>) {
    setStatus('Starting…');
    setVariations(null);
    try {
      const d = await getExplorerDb();
      setDb(d);
      const r = await scanVariations(startState, yourColor, (f) => fetchExplorer(f, d), over, DEFAULT_VARIATION_OPTIONS, setStatus, () => cancelled.current);
      if (cancelled.current) return;
      setVariations(r.variations);
      setChoices(r.choices);
      // Ticked: the first 6 that are not just another move order.
      setSelected(new Set(r.variations.map((v, i) => (v.transposes ? -1 : i)).filter((i) => i >= 0).slice(0, MAX_BOARDS)));
    } catch (e) {
      await alertDialog(e instanceof Error ? e.message : String(e));
      close(null);
      return;
    }
    setStatus(null);
  }

  useEffect(() => {
    void scan(overrides);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function choose(c: VariationChoice, san: string) {
    const next = new Map(overrides);
    next.set(c.fen, san);
    setOverrides(next);
    void scan(next);
  }

  // "5.Nxc6 bxc6 6.e5" (or "5...Nf6 6.Nc3" when the line starts with Black),
  // counted from `from` moves into the line.
  function formatMoves(moves: VarMove[], from = 0): string {
    return moves
      .slice(from)
      .map((m, k) => {
        const ply = startPly + from + k;
        const n = Math.floor(ply / 2) + 1;
        if (ply % 2 === 0) return `${n}.${m.san}`;
        return k === 0 ? `${n}...${m.san}` : m.san;
      })
      .join(' ');
  }
  const moveName = (moves: VarMove[], i: number) => formatMoves(moves, i).split(' ')[0];
  const pct = (x: number) => Math.max(1, Math.round(x * 100));
  const title = (v: Variation, i: number) => `${i + 1}. ${v.name ?? (v.main ? 'Main line' : 'Variation')}`;
  // Where `v` leaves the closest of the lines above it ("Differs from 2 at
  // 10.h3 (there 10.Bg5), 9% of the games"), or null for the first line.
  function differsText(v: Variation, above: Variation[], word: string): { text: string; at: number } | null {
    if (above.length === 0) return null;
    const t = v.transposes;
    if (t) {
      const j = above.indexOf(variations![t.line]);
      if (j >= 0) return { text: `Another move order of ${word} ${j + 1}: the same position from ${moveName(v.moves, t.from)} on`, at: -1 };
    }
    const c = closest(v, above);
    const other = above[c.parent];
    if (c.differs >= v.moves.length) return null;
    const there = other.moves[c.differs] ? ` (there ${moveName(other.moves, c.differs)})` : '';
    const share = v.weights[c.differs] ?? 0;
    return { text: `Differs from ${word} ${c.parent + 1} at ${moveName(v.moves, c.differs)}${there}, ${pct(share)}% of the games`, at: c.differs };
  }

  function setupHistory(): BoardMove[] {
    return start.setupMoves.map((m) => ({ ...m, piecesAfter: { ...m.piecesAfter }, castlingAfter: { ...m.castlingAfter }, arrowsAfter: [], circlesAfter: [] }));
  }

  function toggle(i: number) {
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(i)) n.delete(i);
      else if (n.size < MAX_BOARDS) n.add(i);
      return n;
    });
  }

  async function create() {
    if (!variations) return;
    const picked = variations.filter((_, i) => selected.has(i));
    if (picked.length === 0) return;
    const opening = await addOpening(repertoireId, name, start.setupMoves.length > 0 ? start : undefined);
    try {
      const boards = picked.map((v, k) => {
        const diff = differsText(v, picked.slice(0, k), 'board');
        const text = [
          v.name ?? (v.main ? 'Main line' : `Variation ${k + 1}`),
          v.main ? 'The main line: the most played move at every choice.' : '',
          diff ? `${diff.text}.` : '',
          `Source: Lichess explorer (${DB_LABEL[db]})`
        ]
          .filter(Boolean)
          .join('\n');
        return makeReactionsBoard(k, setupHistory(), startState, text, variationLine(v));
      });
      await saveCard({ id: uid(), openingId: opening.id, order: 0, name: 'Variations', mode: 'reactions', boards, fastRevision: true });
      close(opening.id);
    } catch (e) {
      await deleteOpening(opening.id);
      await alertDialog(`Nothing was created: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const count = selected.size;
  const ready = !!variations && !status;
  return (
    <SafeAreaView style={styles.overlay}>
      <View style={styles.header}>
        <Pressable
          onPress={() => {
            cancelled.current = true;
            close(null);
          }}
          style={styles.headerBtn}
        >
          <Text style={styles.cancel}>Cancel</Text>
        </Pressable>
        <Text style={styles.title} numberOfLines={1}>{`Variations: ${name}`}</Text>
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.intro}>
          The main variations from the Lichess explorer. Each ticked one becomes a board of one card, with the whole line from the start of the opening.
        </Text>
        {status && (
          <View style={styles.statusRow}>
            <ActivityIndicator size="small" color={colors.textDim} />
            <Text style={styles.status}>{status}</Text>
          </View>
        )}
        {ready && (
          <>
            {choices.length > 0 && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Your moves</Text>
                {choices.map((c) => (
                  <View key={c.fen} style={styles.choice}>
                    <Text style={styles.choiceText}>{`${c.path.length ? `After ${formatMoves(c.path)}` : 'At the start'} you play ${c.played}. Also played:`}</Text>
                    <View style={styles.chips}>
                      {c.alternatives.map((a) => (
                        <Pressable key={a.san} onPress={() => choose(c, a.san)} style={styles.chip}>
                          <Text style={styles.chipText}>{`${a.san} ${Math.round(a.share * 100)}%`}</Text>
                        </Pressable>
                      ))}
                    </View>
                  </View>
                ))}
              </View>
            )}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>{`Variations (${count} of at most ${MAX_BOARDS} boards)`}</Text>
              {variations!.length === 0 && <Text style={styles.status}>The explorer has too few games from this position.</Text>}
              {variations!.map((v, i) => {
                const on = selected.has(i);
                const full = !on && count >= MAX_BOARDS;
                const diff = differsText(v, variations!.slice(0, i), 'line');
                const d = diff?.at ?? -1;
                return (
                  <Pressable
                    key={i}
                    onPress={() => toggle(i)}
                    disabled={full}
                    style={[styles.row, full && styles.disabled]}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: on, disabled: full }}
                  >
                    <View style={[styles.box, on && styles.boxOn]}>{on && <Text style={styles.check}>✓</Text>}</View>
                    <View style={styles.rowBody}>
                      <Text style={styles.rowTitle}>{title(v, i)}</Text>
                      <Text style={styles.rowInfo}>{v.main ? 'The most played move at every choice' : diff?.text ?? ''}</Text>
                      <Text style={styles.rowLine}>
                        {d > 0 ? (
                          <>
                            <Text style={styles.rowSame}>{`${formatMoves(v.moves.slice(0, d))} `}</Text>
                            {formatMoves(v.moves, d)}
                          </>
                        ) : (
                          formatMoves(v.moves)
                        )}
                      </Text>
                    </View>
                  </Pressable>
                );
              })}
              {variations!.length > 1 && <Text style={styles.hint}>Grey moves are the same as in the line it differs from.</Text>}
            </View>
          </>
        )}
      </ScrollView>
      <View style={styles.bottom}>
        <Pressable onPress={create} disabled={!ready || count === 0} style={[styles.createBtn, (!ready || count === 0) && styles.disabled]}>
          <Text style={styles.createText}>{`Create card with ${count} board${count === 1 ? '' : 's'}`}</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

export function openVariationMap(repertoireId: string, name: string, start: OpeningStartPosition, yourColor: 'w' | 'b'): Promise<string | null> {
  return showOverlay<string | null>((close) => <VariationMapOverlay repertoireId={repertoireId} name={name} start={start} yourColor={yourColor} close={close} />, {
    animation: 'none'
  });
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: colors.border },
  headerBtn: { minHeight: touchTarget, justifyContent: 'center', paddingHorizontal: 8 },
  cancel: { color: colors.textDim, fontSize: 16 },
  title: { flex: 1, color: colors.text, ...type.h2 },
  content: { padding: 16, gap: 14 },
  intro: { color: colors.textSecondary, fontSize: 14, lineHeight: 20 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  status: { flex: 1, color: colors.textDim, fontSize: 14 },
  section: { backgroundColor: colors.panel2, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: 12, gap: 6 },
  sectionTitle: { color: colors.text, fontSize: 15, fontWeight: '700', marginBottom: 4 },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, minHeight: touchTarget, paddingVertical: 8 },
  box: { width: 24, height: 24, marginTop: 2, borderRadius: 6, borderWidth: 2, borderColor: colors.textDim, alignItems: 'center', justifyContent: 'center' },
  boxOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  check: { color: colors.onPrimary, fontSize: 14, fontWeight: '800' },
  rowBody: { flex: 1, gap: 2 },
  rowTitle: { color: colors.text, fontSize: 14, fontWeight: '600' },
  rowInfo: { color: colors.textDim, fontSize: 13 },
  rowLine: { color: colors.text, fontSize: 13, lineHeight: 19 },
  rowSame: { color: colors.textDim },
  hint: { color: colors.textDim, fontSize: 12.5, marginTop: 4 },
  choice: { gap: 6, marginBottom: 6 },
  choiceText: { color: colors.text, fontSize: 14, lineHeight: 20 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { minHeight: touchTarget - 8, paddingHorizontal: 14, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, justifyContent: 'center' },
  chipText: { color: colors.text, fontSize: 14, fontWeight: '600' },
  bottom: { padding: 12, borderTopWidth: 1, borderTopColor: colors.border },
  createBtn: { minHeight: touchTarget, borderRadius: radius.pill, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  createText: { color: colors.onPrimary, fontSize: 15, fontWeight: '700' },
  disabled: { opacity: 0.4 }
});
