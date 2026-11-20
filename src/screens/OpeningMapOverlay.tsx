// Opening map (new opening → "Opening map (Lichess)"): scans the explorer
// from the opening's start position, shows the splits where the opponent's
// choice changes your plan, lets you pick your own move where several are
// popular, and creates the opening with one Plan card per situation (arrows
// from Generate plan) plus a Summary linking to them. Nothing is saved until
// "Create"; Cancel leaves no opening behind.
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { showOverlay, useOverlayBack, alertDialog } from '../overlay';
import { colors, radius, touchTarget, type } from '../theme';
import { toFen } from '../chess';
import { makeMove, type GameState } from '../chessEngine';
import { fetchExplorer, getExplorerDb, type ExplorerDb } from '../lichessExplorer';
import { DEFAULT_MAP_OPTIONS, moveLabel, scanOpening, type MapMove, type MapNode, type MapResult, type MapSplit, type Situation } from '../openingMap';
import { DEFAULT_PLAN_OPTIONS, generatePlan } from '../planGenerator';
import { makePlanBoard } from '../importOpening';
import { addOpening, deleteOpening, saveCard, uid } from '../storage';
import type { Arrow, ArrowColor, BoardMove, Card, OpeningStartPosition } from '../types';

const COLORS: ArrowColor[] = ['green', 'orange', 'red', 'blue'];
const DARK: Record<string, ArrowColor> = { green: 'darkGreen', orange: 'darkOrange', red: 'darkRed', blue: 'darkBlue' };

function OpeningMapOverlay({
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
  const [result, setResult] = useState<MapResult | null>(null);
  const [status, setStatus] = useState<string | null>('Starting…');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [overrides, setOverrides] = useState<Map<string, string>>(new Map());
  const [db, setDb] = useState<ExplorerDb>('lichess');
  const cancelled = useRef(false);
  const startState: GameState = { pieces: start.pieces, turn: start.turn, castling: start.castling, enPassant: start.enPassant };
  const startPly = start.setupMoves.length;

  useOverlayBack(() => {
    cancelled.current = true;
    close(null);
  });

  async function scan(over: Map<string, string>) {
    setStatus('Starting…');
    try {
      const d = await getExplorerDb();
      setDb(d);
      const r = await scanOpening(startState, yourColor, (f) => fetchExplorer(f, d), over, DEFAULT_MAP_OPTIONS, setStatus, () => cancelled.current);
      if (cancelled.current) return;
      setResult(r);
      setSelected(new Set(r.situations.map((s) => s.label)));
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

  function choose(node: MapNode, san: string) {
    const next = new Map(overrides);
    next.set(toFen(node.state.pieces, node.state.turn, node.state.castling, node.state.enPassant), san);
    setOverrides(next);
    setResult(null);
    void scan(next);
  }

  // Your own moves where something else is popular too (at least 15% of all games reach it).
  const choices: MapNode[] = [];
  const collectChoices = (n: MapNode) => {
    if (n.mine && n.alternatives.length > 0 && n.weight >= 0.15) choices.push(n);
    n.children.forEach((c) => collectChoices(c.node));
  };
  if (result) collectChoices(result.root);

  const label = (path: MapMove[]) => path.map((m) => moveLabel(m, startPly)).join(' ');
  const shortName = (s: Situation) => (s.decisions.length ? s.decisions.map((m) => moveLabel(m, startPly)).join(' ') : 'Main plan');

  function history(path: MapMove[]): BoardMove[] {
    let st = startState;
    const out: BoardMove[] = start.setupMoves.map((m) => ({ ...m, piecesAfter: { ...m.piecesAfter }, castlingAfter: { ...m.castlingAfter }, arrowsAfter: [], circlesAfter: [] }));
    for (const m of path) {
      const r = makeMove(st, m.from, m.to, m.promotion);
      st = r.next;
      out.push({ from: m.from, to: m.to, promotion: m.promotion, piecesAfter: st.pieces, turnAfter: st.turn, castlingAfter: st.castling, enPassantAfter: st.enPassant, arrowsAfter: [], circlesAfter: [] });
    }
    return out;
  }

  async function create() {
    if (!result) return;
    const picked = result.situations.filter((s) => selected.has(s.label));
    if (picked.length === 0) return;
    const opening = await addOpening(repertoireId, name, start.setupMoves.length > 0 ? start : undefined);
    try {
      const cards: Card[] = [];
      let k = 0;
      for (const s of picked) {
        k += 1;
        const plan = await generatePlan(s.node.state, yourColor, (f) => fetchExplorer(f, db), { ...DEFAULT_PLAN_OPTIONS, depth: 4 }, (t) => setStatus(`Plan ${k} of ${picked.length}: ${t}`));
        const text = [
          `From the Lichess explorer: ${label(s.node.path) || 'the start position'}.`,
          `Reached in about ${Math.round(s.share * 100)}% of the games.`,
          plan.problem ? `No plan could be made: ${plan.problem}` : ''
        ]
          .filter(Boolean)
          .join('\n');
        cards.push({
          id: uid(),
          openingId: opening.id,
          order: 0,
          name: `Key: ${shortName(s)}`,
          mode: 'plan',
          boards: [makePlanBoard(0, history(s.node.path), s.node.state, text, plan.arrows)],
          fastRevision: true
        });
      }
      // Summary: the moves up to the first split, and each group of the
      // first split as a dark arrow of its own colour, linked to its card.
      const first: MapSplit | undefined = result.splits[0];
      if (first) {
        const arrows: Arrow[] = first.at.path.map((m) => {
          const own = m.ply % 2 === (startState.turn === yourColor ? 0 : 1);
          return { from: m.from, to: m.to, color: own ? 'green' : 'darkGreen' };
        });
        first.groups.forEach((g, i) => {
          const target = cards.find((c, ci) => picked[ci].decisions[0] && picked[ci].decisions[0].san === g.moves[0].move.san && picked[ci].decisions[0].ply === g.moves[0].move.ply);
          g.moves.forEach((gm, j) => {
            arrows.push({
              from: gm.move.from,
              to: gm.move.to,
              color: DARK[COLORS[i % COLORS.length]],
              ...(target && j === 0 ? { notes: { linkCardId: target.id } } : {})
            });
          });
        });
        const summaryText = first.groups.map((g) => `${g.moves.map((m) => moveLabel(m.move, startPly)).join(' / ')}: ${Math.round(g.share * 100)}%`).join('\n');
        cards.unshift({
          id: uid(),
          openingId: opening.id,
          order: 0,
          name: 'Summary',
          mode: 'summary',
          boards: [makePlanBoard(0, history([]), startState, summaryText, arrows)],
          fastRevision: true
        });
      }
      for (let i = 0; i < cards.length; i++) await saveCard({ ...cards[i], order: i });
      close(opening.id);
    } catch (e) {
      await deleteOpening(opening.id);
      await alertDialog(`Nothing was created: ${e instanceof Error ? e.message : String(e)}`);
      setStatus(null);
    }
  }

  function renderSplits(list: MapSplit[], depth: number): React.ReactNode {
    return list.map((sp, i) => (
      <View key={`${depth}-${i}`} style={{ marginLeft: depth * 14 }}>
        <Text style={styles.after}>{sp.at.path.length ? `After ${label(sp.at.path)}` : 'From the start'}</Text>
        {sp.groups.map((g, gi) => {
          const name = g.moves.map((m) => `${moveLabel(m.move, startPly)} ${Math.round(m.share * 100)}%`).join(' / ');
          if (g.splits.length > 0) {
            return (
              <View key={gi}>
                <Text style={[styles.group, { marginLeft: 8 }]}>{name}</Text>
                {renderSplits(g.splits, depth + 1)}
              </View>
            );
          }
          const s = result!.situations.find((x) => x.node === g.main);
          const on = s ? selected.has(s.label) : false;
          return (
            <Pressable
              key={gi}
              onPress={() =>
                s &&
                setSelected((prev) => {
                  const n = new Set(prev);
                  if (n.has(s.label)) n.delete(s.label);
                  else n.add(s.label);
                  return n;
                })
              }
              style={styles.leaf}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: on }}
            >
              <View style={[styles.box, on && styles.boxOn]}>{on && <Text style={styles.check}>✓</Text>}</View>
              <Text style={styles.leafText}>{name}</Text>
            </Pressable>
          );
        })}
      </View>
    ));
  }

  const count = result ? result.situations.filter((s) => selected.has(s.label)).length : 0;
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
        <Text style={styles.title} numberOfLines={1}>{`Opening map: ${name}`}</Text>
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.intro}>
          The splits where the opponent's choice changes your plan (Lichess explorer). Each ticked line becomes a Plan card with its arrows drawn; a Summary links to them.
        </Text>
        {status && (
          <View style={styles.statusRow}>
            <ActivityIndicator size="small" color={colors.textDim} />
            <Text style={styles.status}>{status}</Text>
          </View>
        )}
        {result && !status && (
          <>
            {choices.length > 0 && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Your moves</Text>
                {choices.map((n) => {
                  const mine = n.children[0]?.move;
                  return (
                    <View key={label(n.path)} style={styles.choice}>
                      <Text style={styles.choiceText}>{`${n.path.length ? `After ${label(n.path)}` : 'At the start'} you play ${mine ? moveLabel(mine, startPly) : '?'}. Also played:`}</Text>
                      <View style={styles.chips}>
                        {n.alternatives.map((a) => (
                          <Pressable key={a.san} onPress={() => choose(n, a.san)} style={styles.chip}>
                            <Text style={styles.chipText}>{`${a.san} ${Math.round(a.share * 100)}%`}</Text>
                          </Pressable>
                        ))}
                      </View>
                    </View>
                  );
                })}
              </View>
            )}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Splits</Text>
              {result.splits.length === 0 ? <Text style={styles.status}>No split changes your plan: one Plan card from the start.</Text> : renderSplits(result.splits, 0)}
            </View>
          </>
        )}
      </ScrollView>
      <View style={styles.bottom}>
        <Pressable onPress={create} disabled={!result || !!status || count === 0} style={[styles.createBtn, (!result || !!status || count === 0) && styles.disabled]}>
          <Text style={styles.createText}>{`Create ${count} card${count === 1 ? '' : 's'}${result?.splits.length ? ' + Summary' : ''}`}</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

export function openOpeningMap(repertoireId: string, name: string, start: OpeningStartPosition, yourColor: 'w' | 'b'): Promise<string | null> {
  return showOverlay<string | null>((close) => <OpeningMapOverlay repertoireId={repertoireId} name={name} start={start} yourColor={yourColor} close={close} />, {
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
  status: { color: colors.textDim, fontSize: 14 },
  section: { backgroundColor: colors.panel2, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: 12, gap: 6 },
  sectionTitle: { color: colors.text, fontSize: 15, fontWeight: '700', marginBottom: 4 },
  after: { color: colors.textDim, fontSize: 13, marginTop: 6 },
  group: { color: colors.text, fontSize: 14, fontWeight: '600', marginTop: 4 },
  leaf: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: touchTarget, marginLeft: 8 },
  box: { width: 24, height: 24, borderRadius: 6, borderWidth: 2, borderColor: colors.textDim, alignItems: 'center', justifyContent: 'center' },
  boxOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  check: { color: colors.onPrimary, fontSize: 14, fontWeight: '800' },
  leafText: { flex: 1, color: colors.text, fontSize: 14, fontWeight: '600' },
  choice: { gap: 6, marginBottom: 6 },
  choiceText: { color: colors.text, fontSize: 14 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { minHeight: touchTarget - 8, paddingHorizontal: 14, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, justifyContent: 'center' },
  chipText: { color: colors.text, fontSize: 14, fontWeight: '600' },
  bottom: { padding: 12, borderTopWidth: 1, borderTopColor: colors.border },
  createBtn: { minHeight: touchTarget, borderRadius: radius.pill, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  createText: { color: colors.onPrimary, fontSize: 15, fontWeight: '700' },
  disabled: { opacity: 0.4 }
});
