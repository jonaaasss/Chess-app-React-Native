// "Plan" panel under the board (Plan and Summary boards), next to the
// Explorer panel: Generate plan's settings (depth, database) and, after
// generating, what lies behind the arrows (planMaker.ts MadePlanDetails):
// per turn the plan move with the reactions that belong to it, move by move
// which moves you play, and where you don't play the most played move.
// Open/closed and the depth are remembered; the database is the shared setting.
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { arrowColors, colors, radius, touchTarget } from '../theme';
import { DB_LABEL, getExplorerDb, onExplorerDbChange, setExplorerDb, type ExplorerDb } from '../lichessExplorer';
import type { MadePlanDetails } from '../planMaker';
import { HelpButton } from './HelpButton';
import { HELP_GENERATE_PLAN } from '../helpContent';

export interface PlanChoices {
  depth: number;
  db: ExplorerDb;
}

const CHOICES_KEY = 'generatePlan.choices';
const OPEN_KEY = 'planPanel.open';
const pct = (x: number) => (x > 0 && x < 0.005 ? '<1%' : `${Math.round(x * 100)}%`);
const ORDINAL = ['1st', '2nd', '3rd', '4th', '5th', '6th'];
// Per turn at most this many of your moves, each with at most this many
// opponent moves named after it.
const STEP_MOVES = 6;
const STEP_AFTER = 4;

// "after any move (!Nd2 25% · !Be2 20% · !O-O 15%)", "after !Bxf6", or nothing
// (your first move, when it is your turn in the position).
function afterText(after: { trigger: string; share: number }[]): string {
  if (after.length === 0) return '';
  if (after.length === 1) return `after ${after[0].trigger}`;
  const named = after.slice(0, STEP_AFTER).map((a) => `${a.trigger} ${pct(a.share)}`);
  return `after any move (${named.join(' · ')}${after.length > STEP_AFTER ? ' · …' : ''})`;
}

export function PlanPanel({
  status,
  onGenerate,
  onCancel,
  details,
  madeWith
}: {
  status: string | null;
  onGenerate: (choices: PlanChoices) => void;
  onCancel: () => void;
  // The last plan made for the position on the board (null: none yet).
  details: MadePlanDetails | null;
  madeWith: PlanChoices | null;
}) {
  const [open, setOpen] = useState(true);
  const [depth, setDepth] = useState(4);
  const [db, setDb] = useState<ExplorerDb>('lichess');
  const [showSteps, setShowSteps] = useState(false);

  useEffect(() => {
    getExplorerDb().then(setDb);
    AsyncStorage.getItem(OPEN_KEY)
      .then((v) => v === 'false' && setOpen(false))
      .catch(() => undefined);
    AsyncStorage.getItem(CHOICES_KEY)
      .then((raw) => {
        if (!raw) return;
        const v = JSON.parse(raw) as Partial<PlanChoices>;
        if (typeof v.depth === 'number') setDepth(v.depth);
      })
      .catch(() => undefined);
    return onExplorerDbChange(setDb);
  }, []);

  function toggleOpen() {
    const next = !open;
    setOpen(next);
    AsyncStorage.setItem(OPEN_KEY, String(next)).catch(() => undefined);
  }

  function changeDepth(d: number) {
    const next = Math.min(6, Math.max(2, d));
    setDepth(next);
    AsyncStorage.setItem(CHOICES_KEY, JSON.stringify({ depth: next })).catch(() => undefined);
  }

  function changeDb(d: ExplorerDb) {
    if (d === db) return;
    setDb(d);
    void setExplorerDb(d);
  }

  const busy = !!status;
  return (
    <View style={styles.panel}>
      <View style={styles.headRow}>
        <Pressable onPress={toggleOpen} style={styles.head} accessibilityLabel={open ? 'Hide the plan panel' : 'Show the plan panel'}>
          <Text style={styles.title}>{`Plan ${open ? '▴' : '▾'}`}</Text>
          {!open && details && <Text style={styles.dim}>{`${details.lines} lines`}</Text>}
        </Pressable>
        <HelpButton topics={[HELP_GENERATE_PLAN]} />
      </View>
      {open && (
        <View style={styles.body}>
          <Text style={styles.label}>Depth (your moves)</Text>
          <View style={styles.stepper}>
            <Pressable onPress={() => changeDepth(depth - 1)} disabled={busy} style={styles.stepBtn} accessibilityLabel="Less deep">
              <Text style={styles.stepText}>−</Text>
            </Pressable>
            <Text style={styles.stepValue}>{depth}</Text>
            <Pressable onPress={() => changeDepth(depth + 1)} disabled={busy} style={styles.stepBtn} accessibilityLabel="Deeper">
              <Text style={styles.stepText}>+</Text>
            </Pressable>
          </View>

          <Text style={styles.label}>Database</Text>
          <View style={styles.chips}>
            {(['lichess', 'masters'] as ExplorerDb[]).map((d) => (
              <Pressable
                key={d}
                onPress={() => changeDb(d)}
                disabled={busy}
                style={[styles.chip, db === d && styles.chipOn]}
                accessibilityRole="radio"
                accessibilityState={{ selected: db === d }}
              >
                <Text style={[styles.chipText, db === d && styles.chipTextOn]}>{DB_LABEL[d]}</Text>
              </Pressable>
            ))}
          </View>

          {busy ? (
            <View style={styles.statusRow}>
              <ActivityIndicator size="small" color={colors.textDim} />
              <Text style={styles.status}>{status}</Text>
              <Pressable onPress={onCancel} style={styles.cancelBtn}>
                <Text style={styles.cancelText}>Cancel</Text>
              </Pressable>
            </View>
          ) : (
            <Pressable onPress={() => onGenerate({ depth, db })} style={styles.genBtn} accessibilityLabel="Generate the plan from the Lichess explorer and Stockfish">
              <Text style={styles.genText}>Generate plan</Text>
            </Pressable>
          )}
          <Text style={styles.hint}>The plan arrows on this position are replaced (Undo afterwards). Tap the badge on a plan arrow to see its reactions.</Text>

          {details && madeWith && (
            <View style={styles.results}>
              <Text style={styles.dim}>
                {`From ${details.lines} lines · ${DB_LABEL[madeWith.db]} · depth ${madeWith.depth}${details.engine ? ' · with Stockfish' : ' · without Stockfish (database only)'}`}
              </Text>

              <Text style={styles.section}>The plan</Text>
              <Text style={styles.hint}>
                Per turn the move you play most, of the moves at most 0.1 pawn from Stockfish's best. Under it (dark): opponent moves in at least 5% of the lines after
                which you play something else.
              </Text>
              {details.turns.map((t) => {
                const c = t.plan ? arrowColors[t.plan.color] : undefined;
                return (
                  <View key={t.n} style={styles.step}>
                    <View style={styles.row}>
                      <View style={[styles.dot, { backgroundColor: c ?? 'transparent', borderColor: c ?? colors.border }]} />
                      <Text style={styles.stepTitle}>{`${ORDINAL[t.n - 1] ?? `${t.n}th`} move`}</Text>
                      <Text style={styles.san}>{t.plan?.san ?? '—'}</Text>
                      {t.plan && <Text style={styles.afterText}>{`played ${pct(t.plan.share)} · acceptable in ${pct(t.plan.accepted)}`}</Text>}
                    </View>
                    {t.reactions.map((r) => (
                      <View key={`${r.trigger}${r.answer}`} style={[styles.row, styles.indent]}>
                        <View style={[styles.dot, { backgroundColor: r.drawn ? arrowColors[r.color] : 'transparent', borderColor: arrowColors[r.color] }]} />
                        <Text style={[styles.line, !r.drawn && styles.off]}>
                          {`${r.trigger} → ${r.answer} · ${pct(r.share)}${r.reason ? ` · ${r.reason}` : ''}${r.drawn ? '' : ' · not drawn: a piece is not on the board yet'}`}
                        </Text>
                      </View>
                    ))}
                  </View>
                );
              })}

              {details.choices.length > 0 && <Text style={styles.section}>Not the most played move</Text>}
              {details.choices.map((c) => (
                <Text key={`${c.after}${c.chosen}`} style={styles.line}>{`After ${c.after}: ${c.chosen}, not ${c.instead} (${c.detail})`}</Text>
              ))}

              <Pressable onPress={() => setShowSteps((v) => !v)} style={styles.toggle} accessibilityLabel={showSteps ? 'Hide move by move' : 'Show move by move'}>
                <Text style={styles.section}>{`Move by move ${showSteps ? '▴' : '▾'}`}</Text>
              </Pressable>
              {showSteps && (
                <>
                  <Text style={styles.hint}>Which move you play on each turn, as a share of the lines that get that far, and in how many of them it is acceptable.</Text>
                  {details.turns.map((t) => (
                    <View key={t.n} style={styles.step}>
                      <Text style={styles.stepTitle}>{`Your ${ORDINAL[t.n - 1] ?? `${t.n}th`} move`}</Text>
                      {t.moves.slice(0, STEP_MOVES).map((m) => {
                        const c = m.color ? arrowColors[m.color] : undefined;
                        return (
                          <View key={m.key} style={styles.row}>
                            <View style={[styles.dot, { backgroundColor: c ?? 'transparent', borderColor: c ?? colors.border }]} />
                            <Text style={[styles.san, !c && styles.off]}>{m.san}</Text>
                            <Text style={styles.afterText} numberOfLines={2}>
                              {afterText(m.after)}
                            </Text>
                            <Text style={styles.num}>{pct(m.share)}</Text>
                          </View>
                        );
                      })}
                      {t.moves.length > STEP_MOVES && <Text style={styles.hint}>{`and ${t.moves.length - STEP_MOVES} more`}</Text>}
                    </View>
                  ))}
                </>
              )}
            </View>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { marginTop: 4, marginBottom: 10, backgroundColor: colors.panel2, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, overflow: 'hidden' },
  headRow: { flexDirection: 'row', alignItems: 'center' },
  head: { flex: 1, minHeight: touchTarget, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingLeft: 12, paddingRight: 4 },
  title: { color: colors.text, fontSize: 14, fontWeight: '700' },
  body: { paddingHorizontal: 12, paddingBottom: 12, gap: 6 },
  label: { color: colors.textDim, fontSize: 13, fontWeight: '600', marginTop: 4 },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  stepBtn: { width: touchTarget, height: touchTarget, borderRadius: 10, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.panel, alignItems: 'center', justifyContent: 'center' },
  stepText: { color: colors.text, fontSize: 22, fontWeight: '600' },
  stepValue: { color: colors.text, fontSize: 18, fontWeight: '700', minWidth: 20, textAlign: 'center' },
  chips: { flexDirection: 'row', gap: 6 },
  chip: { flex: 1, minHeight: 40, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  chipOn: { backgroundColor: '#E2E8F0', borderColor: '#E2E8F0' },
  chipText: { color: colors.textDim, fontSize: 13, fontWeight: '600' },
  chipTextOn: { color: colors.bg, fontWeight: '700' },
  hint: { color: colors.textDim, fontSize: 12, lineHeight: 17 },
  genBtn: { minHeight: touchTarget, borderRadius: radius.pill, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', marginTop: 6 },
  genText: { color: colors.onPrimary, fontSize: 15, fontWeight: '700' },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: touchTarget, marginTop: 6 },
  status: { flex: 1, color: colors.textDim, fontSize: 13 },
  cancelBtn: { minHeight: touchTarget, paddingHorizontal: 14, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, justifyContent: 'center' },
  cancelText: { color: colors.text, fontSize: 14, fontWeight: '600' },
  results: { marginTop: 8, paddingTop: 10, borderTopWidth: 1, borderTopColor: colors.border, gap: 6 },
  dim: { color: colors.textDim, fontSize: 12 },
  section: { color: colors.text, fontSize: 14, fontWeight: '700', marginTop: 8 },
  toggle: { minHeight: touchTarget, justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 28 },
  indent: { paddingLeft: 20 },
  dot: { width: 12, height: 12, borderRadius: 6, borderWidth: 1 },
  san: { width: 52, color: colors.text, fontSize: 14, fontWeight: '700' },
  off: { color: colors.textDim, fontWeight: '500' },
  num: { width: 40, color: colors.text, fontSize: 13, textAlign: 'right' },
  line: { flex: 1, color: colors.textSecondary, fontSize: 13, lineHeight: 19 },
  step: { gap: 2, marginTop: 4 },
  stepTitle: { color: colors.textSecondary, fontSize: 13, fontWeight: '700' },
  afterText: { flex: 1, color: colors.textDim, fontSize: 12, lineHeight: 16 }
});
