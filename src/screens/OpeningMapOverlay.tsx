// Opening map (new opening → "Opening map (Lichess)"): scans the explorer
// from the opening's start position, lets you pick your own move where
// several are popular, and proposes the cards in the style of your Italian
// (`openingBuilder.ts`): a Summary, a Specific line per forcing try,
// "Reactions: first move" and a "Reaction: !X" card where an opponent move
// changes three or more of your moves. Nothing is saved until "Create";
// Cancel leaves no opening behind.
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { showOverlay, useOverlayBack, alertDialog } from '../overlay';
import { colors, radius, touchTarget, type } from '../theme';
import { startingPosition, toFen } from '../chess';
import { makeMove, type GameState } from '../chessEngine';
import { DB_LABEL, fetchExplorer, getExplorerDb } from '../lichessExplorer';
import { DEFAULT_MAP_OPTIONS, moveLabel, scanOpening, type MapNode, type MapResult } from '../openingMap';
import { buildOpening, type BuiltOpening, type CardSpec } from '../openingBuilder';
import type { Move } from '../planGenerator';
import { useStockfishEngine } from '../engine/useStockfishEngine';
import { engineEvaluator, type EngineEval } from '../ownMove';
import { makePlanBoard, makeReactionsBoard } from '../importOpening';
import { allowScreenOff, keepScreenOn } from '../keepAwake';
import { addOpening, deleteOpening, saveCard, setOpeningSummary, uid } from '../storage';
import type { Arrow, BoardMove, Card, CardMode, OpeningStartPosition } from '../types';

const MODE: Record<CardSpec['kind'], CardMode> = { summary: 'summary', line: 'reactions', firstMove: 'plan', reaction: 'plan' };

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
  const [built, setBuilt] = useState<BuiltOpening | null>(null);
  const [status, setStatus] = useState<string | null>('Starting…');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [overrides, setOverrides] = useState<Map<string, string>>(new Map());
  const cancelled = useRef(false);
  // Stockfish, as referee between your popular moves (ownMove.ts).
  const engine = useStockfishEngine();
  const engineRef = useRef(engine);
  engineRef.current = engine;
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

  // The opening's own setup moves (from the standard start), with SAN.
  function setupMoves(): Move[] {
    let st: GameState = { pieces: startingPosition(), turn: 'w', castling: { wK: true, wQ: true, bK: true, bQ: true }, enPassant: null };
    return start.setupMoves.map((m) => {
      const r = makeMove(st, m.from, m.to, m.promotion);
      st = r.next;
      return { from: m.from, to: m.to, promotion: m.promotion, san: r.san };
    });
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

  async function scan(over: Map<string, string>) {
    setStatus('Starting…');
    setBuilt(null);
    try {
      const db = await getExplorerDb();
      const fetcher = (f: string) => fetchExplorer(f, db);
      const referee = await waitForEngine();
      if (cancelled.current) return;
      const r = await scanOpening(startState, yourColor, fetcher, over, DEFAULT_MAP_OPTIONS, setStatus, () => cancelled.current, referee);
      if (cancelled.current) return;
      setResult(r);
      const b = await buildOpening({
        result: r,
        yourColor,
        setup: setupMoves(),
        fetcher,
        source: `Lichess explorer (${DB_LABEL[db]})`,
        newId: uid,
        onProgress: setStatus,
        cancelled: () => cancelled.current,
        engineEval: referee
      });
      if (cancelled.current) return;
      setBuilt(b);
      setSelected(new Set(b.cards.map((c) => c.id)));
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
  const label = (path: Move[]) => path.map((m, i) => moveLabel({ ...m, ply: i }, startPly)).join(' ');

  function history(path: Move[]): BoardMove[] {
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
    if (!built) return;
    const picked = built.cards.filter((c) => selected.has(c.id));
    if (picked.length === 0) return;
    // A link to a card that is not created is left out (the arrow stays).
    const unlink = (a: Arrow): Arrow => {
      if (!a.notes?.linkCardId || selected.has(a.notes.linkCardId)) return a;
      const { linkCardId: _c, linkBoardId: _b, ...rest } = a.notes;
      return Object.keys(rest).length ? { ...a, notes: rest } : { from: a.from, to: a.to, color: a.color };
    };
    const opening = await addOpening(repertoireId, name, start.setupMoves.length > 0 ? start : undefined);
    try {
      const cards: Card[] = picked.map((c, order) => ({
        id: c.id,
        openingId: opening.id,
        order,
        name: c.name,
        mode: MODE[c.kind],
        boards: c.boards.map((b, i) => {
          const board =
            b.kind === 'plan'
              ? makePlanBoard(i, history(b.path), b.final, b.text, b.arrows.map(unlink), b.circles)
              : makeReactionsBoard(i, history(b.path), b.start, b.text, b.line);
          return { ...board, id: b.id };
        }),
        fastRevision: true
      }));
      await setOpeningSummary(opening.id, built.openingSummary);
      for (const card of cards) await saveCard(card);
      close(opening.id);
    } catch (e) {
      await deleteOpening(opening.id);
      await alertDialog(`Nothing was created: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const first = result?.splits[0];
  const count = built ? built.cards.filter((c) => selected.has(c.id)).length : 0;
  const ready = !!built && !status;
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
          Made from the Lichess explorer, in the style of your Italian: a Summary with your plan, a Specific line for each forcing try, Reactions: first move, and a Reaction card when an opponent move changes three or more of your moves.
        </Text>
        {status && (
          <View style={styles.statusRow}>
            <ActivityIndicator size="small" color={colors.textDim} />
            <Text style={styles.status}>{status}</Text>
          </View>
        )}
        {result && ready && (
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
              <Text style={styles.sectionTitle}>Opponent choices</Text>
              <Text style={styles.choiceText}>
                {first
                  ? `${first.at.path.length ? `After ${label(first.at.path)}` : 'At the start'}: ${first.groups
                      .map((g) => `${g.moves.map((m) => moveLabel(m.move, startPly)).join(' / ')} ${Math.round(g.share * 100)}%`)
                      .join(', ')}`
                  : 'No opponent choice changes your plan: the Summary holds the whole plan.'}
              </Text>
            </View>
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Cards</Text>
              {built!.cards.map((c) => {
                const on = selected.has(c.id);
                return (
                  <Pressable
                    key={c.id}
                    onPress={() =>
                      setSelected((prev) => {
                        const n = new Set(prev);
                        if (n.has(c.id)) n.delete(c.id);
                        else n.add(c.id);
                        return n;
                      })
                    }
                    style={styles.leaf}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: on }}
                  >
                    <View style={[styles.box, on && styles.boxOn]}>{on && <Text style={styles.check}>✓</Text>}</View>
                    <View style={styles.leafBody}>
                      <Text style={styles.leafText}>{c.boards.length > 1 ? `${c.name} (${c.boards.length} boards)` : c.name}</Text>
                      {!!c.info && <Text style={styles.leafInfo}>{c.info}</Text>}
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
          <Text style={styles.createText}>{`Create ${count} card${count === 1 ? '' : 's'}`}</Text>
        </Pressable>
      </View>
      {engine.element}
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
  status: { flex: 1, color: colors.textDim, fontSize: 14 },
  section: { backgroundColor: colors.panel2, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: 12, gap: 6 },
  sectionTitle: { color: colors.text, fontSize: 15, fontWeight: '700', marginBottom: 4 },
  leaf: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: touchTarget, paddingVertical: 4 },
  box: { width: 24, height: 24, borderRadius: 6, borderWidth: 2, borderColor: colors.textDim, alignItems: 'center', justifyContent: 'center' },
  boxOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  check: { color: colors.onPrimary, fontSize: 14, fontWeight: '800' },
  leafBody: { flex: 1, gap: 2 },
  leafText: { color: colors.text, fontSize: 14, fontWeight: '600' },
  leafInfo: { color: colors.textDim, fontSize: 13, lineHeight: 18 },
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
