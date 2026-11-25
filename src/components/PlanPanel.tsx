// "Plan" panel under the board (Plan and Summary boards), next to the
// Explorer panel: all of Generate plan's settings (depth, "Plan move from",
// database, engine check) and, after generating, what lies behind the arrows
// (planGenerator.ts PlanDetails): your moves with how often they come, the
// threats and your answers, where the rule did not take the most played
// move, and the exceptions. Changing "Plan move from" after a plan was made
// draws it again at once (the explorer's answers are cached). Open/closed
// and the settings are remembered; the database is the shared setting.
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { arrowColors, colors, radius, touchTarget } from '../theme';
import { DB_LABEL, getExplorerDb, onExplorerDbChange, setExplorerDb, type ExplorerDb } from '../lichessExplorer';
import type { PlanDetails } from '../planGenerator';
import { HelpButton } from './HelpButton';
import { HELP_GENERATE_PLAN, HELP_YOUR_MOVE } from '../helpContent';

export interface PlanChoices {
  depth: number;
  planShare: number; // a move is in the plan when it comes in this share of the lines
  db: ExplorerDb;
  engine: boolean;
}

const SHARES = [0.6, 0.5, 0.4, 0.3];
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
  details: PlanDetails | null;
  madeWith: PlanChoices | null;
}) {
  const [open, setOpen] = useState(true);
  const [depth, setDepth] = useState(4);
  const [planShare, setPlanShare] = useState(0.6);
  const [db, setDb] = useState<ExplorerDb>('lichess');
  const [engine, setEngine] = useState(true);

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
        if (typeof v.planShare === 'number' && SHARES.includes(v.planShare)) setPlanShare(v.planShare);
        if (typeof v.engine === 'boolean') setEngine(v.engine);
      })
      .catch(() => undefined);
    return onExplorerDbChange(setDb);
  }, []);

  function remember(next: Partial<PlanChoices>) {
    const v = { depth, planShare, engine, ...next };
    AsyncStorage.setItem(CHOICES_KEY, JSON.stringify({ depth: v.depth, planShare: v.planShare, engine: v.engine })).catch(() => undefined);
  }

  function toggleOpen() {
    const next = !open;
    setOpen(next);
    AsyncStorage.setItem(OPEN_KEY, String(next)).catch(() => undefined);
  }

  function changeDepth(d: number) {
    const next = Math.min(6, Math.max(2, d));
    setDepth(next);
    remember({ depth: next });
  }

  // After a plan was made, another share draws it again right away.
  function changeShare(x: number) {
    if (x === planShare) return;
    setPlanShare(x);
    remember({ planShare: x });
    if (details && madeWith && !status) onGenerate({ ...madeWith, planShare: x });
  }

  function changeDb(d: ExplorerDb) {
    if (d === db) return;
    setDb(d);
    void setExplorerDb(d);
  }

  function changeEngine(v: boolean) {
    setEngine(v);
    remember({ engine: v });
  }

  const busy = !!status;
  return (
    <View style={styles.panel}>
      <View style={styles.headRow}>
        <Pressable onPress={toggleOpen} style={styles.head} accessibilityLabel={open ? 'Hide the plan panel' : 'Show the plan panel'}>
          <Text style={styles.title}>{`Plan ${open ? '▴' : '▾'}`}</Text>
          {!open && details && <Text style={styles.dim}>{`${details.lines} lines`}</Text>}
        </Pressable>
        <HelpButton topics={[HELP_GENERATE_PLAN, HELP_YOUR_MOVE]} />
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

          <Text style={styles.label}>Plan move from (share of the lines)</Text>
          <View style={styles.chips}>
            {SHARES.map((x) => (
              <Pressable
                key={x}
                onPress={() => changeShare(x)}
                disabled={busy}
                style={[styles.chip, planShare === x && styles.chipOn]}
                accessibilityRole="radio"
                accessibilityState={{ selected: planShare === x }}
              >
                <Text style={[styles.chipText, planShare === x && styles.chipTextOn]}>{pct(x)}</Text>
              </Pressable>
            ))}
          </View>
          <Text style={styles.hint}>Lower gives more arrows where the opponent has many options. After a plan is made, changing this draws it again at once.</Text>

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

          <View style={styles.switchRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.switchLabel}>Engine check</Text>
              <Text style={styles.hint}>Notes a move that is not in Stockfish's top 3. Slower.</Text>
            </View>
            <Switch value={engine} onValueChange={changeEngine} disabled={busy} trackColor={{ false: colors.panel2, true: colors.primary }} thumbColor={colors.textPrimary} />
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
            <Pressable
              onPress={() => onGenerate({ depth, planShare, db, engine })}
              style={styles.genBtn}
              accessibilityLabel="Generate the plan from the Lichess explorer"
            >
              <Text style={styles.genText}>Generate plan</Text>
            </Pressable>
          )}
          <Text style={styles.hint}>The plan arrows on this position are replaced (Undo afterwards).</Text>

          {details && madeWith && (
            <View style={styles.results}>
              <Text style={styles.dim}>{`From ${details.lines} lines · ${DB_LABEL[madeWith.db]} · depth ${madeWith.depth}`}</Text>

              <Text style={styles.section}>Move by move</Text>
              <Text style={styles.hint}>Which move you play on each turn, as a share of the lines that get that far.</Text>
              {details.steps.map((step) => (
                <View key={step.n} style={styles.step}>
                  <Text style={styles.stepTitle}>{`Your ${ORDINAL[step.n - 1] ?? `${step.n}th`} move`}</Text>
                  {step.moves.slice(0, STEP_MOVES).map((m) => {
                    const c = m.color ? arrowColors[m.color] : undefined;
                    const after = afterText(m.after);
                    return (
                      <View key={m.key} style={styles.stepMove}>
                        <View style={styles.row}>
                          <View style={[styles.dot, { backgroundColor: c ?? 'transparent', borderColor: c ?? colors.border }]} />
                          <Text style={[styles.san, !c && styles.off]}>{m.san}</Text>
                          <Text style={styles.afterText} numberOfLines={2}>
                            {after}
                          </Text>
                          <Text style={styles.num}>{pct(m.share)}</Text>
                        </View>
                      </View>
                    );
                  })}
                  {step.moves.length > STEP_MOVES && <Text style={styles.hint}>{`and ${step.moves.length - STEP_MOVES} more`}</Text>}
                </View>
              ))}

              <Text style={styles.section}>Your moves</Text>
              <Text style={styles.hint}>{`Drawn when it comes in at least ${pct(details.planShare)} of the lines (dark: your answer to a threat).`}</Text>
              {details.own.map((m) => {
                const c = m.color ? arrowColors[m.color] : undefined;
                return (
                  <View key={m.key} style={styles.row}>
                    <View style={[styles.dot, { backgroundColor: c ?? 'transparent', borderColor: c ?? colors.border }]} />
                    <Text style={[styles.san, !m.drawn && styles.off]}>{m.san}</Text>
                    <View style={styles.bar}>
                      <View style={[styles.barFill, { width: `${Math.round(m.share * 100)}%`, backgroundColor: c ?? colors.border }]} />
                      <View style={[styles.mark, { left: `${Math.round(details.planShare * 100)}%` }]} />
                    </View>
                    <Text style={[styles.num, !m.drawn && styles.off]}>{pct(m.share)}</Text>
                  </View>
                );
              })}

              {details.pairs.length > 0 && <Text style={styles.section}>Threats and your answers</Text>}
              {details.pairs.map((p) => (
                <View key={p.trigger} style={styles.row}>
                  <View style={[styles.dot, { backgroundColor: arrowColors[p.color], borderColor: arrowColors[p.color] }]} />
                  <Text style={styles.line}>{`${p.trigger} → ${p.answers.join(' ')} · ${pct(p.share)} of the lines${p.reason ? ` · ${p.reason}` : ''}`}</Text>
                </View>
              ))}

              {details.choices.length > 0 && <Text style={styles.section}>Not the most played move</Text>}
              {details.choices.map((c) => (
                <Text key={`${c.after}${c.chosen}`} style={styles.line}>{`After ${c.after}: ${c.chosen}, not ${c.instead} (${c.detail})`}</Text>
              ))}

              {details.exceptions.length > 0 && <Text style={styles.section}>Exceptions (notes on the arrows)</Text>}
              {details.exceptions.map((e) => (
                <Text key={`${e.move}${e.trigger}`} style={styles.line}>
                  {e.text === `no ${e.move}` ? `${e.move}: mostly not played after ${e.trigger}` : `${e.move}: after ${e.trigger} you play ${e.text} instead`}
                </Text>
              ))}
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
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: touchTarget },
  switchLabel: { color: colors.text, fontSize: 14, fontWeight: '600' },
  genBtn: { minHeight: touchTarget, borderRadius: radius.pill, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', marginTop: 6 },
  genText: { color: colors.onPrimary, fontSize: 15, fontWeight: '700' },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: touchTarget, marginTop: 6 },
  status: { flex: 1, color: colors.textDim, fontSize: 13 },
  cancelBtn: { minHeight: touchTarget, paddingHorizontal: 14, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, justifyContent: 'center' },
  cancelText: { color: colors.text, fontSize: 14, fontWeight: '600' },
  results: { marginTop: 8, paddingTop: 10, borderTopWidth: 1, borderTopColor: colors.border, gap: 6 },
  dim: { color: colors.textDim, fontSize: 12 },
  section: { color: colors.text, fontSize: 14, fontWeight: '700', marginTop: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 28 },
  dot: { width: 12, height: 12, borderRadius: 6, borderWidth: 1 },
  san: { width: 52, color: colors.text, fontSize: 14, fontWeight: '700' },
  off: { color: colors.textDim, fontWeight: '500' },
  bar: { flex: 1, height: 12, borderRadius: 3, backgroundColor: colors.panel, overflow: 'hidden' },
  barFill: { height: '100%' },
  mark: { position: 'absolute', top: 0, bottom: 0, width: 2, backgroundColor: colors.textSecondary },
  num: { width: 40, color: colors.text, fontSize: 13, textAlign: 'right' },
  line: { flex: 1, color: colors.textSecondary, fontSize: 13, lineHeight: 19 },
  step: { gap: 2, marginTop: 4 },
  stepTitle: { color: colors.textSecondary, fontSize: 13, fontWeight: '700', marginTop: 2 },
  stepMove: { gap: 0 },
  afterText: { flex: 1, color: colors.textDim, fontSize: 12, lineHeight: 16 }
});
