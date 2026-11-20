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
import { startingPosition, toFen } from '../chess';
import { makeMove, type GameState } from '../chessEngine';
import { fetchExplorer, getExplorerDb, type ExplorerDb } from '../lichessExplorer';
import { DEFAULT_MAP_OPTIONS, forcedEnd, formatLine, groupLine, lineShape, moveLabel, scanOpening, type MapGroup, type MapMove, type MapNode, type MapResult, type MapSplit, type Situation } from '../openingMap';
import { DEFAULT_PLAN_OPTIONS, generatePlan } from '../planGenerator';
import { makePlanBoard, makeReactionsBoard } from '../importOpening';
import { allowScreenOff, keepScreenOn } from '../keepAwake';
import { addOpening, deleteOpening, saveCard, setOpeningSummary, uid } from '../storage';
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

  // The SAN of the opening's own setup moves (from the standard start).
  function setupSans(): string[] {
    let st: GameState = { pieces: startingPosition(), turn: 'w', castling: { wK: true, wQ: true, bK: true, bQ: true }, enPassant: null };
    return start.setupMoves.map((m) => {
      const r = makeMove(st, m.from, m.to, m.promotion);
      st = r.next;
      return r.san;
    });
  }

  // Your moves along the forced part of the line after `node`.
  function forcedOwn(node: MapNode): string[] {
    const end = forcedEnd(node);
    return end.path.slice(node.path.length).filter((m) => (m.ply % 2 === 0) === (startState.turn === yourColor)).map((m) => m.san);
  }

  const sameMove = (a: MapMove, b: MapMove) => a.san === b.san && a.ply === b.ply;

  async function create() {
    if (!result) return;
    const picked = result.situations.filter((s) => selected.has(s.label));
    if (picked.length === 0) return;
    const opening = await addOpening(repertoireId, name, start.setupMoves.length > 0 ? start : undefined);
    try {
      const cards: Card[] = [];
      const first: MapSplit | undefined = result.splits[0];
      const groupOf = (s: Situation) => first?.groups.find((g) => s.decisions[0] && sameMove(g.moves[0].move, s.decisions[0]));
      const linkFor = new Map<MapGroup, string>();

      // A "Specific line" (Reactions) card per group of the first split whose
      // line is forcing (two or more of your moves) or has variations.
      if (first) {
        for (const g of first.groups) {
          if (!picked.some((s) => groupOf(s) === g)) continue;
          const line = groupLine(first, g);
          const shape = lineShape(line, yourColor);
          if (shape.own < 2 && !shape.branches) continue;
          const subs = g.splits.flatMap((sp) => sp.groups.map((sg) => `${moveLabel(sg.moves[0].move, startPly)} (${Math.round(sg.share * 100)}%)`));
          const text = [
            `Forcing line from the Lichess explorer, reached in about ${Math.round(g.share * 100)}% of the games here.`,
            subs.length ? `The opponent chooses between ${subs.join(' and ')}.` : ''
          ]
            .filter(Boolean)
            .join('\n');
          const id = uid();
          cards.push({
            id,
            openingId: opening.id,
            order: 0,
            name: `Specific line: ${moveLabel(g.moves[0].move, startPly)}`,
            mode: 'reactions',
            boards: [makeReactionsBoard(0, history(first.at.path), first.at.state, text, line)],
            fastRevision: true
          });
          linkFor.set(g, id);
        }
      }

      // A "Key" (Plan) card per ticked situation, from where its forced
      // moves end, so your moves on the way are in the Specific line card.
      let k = 0;
      for (const s of picked) {
        k += 1;
        const from = forcedEnd(s.node);
        const plan = await generatePlan(from.state, yourColor, (f) => fetchExplorer(f, db), { ...DEFAULT_PLAN_OPTIONS, depth: 4 }, (t) => setStatus(`Plan ${k} of ${picked.length}: ${t}`));
        const text = [
          `Plan from the Lichess explorer after ${formatLine(from.path, startPly) || 'the start position'} (about ${Math.round(s.share * 100)}% of the games).`,
          plan.problem ? `No plan could be made here: ${plan.problem}` : ''
        ]
          .filter(Boolean)
          .join('\n');
        const id = uid();
        cards.push({
          id,
          openingId: opening.id,
          order: 0,
          name: `Key: ${shortName(s)}`,
          mode: 'plan',
          boards: [makePlanBoard(0, history(from.path), from.state, text, plan.arrows)],
          fastRevision: true
        });
        const g = groupOf(s);
        if (g && !linkFor.has(g)) linkFor.set(g, id);
      }

      // Summary at the first split: per group the opponent's move (dark) and
      // your answer in the light tint of the same colour, linked to its card.
      if (first) {
        const arrows: Arrow[] = [];
        const lines: string[] = [];
        first.groups.forEach((g, i) => {
          const c = COLORS[i % COLORS.length];
          const opp = g.moves[0].move;
          const link = linkFor.get(g);
          arrows.push({ from: opp.from, to: opp.to, color: DARK[c], ...(link ? { notes: { linkCardId: link } } : {}) });
          const reply = g.main.mine ? g.main.children[0]?.move : undefined;
          if (reply) arrows.push({ from: reply.from, to: reply.to, color: c });
          lines.push(`${moveLabel(opp, startPly)} (${Math.round(g.share * 100)}%)${reply ? ` => ${reply.san}` : ''}`);
        });
        cards.unshift({
          id: uid(),
          openingId: opening.id,
          order: 0,
          name: 'Summary',
          mode: 'summary',
          boards: [makePlanBoard(0, history(first.at.path), first.at.state, lines.join('\n'), arrows)],
          fastRevision: true
        });
      }

      // The opening summary tables, in the usual format.
      const opp = (ply: number) => (ply % 2 === 0 ? 'w' : 'b') !== yourColor;
      const allStart = [...setupSans(), ...(first ? first.at.path.map((m) => m.san) : [])];
      const startCell = allStart.map((san, i) => `${i % 2 === 0 ? `${i / 2 + 1}. ` : ''}${opp(i) ? '!' : ''}${san}`).join(' ');
      const tables = [`# Start | Moves\nOpening | ${startCell}`];
      if (first) {
        const rows = first.groups.map((g) => {
          const m = g.moves[0].move;
          const ply = startPly + m.ply;
          const num = `${Math.floor(ply / 2) + 1}.${ply % 2 === 0 ? '' : '..'}`;
          const own = forcedOwn(g.main).join(' ');
          const except = g.splits
            .flatMap((sp) => sp.groups.map((sg) => `?${forcedOwn(sg.main).join(' ') || '…'} after !${sg.moves[0].move.san}`))
            .join('\\n');
          return `${num} !${m.san} | ${own} | ${except}`;
        });
        tables.push(`# Reply | Moves | Except\n${rows.join('\n')}`);
      }
      await setOpeningSummary(opening.id, tables.join('\n\n'));

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
