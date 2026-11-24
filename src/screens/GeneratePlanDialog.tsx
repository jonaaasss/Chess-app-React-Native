// "Generate plan" settings: how deep, from how often a move counts as part
// of the plan, which database, engine check.
// Resolves to the choices, or null when cancelled. The choices are
// remembered for next time; the database is the one shared setting of the
// explorer (also the Explorer panel, Variations and "% of games").
import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { showOverlay, useOverlayBack } from '../overlay';
import { colors, radius, touchTarget } from '../theme';
import { DB_LABEL, getExplorerDb, setExplorerDb, type ExplorerDb } from '../lichessExplorer';

export interface GeneratePlanChoices {
  depth: number;
  planShare: number; // a move is in the plan when it comes in this share of the lines
  db: ExplorerDb;
  engine: boolean;
}

const SHARES = [0.6, 0.5, 0.4, 0.3];

const KEY = 'generatePlan.choices';

function Dialog({ close }: { close: (v: GeneratePlanChoices | null) => void }) {
  const [depth, setDepth] = useState(4);
  const [planShare, setPlanShare] = useState(0.6);
  const [db, setDb] = useState<ExplorerDb>('lichess');
  const [engine, setEngine] = useState(true);
  useOverlayBack(() => close(null));

  useEffect(() => {
    getExplorerDb().then(setDb);
    AsyncStorage.getItem(KEY)
      .then((raw) => {
        if (!raw) return;
        const v = JSON.parse(raw) as Partial<GeneratePlanChoices>;
        if (typeof v.depth === 'number') setDepth(v.depth);
        if (typeof v.planShare === 'number' && SHARES.includes(v.planShare)) setPlanShare(v.planShare);
        if (typeof v.engine === 'boolean') setEngine(v.engine);
      })
      .catch(() => undefined);
  }, []);

  function go() {
    const v = { depth, planShare, db, engine };
    AsyncStorage.setItem(KEY, JSON.stringify({ depth, planShare, engine })).catch(() => undefined);
    setExplorerDb(db).catch(() => undefined);
    close(v);
  }

  return (
    <View style={styles.backdrop}>
      <View style={styles.box}>
        <Text style={styles.title}>Generate plan</Text>
        <Text style={styles.body}>
          Draws your plan from the Lichess explorer for the position on the board: your moves that come back in most lines, coloured by when they come, and the
          opponent's moves that change them as notes. The arrows on this position are replaced (Undo afterwards).
        </Text>

        <Text style={styles.label}>Depth (your moves)</Text>
        <View style={styles.stepper}>
          <Pressable onPress={() => setDepth((d) => Math.max(2, d - 1))} style={styles.stepBtn} accessibilityLabel="Less deep">
            <Text style={styles.stepText}>−</Text>
          </Pressable>
          <Text style={styles.stepValue}>{depth}</Text>
          <Pressable onPress={() => setDepth((d) => Math.min(6, d + 1))} style={styles.stepBtn} accessibilityLabel="Deeper">
            <Text style={styles.stepText}>+</Text>
          </Pressable>
        </View>

        <Text style={styles.label}>Plan move from (share of the lines)</Text>
        <View style={styles.dbRow}>
          {SHARES.map((x) => (
            <Pressable
              key={x}
              onPress={() => setPlanShare(x)}
              style={[styles.dbBtn, planShare === x && styles.dbBtnOn]}
              accessibilityRole="radio"
              accessibilityState={{ selected: planShare === x }}
            >
              <Text style={[styles.dbText, planShare === x && styles.dbTextOn]}>{`${Math.round(x * 100)}%`}</Text>
            </Pressable>
          ))}
        </View>
        <Text style={[styles.small, { marginTop: -8, marginBottom: 14 }]}>Lower gives more arrows where the opponent has many options.</Text>

        <Text style={styles.label}>Database</Text>
        <View style={styles.dbRow}>
          {(['lichess', 'masters'] as const).map((d) => (
            <Pressable key={d} onPress={() => setDb(d)} style={[styles.dbBtn, db === d && styles.dbBtnOn]}>
              <Text style={[styles.dbText, db === d && styles.dbTextOn]}>{DB_LABEL[d]}</Text>
            </Pressable>
          ))}
        </View>

        <View style={styles.switchRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.switchLabel}>Engine check</Text>
            <Text style={styles.small}>Notes a move that is not in Stockfish's top 3. Slower.</Text>
          </View>
          <Switch value={engine} onValueChange={setEngine} trackColor={{ false: colors.panel2, true: colors.primary }} thumbColor={colors.textPrimary} />
        </View>

        <View style={styles.buttons}>
          <Pressable onPress={() => close(null)} style={[styles.btn, styles.btnSecondary]}>
            <Text style={styles.btnSecondaryText}>Cancel</Text>
          </Pressable>
          <Pressable onPress={go} style={[styles.btn, styles.btnPrimary]}>
            <Text style={styles.btnPrimaryText}>Generate</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

export function openGeneratePlanDialog(): Promise<GeneratePlanChoices | null> {
  return showOverlay<GeneratePlanChoices | null>((close) => <Dialog close={close} />);
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', padding: 20 },
  box: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: 20, borderWidth: 1, borderColor: colors.border },
  title: { color: colors.text, fontSize: 17, fontWeight: '700', marginBottom: 8 },
  body: { color: colors.textSecondary, fontSize: 13, lineHeight: 19, marginBottom: 14 },
  label: { color: colors.textDim, fontSize: 13, fontWeight: '600', marginBottom: 6 },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 16, marginBottom: 14 },
  stepBtn: { width: touchTarget, height: touchTarget, borderRadius: 10, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.panel2, alignItems: 'center', justifyContent: 'center' },
  stepText: { color: colors.text, fontSize: 22, fontWeight: '600' },
  stepValue: { color: colors.text, fontSize: 18, fontWeight: '700', minWidth: 20, textAlign: 'center' },
  dbRow: { flexDirection: 'row', gap: 6, marginBottom: 14 },
  dbBtn: { flex: 1, minHeight: touchTarget, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  dbBtnOn: { backgroundColor: '#E2E8F0', borderColor: '#E2E8F0' },
  dbText: { color: colors.textDim, fontSize: 13, fontWeight: '600' },
  dbTextOn: { color: colors.bg, fontWeight: '700' },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: touchTarget, marginBottom: 6 },
  switchLabel: { color: colors.text, fontSize: 14, fontWeight: '600' },
  small: { color: colors.textDim, fontSize: 12 },
  buttons: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 12 },
  btn: { minHeight: touchTarget, borderRadius: radius.pill, paddingHorizontal: 18, alignItems: 'center', justifyContent: 'center' },
  btnPrimary: { backgroundColor: colors.primary },
  btnPrimaryText: { color: colors.onPrimary, fontSize: 15, fontWeight: '700' },
  btnSecondary: { backgroundColor: colors.panel2 },
  btnSecondaryText: { color: colors.text, fontSize: 15, fontWeight: '600' }
});
