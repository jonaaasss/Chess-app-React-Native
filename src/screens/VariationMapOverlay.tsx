// Variations (new opening → "Variations (Lichess)"): scans the explorer for
// the plans of the opening (`variationMap.ts`: where your knights, bishops,
// queen and king go) and creates the opening with a Reactions card
// "Variations": one board per ticked plan (6 boards per card; more make
// "Variations 2", …), each the most played line to that plan from the
// opening's start, so you always see how its position is reached. Nothing is
// saved until "Create"; Cancel leaves no opening behind.
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { showOverlay, useOverlayBack, alertDialog } from '../overlay';
import { colors, radius, touchTarget, type } from '../theme';
import type { GameState } from '../chessEngine';
import { DB_LABEL, fetchExplorer, getExplorerDb, type ExplorerDb } from '../lichessExplorer';
import { closestPlan, DEFAULT_PLAN_OPTIONS, planLine, scanPlans, spotDifferences, spotText, type Plan, type PlanPiece, type VarMove, type VariationChoice } from '../variationMap';
import { makeReactionsBoard } from '../importOpening';
import { allowScreenOff, keepScreenOn } from '../keepAwake';
import { addOpening, deleteOpening, saveCard, uid } from '../storage';
import type { BoardMove, Card, OpeningStartPosition } from '../types';

const BOARDS_PER_CARD = 6;
const DEFAULT_TICKED = 6;

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
  const [plans, setPlans] = useState<Plan[] | null>(null);
  const [pieces, setPieces] = useState<PlanPiece[]>([]);
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
    setPlans(null);
    try {
      const d = await getExplorerDb();
      setDb(d);
      const r = await scanPlans(startState, yourColor, start.setupMoves, (f) => fetchExplorer(f, d), over, DEFAULT_PLAN_OPTIONS, setStatus, () => cancelled.current);
      if (cancelled.current) return;
      setPlans(r.plans);
      setPieces(r.pieces);
      setChoices(r.choices);
      setSelected(new Set(r.plans.slice(0, DEFAULT_TICKED).map((_, i) => i)));
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
  function formatMoves(moves: VarMove[], from = 0, to = moves.length): string {
    return moves
      .slice(from, to)
      .map((m, k) => {
        const ply = startPly + from + k;
        const n = Math.floor(ply / 2) + 1;
        if (ply % 2 === 0) return `${n}.${m.san}`;
        return k === 0 ? `${n}...${m.san}` : m.san;
      })
      .join(' ');
  }
  const moveName = (moves: VarMove[], i: number) => formatMoves(moves, i, i + 1);
  const pct = (x: number) => Math.max(1, Math.round(x * 100));
  const title = (p: Plan, i: number) => `Plan ${i + 1}${p.name ? `: ${p.name}` : ''}`;
  const piecesText = (p: Plan) => pieces.map((pc) => spotText(pc, p.spots.get(pc.id))).join(', ');
  const alsoText = (p: Plan) => (p.alsoAfter.length ? `Also after ${p.alsoAfter.map((a) => moveName(a.moves, a.at)).join(', ')}` : '');

  function setupHistory(): BoardMove[] {
    return start.setupMoves.map((m) => ({ ...m, piecesAfter: { ...m.piecesAfter }, castlingAfter: { ...m.castlingAfter }, arrowsAfter: [], circlesAfter: [] }));
  }

  function toggle(i: number) {
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(i)) n.delete(i);
      else n.add(i);
      return n;
    });
  }

  async function create() {
    if (!plans) return;
    const picked = plans.map((p, i) => ({ p, i })).filter(({ i }) => selected.has(i));
    if (picked.length === 0) return;
    const opening = await addOpening(repertoireId, name, start.setupMoves.length > 0 ? start : undefined);
    try {
      const boards = picked.map(({ p, i }, k) => {
        const earlier = picked.slice(0, k);
        const base = k === 0 ? null : earlier[closestPlan(pieces, p, earlier.map((e) => e.p))];
        const diff = base ? spotDifferences(pieces, p, base.p, `plan ${base.i + 1}`) : [];
        const text = [
          title(p, i),
          `Your pieces: ${piecesText(p)}`,
          base && diff.length ? `Different from plan ${base.i + 1}: ${diff.join(', ')}` : '',
          alsoText(p) ? `${alsoText(p)}.` : '',
          `About ${pct(p.share)}% of the games. Source: Lichess explorer (${DB_LABEL[db]})`
        ]
          .filter(Boolean)
          .join('\n');
        return makeReactionsBoard(k % BOARDS_PER_CARD, setupHistory(), startState, text, planLine(p.line));
      });
      const cards: Card[] = [];
      for (let c = 0; c * BOARDS_PER_CARD < boards.length; c++) {
        cards.push({
          id: uid(),
          openingId: opening.id,
          order: c,
          name: c === 0 ? 'Variations' : `Variations ${c + 1}`,
          mode: 'reactions',
          boards: boards.slice(c * BOARDS_PER_CARD, (c + 1) * BOARDS_PER_CARD),
          fastRevision: true
        });
      }
      for (const card of cards) await saveCard(card);
      close(opening.id);
    } catch (e) {
      await deleteOpening(opening.id);
      await alertDialog(`Nothing was created: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const count = selected.size;
  const cardCount = Math.ceil(count / BOARDS_PER_CARD);
  const ready = !!plans && !status;
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
          The plans of this opening from the Lichess explorer: a new plan starts where an opponent move sends one of your pieces (knights, bishops, queen, castling) to another square. Each ticked plan becomes a board with the most played line from the start of the opening.
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
              <Text style={styles.sectionTitle}>{`Plans, most played first (${count} ticked)`}</Text>
              {plans!.length === 0 && <Text style={styles.status}>The explorer has too few games from this position.</Text>}
              {plans!.map((p, i) => {
                const on = selected.has(i);
                const b = i === 0 ? -1 : closestPlan(pieces, p, plans!.slice(0, i));
                const diff = b < 0 ? [] : spotDifferences(pieces, p, plans![b], `plan ${b + 1}`);
                return (
                  <Pressable key={i} onPress={() => toggle(i)} style={styles.row} accessibilityRole="checkbox" accessibilityState={{ checked: on }}>
                    <View style={[styles.box, on && styles.boxOn]}>{on && <Text style={styles.check}>✓</Text>}</View>
                    <View style={styles.rowBody}>
                      <Text style={styles.rowTitle}>{`${title(p, i)} · ${pct(p.share)}%`}</Text>
                      <Text style={styles.rowPieces}>{piecesText(p)}</Text>
                      {diff.length > 0 && <Text style={styles.rowInfo}>{`Different from plan ${b + 1}: ${diff.join(', ')}`}</Text>}
                      <Text style={styles.rowLine}>{formatMoves(p.line)}</Text>
                      {!!alsoText(p) && <Text style={styles.rowInfo}>{alsoText(p)}</Text>}
                    </View>
                  </Pressable>
                );
              })}
            </View>
          </>
        )}
      </ScrollView>
      <View style={styles.bottom}>
        <Pressable onPress={create} disabled={!ready || count === 0} style={[styles.createBtn, (!ready || count === 0) && styles.disabled]}>
          <Text style={styles.createText}>{`Create ${count} board${count === 1 ? '' : 's'}${cardCount > 1 ? ` on ${cardCount} cards` : ''}`}</Text>
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
  rowPieces: { color: colors.text, fontSize: 13, lineHeight: 19 },
  rowInfo: { color: colors.textDim, fontSize: 13, lineHeight: 18 },
  rowLine: { color: colors.textSecondary, fontSize: 13, lineHeight: 19 },
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
