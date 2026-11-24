// Variations: scans the explorer for the plans of an opening
// (`variationMap.ts`: where your knights, bishops, queen and king go). Each
// ticked plan becomes a Plan board (no arrows: Generate plan draws them) on
// the plan's position — after the opponent move that starts it and the moves
// everyone plays after it — with every move from the start kept on the
// board, so it is clear where the position comes from.
// - New opening → "Variations (Lichess)" (`openVariationMap`): creates the
//   opening with one Plan card "Variations". Nothing is saved until "Create";
//   Cancel leaves no opening behind.
// - Card editor → "Add variations (Lichess)" (`openAddVariations`): your
//   moves are the ones on the card's boards (no "Your moves" chips), only
//   plans that are not on a board yet are listed, each compared with the
//   board it looks most like; returns the new boards for that card.
// Every plan in the list shows its position on a small board.
// Your moves follow the shared rule (ownMove.ts) with Stockfish as referee,
// so they are the moves Generate plan picks too; the database is the shared
// explorer setting (chips at the top).
// A card holds at most MAX_BOARDS (8, chess.ts) boards.
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { showOverlay, useOverlayBack, alertDialog } from '../overlay';
import { colors, radius, touchTarget, type } from '../theme';
import { MAX_BOARDS, toFen } from '../chess';
import { makeMove, type GameState } from '../chessEngine';
import { ChessBoardView } from '../components/ChessBoard';
import { boardMovesFromStart } from '../boardShare';
import { DB_LABEL, fetchExplorer, getExplorerDb, setExplorerDb, type ExplorerDb } from '../lichessExplorer';
import { closestPlan, DEFAULT_PLAN_OPTIONS, planChanges, positionShare, scanPlans, type Plan, type PlanPiece, type VarMove, type VariationChoice } from '../variationMap';
import { useStockfishEngine } from '../engine/useStockfishEngine';
import { engineEvaluator, type EngineEval } from '../ownMove';
import { makePlanBoard } from '../importOpening';
import { allowScreenOff, keepScreenOn } from '../keepAwake';
import { addOpening, deleteOpening, getBoardStyle, saveCard, uid } from '../storage';
import { shareText } from '../boardShare';
import type { BoardMove, OpeningStartPosition, ReactionBoard } from '../types';

// A plan must come up in at least this share of the games; the list is
// sorted from most to least played.
const MIN_PLAN = 0.02;

type Mode = { kind: 'create'; repertoireId: string; name: string } | { kind: 'add'; existing: ReactionBoard[] };

const PREVIEW = 120;

// Your moves on the card's boards, by position (for the scan's `overrides`):
// at every position on a board where it is your turn, the move you play.
function boardOverrides(boards: ReactionBoard[], start: OpeningStartPosition, yourColor: 'w' | 'b'): Map<string, string> {
  const out = new Map<string, string>();
  for (const b of boards) {
    const moves = boardMovesFromStart(b, 'plan');
    const prefix = start.setupMoves;
    if (moves.length < prefix.length || prefix.some((m, i) => m.from !== moves[i].from || m.to !== moves[i].to)) continue;
    let st: GameState = { pieces: start.pieces, turn: start.turn, castling: start.castling, enPassant: start.enPassant };
    try {
      for (const m of moves.slice(prefix.length)) {
        const r = makeMove(st, m.from, m.to, m.promotion);
        if (st.turn === yourColor) {
          const fen = toFen(st.pieces, st.turn, st.castling, st.enPassant);
          if (!out.has(fen)) out.set(fen, r.san);
        }
        st = r.next;
      }
    } catch {
      // A board that can't be replayed says nothing about your moves.
    }
  }
  return out;
}

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
  const [overrides, setOverrides] = useState<Map<string, string>>(() =>
    mode.kind === 'add' ? boardOverrides(mode.existing, start, yourColor) : new Map()
  );
  const [boardStyle, setBoardStyle] = useState(0);
  const [db, setDb] = useState<ExplorerDb>('lichess');
  const cancelled = useRef(false);
  // Stockfish, as referee between your popular moves (ownMove.ts).
  const engine = useStockfishEngine();
  const engineRef = useRef(engine);
  engineRef.current = engine;
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
  useEffect(() => {
    getBoardStyle().then(setBoardStyle).catch(() => undefined);
  }, []);

  // The position a plan's board shows.
  const planState = (p: Plan): GameState => (p.end > 0 ? p.line[p.end - 1].after : startState);
  // How often that position comes up: the opponent's choices on the way.
  const posShare = positionShare;
  // The card's boards: their number, position and the moves from the
  // opening's start to it (null when the board doesn't start there).
  const boardLines = [...existing]
    .sort((a, b) => a.order - b.order)
    .map((b, i) => {
      const moves = boardMovesFromStart(b, 'plan');
      const pre = start.setupMoves;
      const fromStart = moves.length >= pre.length && pre.every((m, k) => m.from === moves[k].from && m.to === moves[k].to);
      return { no: i + 1, key: posKey(b.back), line: fromStart ? moves.slice(pre.length) : null };
    });
  // Whether one of a plan's lines goes through a board's position.
  const through = (p: Plan, b: (typeof boardLines)[number]) =>
    posKey(planState(p)) === b.key ||
    (b.line !== null && p.lines.some((l) => b.line!.length <= l.length && b.line!.every((m, k) => l[k].from === m.from && l[k].to === m.to)));
  // A board's own plan is the most played plan that goes through its
  // position; another plan through it continues from that board.
  function mapBoards(list: Plan[]): { own: Map<Plan, number>; parent: Map<Plan, number>; ownOf: Map<number, Plan> } {
    const own = new Map<Plan, number>();
    const ownOf = new Map<number, Plan>();
    for (const b of boardLines) {
      const best = list.filter((p) => through(p, b)).sort((x, y) => y.share - x.share)[0];
      if (best && !own.has(best)) {
        own.set(best, b.no);
        ownOf.set(b.no, best);
      }
    }
    const parent = new Map<Plan, number>();
    for (const p of list) {
      if (own.has(p)) continue;
      const deepest = boardLines.filter((b) => ownOf.has(b.no) && through(p, b)).sort((x, y) => (y.line?.length ?? 0) - (x.line?.length ?? 0))[0];
      if (deepest) parent.set(p, deepest.no);
    }
    return { own, parent, ownOf };
  }

  // The referee once Stockfish has started (at most 20 s); without it the
  // database alone decides.
  async function waitForEngine(): Promise<EngineEval | undefined> {
    for (let t = 0; t < 80 && !engineRef.current.ready; t++) {
      if (cancelled.current) return undefined;
      setStatus('Starting Stockfish…');
      await new Promise((r) => setTimeout(r, 250));
    }
    if (!engineRef.current.ready) return undefined;
    return engineEvaluator(
      (f, turn, o) => engineRef.current.analyzeOnce(f, turn, o),
      () => setStatus('Stockfish compares your most played moves…')
    );
  }

  async function scan(over: Map<string, string>, chosenDb?: ExplorerDb) {
    setStatus('Starting…');
    setPlans(null);
    try {
      const d = chosenDb ?? (await getExplorerDb());
      setDb(d);
      const referee = await waitForEngine();
      if (cancelled.current) return;
      const opts = { ...DEFAULT_PLAN_OPTIONS, minPlan: MIN_PLAN, minWeight: Math.min(DEFAULT_PLAN_OPTIONS.minWeight, MIN_PLAN), maxRequests: 800 };
      const r = await scanPlans(startState, yourColor, start.setupMoves, (f) => fetchExplorer(f, d), over, opts, setStatus, () => cancelled.current, referee);
      if (cancelled.current) return;
      const sorted = [...r.plans].sort((a, b) => posShare(b) - posShare(a));
      setPlans(sorted);
      setPieces(r.pieces);
      setChoices(r.choices);
      const own = mapBoards(sorted).own;
      const free = sorted.map((p, i) => (own.has(p) ? -1 : i)).filter((i) => i >= 0);
      setSelected(new Set(free.slice(0, maxNew)));
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

  function chooseDb(d: ExplorerDb) {
    if (d === db || status) return;
    void setExplorerDb(d);
    void scan(overrides, d);
  }

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
  const title = (p: Plan, i: number) => (mode.kind === 'add' ? p.name ?? 'Variation' : `Plan ${i + 1}${p.name ? `: ${p.name}` : ''}`);
  // Add: the plans on the card's boards, with their board numbers.
  const boards = mapBoards(plans ?? []);
  const alreadyOn = (p: Plan) => boards.own.get(p);
  const boardPlans = [...boards.own].map(([p, no]) => ({ p, no }));
  // What a plan has different from another: in Add from the board it
  // continues from (else the most similar board), in Create from the most
  // similar earlier plan.
  const changes = (p: Plan, base: Plan, label: string) => planChanges(pieces, p, base, label, startPly, DEFAULT_PLAN_OPTIONS.planMoves);
  function difference(p: Plan, earlier: { p: Plan; label: string }[]): { label: string; diff: string[]; continues: boolean } | null {
    const parentNo = mode.kind === 'add' ? boards.parent.get(p) : undefined;
    if (parentNo !== undefined) {
      const base = boards.ownOf.get(parentNo)!;
      const label = `board ${parentNo}`;
      return { label, diff: changes(p, base, label), continues: true };
    }
    const pool = mode.kind === 'add' && boardPlans.length ? boardPlans.map((x) => ({ p: x.p, label: `board ${x.no}` })) : earlier;
    if (pool.length === 0) return null;
    const best = pool[closestPlan(pieces, p, pool.map((x) => x.p))];
    return { label: best.label, diff: changes(p, best.p, best.label), continues: false };
  }
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
      const d = difference(p, picked.slice(0, k).map((e) => ({ p: e.p, label: `plan ${e.i + 1}` })));
      const text = [
        title(p, i),
        `${afterText(p)}.`,
        d?.continues ? `Continues from ${d.label}.` : '',
        d && d.diff.length ? `Your plan here, different from ${d.label}:\n${d.diff.join('\n')}` : '',
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
          <Text style={styles.sectionTitle}>Database</Text>
          <View style={styles.chips}>
            {(['lichess', 'masters'] as ExplorerDb[]).map((d) => (
              <Pressable
                key={d}
                onPress={() => chooseDb(d)}
                disabled={!!status}
                style={[styles.chip, db === d && styles.chipOn, !!status && db !== d && styles.disabled]}
                accessibilityRole="radio"
                accessibilityState={{ selected: db === d }}
              >
                <Text style={[styles.chipText, db === d && styles.chipTextOn]}>{DB_LABEL[d]}</Text>
              </Pressable>
            ))}
          </View>
          <Text style={styles.hint}>The same database as the Explorer panel and Generate plan.</Text>
        </View>
        {status && (
          <View style={styles.statusRow}>
            <ActivityIndicator size="small" color={colors.textDim} />
            <Text style={styles.status}>{status}</Text>
          </View>
        )}
        {ready && (
          <>
            {mode.kind === 'create' && choices.length > 0 && (
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
              {mode.kind === 'add' && boardPlans.length > 0 && (
                <Text style={styles.rowInfo}>{`${boardPlans.length} plan${boardPlans.length === 1 ? ' is' : 's are'} already on your boards.`}</Text>
              )}
              {mode.kind === 'add' && plans!.length > 0 && boardPlans.length === plans!.length && (
                <Text style={styles.status}>No other plans that come up in at least 2% of the games.</Text>
              )}
              {plans!.map((p, i) => {
                if (mode.kind === 'add' && alreadyOn(p) !== undefined) return null;
                const on = selected.has(i);
                const blocked = !on && count >= maxNew;
                const d = difference(p, plans!.slice(0, i).map((q, j) => ({ p: q, label: `plan ${j + 1}` })));
                const st = planState(p);
                return (
                  <Pressable key={i} onPress={() => toggle(i)} disabled={blocked} style={[styles.row, blocked && styles.disabled]} accessibilityRole="checkbox" accessibilityState={{ checked: on, disabled: blocked }}>
                    <View style={[styles.box, on && styles.boxOn]}>{on && <Text style={styles.check}>✓</Text>}</View>
                    <View style={styles.rowBody}>
                      <Text style={styles.rowTitle}>{`${title(p, i)} · ${shareText(posShare(p))} of games`}</Text>
                      <View style={styles.rowSplit}>
                        <ChessBoardView board={{ pieces: st.pieces, style: boardStyle, arrows: [], circles: [] }} size={PREVIEW} flipped={yourColor === 'b'} />
                        <View style={styles.rowText}>
                          <Text style={styles.rowLine}>{afterText(p)}</Text>
                          {d?.continues && <Text style={styles.rowPieces}>{`Continues from ${d.label}`}</Text>}
                          {d && d.diff.length > 0 && <Text style={styles.rowInfo}>{`Your plan here, different from ${d.label}:`}</Text>}
                          {d?.diff.map((x) => (
                            <Text key={x} style={styles.rowInfo}>
                              {x}
                            </Text>
                          ))}
                          {!!alsoText(p) && <Text style={styles.rowInfo}>{alsoText(p)}</Text>}
                        </View>
                      </View>
                    </View>
                  </Pressable>
                );
              })}
            </View>
          </>
        )}
      </ScrollView>
      {engine.element}
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
  rowBody: { flex: 1, gap: 6 },
  rowSplit: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  rowText: { flex: 1, gap: 2 },
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
