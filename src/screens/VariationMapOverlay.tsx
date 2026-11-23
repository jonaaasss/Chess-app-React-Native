// Variations: scans the explorer for the plans of an opening
// (`variationMap.ts`: where your knights, bishops, queen and king go). Each
// ticked plan becomes a Plan board (no arrows: Generate plan draws them) on
// the plan's position — after the opponent move that starts it and the moves
// everyone plays after it — with every move from the start kept on the
// board, so it is clear where the position comes from.
// - New opening → "Variations (Lichess)" (`openVariationMap`): creates the
//   opening with one Plan card "Variations". Nothing is saved until "Create";
//   Cancel leaves no opening behind.
// - Card editor → "Add variations (Lichess)" (`openAddVariations`): returns
//   the new boards for that card; plans already on one of its boards are
//   shown as such and can't be ticked again.
// A card holds at most MAX_BOARDS (8, chess.ts) boards.
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { showOverlay, useOverlayBack, alertDialog } from '../overlay';
import { colors, radius, touchTarget, type } from '../theme';
import { MAX_BOARDS, toFen } from '../chess';
import type { GameState } from '../chessEngine';
import { DB_LABEL, fetchExplorer, getExplorerDb, type ExplorerDb } from '../lichessExplorer';
import { closestPlan, DEFAULT_PLAN_OPTIONS, scanPlans, spotDifferences, spotText, type Plan, type PlanPiece, type VarMove, type VariationChoice } from '../variationMap';
import { makePlanBoard } from '../importOpening';
import { allowScreenOff, keepScreenOn } from '../keepAwake';
import { addOpening, deleteOpening, saveCard, uid } from '../storage';
import { shareText } from '../boardShare';
import type { BoardMove, OpeningStartPosition, ReactionBoard } from '../types';

// "Variations from": a plan must come up in at least this share of the games.
const MIN_PLANS = [0.05, 0.03, 0.02, 0.01];

type Mode = { kind: 'create'; repertoireId: string; name: string } | { kind: 'add'; existing: ReactionBoard[] };

const posKey = (st: { pieces: GameState['pieces']; turn: 'w' | 'b'; castling: GameState['castling']; enPassant: string | null }) =>
  toFen(st.pieces, st.turn, st.castling, st.enPassant);

function VariationMapOverlay({
  mode,
  start,
  yourColor,
  close
}: {
  mode: Mode;
  start: OpeningStartPosition;
  yourColor: 'w' | 'b';
  close: (result: string | ReactionBoard[] | null) => void;
}) {
  const [plans, setPlans] = useState<Plan[] | null>(null);
  const [pieces, setPieces] = useState<PlanPiece[]>([]);
  const [choices, setChoices] = useState<VariationChoice[]>([]);
  const [status, setStatus] = useState<string | null>('Starting…');
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [overrides, setOverrides] = useState<Map<string, string>>(new Map());
  const [minPlan, setMinPlan] = useState(MIN_PLANS[0]);
  const [db, setDb] = useState<ExplorerDb>('lichess');
  const cancelled = useRef(false);
  const startState: GameState = { pieces: start.pieces, turn: start.turn, castling: start.castling, enPassant: start.enPassant };
  const startPly = start.setupMoves.length;
  const existing = mode.kind === 'add' ? mode.existing : [];
  const maxNew = MAX_BOARDS - existing.length;

  useEffect(() => {
    if (status) keepScreenOn();
    else allowScreenOff();
  }, [status]);
  useEffect(() => () => allowScreenOff(), []);

  useOverlayBack(() => {
    cancelled.current = true;
    close(null);
  });

  // The position a plan's board shows.
  const planState = (p: Plan): GameState => (p.end > 0 ? p.line[p.end - 1].after : startState);
  // How often that position comes up: the opponent's choices on the way.
  const posShare = (p: Plan) => p.line.slice(0, p.end).reduce((s, m) => (m.mine ? s : s * m.share), 1);
  // Board numbers (1-based) of the card's boards, by position.
  const onBoard = new Map<string, number>();
  [...existing]
    .sort((a, b) => a.order - b.order)
    .forEach((b, i) => {
      // Plan boards keep their position on `back`.
      const key = posKey(b.back);
      if (!onBoard.has(key)) onBoard.set(key, i + 1);
    });
  const alreadyOn = (p: Plan) => onBoard.get(posKey(planState(p)));

  async function scan(over: Map<string, string>, min: number) {
    setStatus('Starting…');
    setPlans(null);
    try {
      const d = await getExplorerDb();
      setDb(d);
      const opts = { ...DEFAULT_PLAN_OPTIONS, minPlan: min, minWeight: Math.min(DEFAULT_PLAN_OPTIONS.minWeight, min), maxRequests: min < 0.03 ? 800 : DEFAULT_PLAN_OPTIONS.maxRequests };
      const r = await scanPlans(startState, yourColor, start.setupMoves, (f) => fetchExplorer(f, d), over, opts, setStatus, () => cancelled.current);
      if (cancelled.current) return;
      const sorted = [...r.plans].sort((a, b) => posShare(b) - posShare(a));
      setPlans(sorted);
      setPieces(r.pieces);
      setChoices(r.choices);
      const free = sorted.map((p, i) => (alreadyOn(p) ? -1 : i)).filter((i) => i >= 0);
      setSelected(new Set(free.slice(0, maxNew)));
    } catch (e) {
      await alertDialog(e instanceof Error ? e.message : String(e));
      close(null);
      return;
    }
    setStatus(null);
  }

  useEffect(() => {
    void scan(overrides, minPlan);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function choose(c: VariationChoice, san: string) {
    const next = new Map(overrides);
    next.set(c.fen, san);
    setOverrides(next);
    void scan(next, minPlan);
  }

  function chooseMin(min: number) {
    if (min === minPlan) return;
    setMinPlan(min);
    void scan(overrides, min);
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
  const title = (p: Plan, i: number) => `Plan ${i + 1}${p.name ? `: ${p.name}` : ''}`;
  const piecesText = (p: Plan) => pieces.map((pc) => spotText(pc, p.spots.get(pc.id))).join(', ');
  const alsoText = (p: Plan) => (p.alsoAfter.length ? `Also after ${p.alsoAfter.map((a) => moveName(a.moves, a.at)).join(', ')}` : '');
  const afterText = (p: Plan) => (p.end > 0 ? `After ${formatMoves(p.line, 0, p.end)}` : 'The start position');

  // The moves from the standard start to the plan's position.
  function history(moves: VarMove[]): BoardMove[] {
    return [
      ...start.setupMoves.map((m) => ({ ...m, piecesAfter: { ...m.piecesAfter }, castlingAfter: { ...m.castlingAfter }, arrowsAfter: [], circlesAfter: [] })),
      ...moves.map((m) => ({
        from: m.from,
        to: m.to,
        promotion: m.promotion,
        piecesAfter: { ...m.after.pieces },
        turnAfter: m.after.turn,
        castlingAfter: { ...m.after.castling },
        enPassantAfter: m.after.enPassant,
        arrowsAfter: [],
        circlesAfter: []
      }))
    ];
  }

  function toggle(i: number) {
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(i)) n.delete(i);
      else if (n.size < maxNew) n.add(i);
      return n;
    });
  }

  function makeBoards(picked: { p: Plan; i: number }[], firstOrder: number): ReactionBoard[] {
    return picked.map(({ p, i }, k) => {
      const earlier = picked.slice(0, k);
      const base = k === 0 ? null : earlier[closestPlan(pieces, p, earlier.map((e) => e.p))];
      const diff = base ? spotDifferences(pieces, p, base.p, `plan ${base.i + 1}`) : [];
      const text = [
        title(p, i),
        `${afterText(p)}.`,
        base && diff.length ? `Different from plan ${base.i + 1}: ${diff.join(', ')}` : '',
        alsoText(p) ? `${alsoText(p)}.` : '',
        `About ${shareText(posShare(p))} of the games from the opening's start position. Source: Lichess explorer (${DB_LABEL[db]})`
      ]
        .filter(Boolean)
        .join('\n');
      const moves = p.line.slice(0, p.end);
      return makePlanBoard(firstOrder + k, history(moves), planState(p), text, []);
    });
  }

  async function finish() {
    if (!plans) return;
    const picked = plans.map((p, i) => ({ p, i })).filter(({ i }) => selected.has(i)).slice(0, maxNew);
    if (picked.length === 0) return;
    if (mode.kind === 'add') {
      close(makeBoards(picked, existing.length));
      return;
    }
    const opening = await addOpening(mode.repertoireId, mode.name, start.setupMoves.length > 0 ? start : undefined);
    try {
      await saveCard({ id: uid(), openingId: opening.id, order: 0, name: 'Variations', mode: 'plan', boards: makeBoards(picked, 0), fastRevision: true });
      close(opening.id);
    } catch (e) {
      await deleteOpening(opening.id);
      await alertDialog(`Nothing was created: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const count = selected.size;
  const ready = !!plans && !status;
  const heading = mode.kind === 'add' ? 'Add variations' : `Variations: ${mode.name}`;
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
        <Text style={styles.title} numberOfLines={1}>
          {heading}
        </Text>
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.intro}>
          The plans of this opening from the Lichess explorer: a new plan starts where an opponent move sends one of your pieces (knights, bishops, queen, castling) to another square. Each ticked plan becomes a board on the position where it starts, with all moves from the start of the opening. Draw the arrows with Generate plan.
        </Text>
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Show variations that come up in at least</Text>
          <View style={styles.chips}>
            {MIN_PLANS.map((m) => (
              <Pressable
                key={m}
                onPress={() => chooseMin(m)}
                disabled={!!status}
                style={[styles.chip, minPlan === m && styles.chipOn]}
                accessibilityRole="radio"
                accessibilityState={{ selected: minPlan === m }}
              >
                <Text style={[styles.chipText, minPlan === m && styles.chipTextOn]}>{`${Math.round(m * 100)}% of games`}</Text>
              </Pressable>
            ))}
          </View>
          <Text style={styles.hint}>Lower finds more and smaller variations (the first scan takes longer).</Text>
        </View>
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
              <Text style={styles.sectionTitle}>{`Plans, most played first (${count} of at most ${maxNew} new board${maxNew === 1 ? '' : 's'})`}</Text>
              {plans!.length === 0 && <Text style={styles.status}>The explorer has too few games from this position.</Text>}
              {plans!.map((p, i) => {
                const on = selected.has(i);
                const boardNo = alreadyOn(p);
                const blocked = boardNo !== undefined || (!on && count >= maxNew);
                const b = i === 0 ? -1 : closestPlan(pieces, p, plans!.slice(0, i));
                const diff = b < 0 ? [] : spotDifferences(pieces, p, plans![b], `plan ${b + 1}`);
                return (
                  <Pressable key={i} onPress={() => toggle(i)} disabled={blocked} style={[styles.row, blocked && styles.disabled]} accessibilityRole="checkbox" accessibilityState={{ checked: on, disabled: blocked }}>
                    <View style={[styles.box, on && styles.boxOn]}>{on && <Text style={styles.check}>✓</Text>}</View>
                    <View style={styles.rowBody}>
                      <Text style={styles.rowTitle}>{`${title(p, i)} · ${shareText(posShare(p))} of games`}</Text>
                      {boardNo !== undefined && <Text style={styles.rowInfo}>{`Already on board ${boardNo}`}</Text>}
                      <Text style={styles.rowLine}>{afterText(p)}</Text>
                      <Text style={styles.rowPieces}>{`Your pieces: ${piecesText(p)}`}</Text>
                      {diff.length > 0 && <Text style={styles.rowInfo}>{`Different from plan ${b + 1}: ${diff.join(', ')}`}</Text>}
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
        <Pressable onPress={finish} disabled={!ready || count === 0} style={[styles.createBtn, (!ready || count === 0) && styles.disabled]}>
          <Text style={styles.createText}>
            {mode.kind === 'add' ? `Add ${count} board${count === 1 ? '' : 's'}` : `Create card with ${count} board${count === 1 ? '' : 's'}`}
          </Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

export function openVariationMap(repertoireId: string, name: string, start: OpeningStartPosition, yourColor: 'w' | 'b'): Promise<string | null> {
  return showOverlay<string | ReactionBoard[] | null>(
    (close) => <VariationMapOverlay mode={{ kind: 'create', repertoireId, name }} start={start} yourColor={yourColor} close={close} />,
    { animation: 'none' }
  ) as Promise<string | null>;
}

// From the card editor: the new boards (orders after the existing ones), or null.
export function openAddVariations(existing: ReactionBoard[], start: OpeningStartPosition, yourColor: 'w' | 'b'): Promise<ReactionBoard[] | null> {
  return showOverlay<string | ReactionBoard[] | null>(
    (close) => <VariationMapOverlay mode={{ kind: 'add', existing }} start={start} yourColor={yourColor} close={close} />,
    { animation: 'none' }
  ) as Promise<ReactionBoard[] | null>;
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
  hint: { color: colors.textDim, fontSize: 12.5, marginTop: 2 },
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
  chipOn: { backgroundColor: '#E2E8F0', borderColor: '#E2E8F0' },
  chipText: { color: colors.text, fontSize: 14, fontWeight: '600' },
  chipTextOn: { color: colors.bg, fontWeight: '700' },
  bottom: { padding: 12, borderTopWidth: 1, borderTopColor: colors.border },
  createBtn: { minHeight: touchTarget, borderRadius: radius.pill, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  createText: { color: colors.onPrimary, fontSize: 15, fontWeight: '700' },
  disabled: { opacity: 0.4 }
});
