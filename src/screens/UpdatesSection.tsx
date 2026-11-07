// Settings → "App updates": which code is running (built into the app, or an
// update downloaded over the air), and a "Check for updates" button that asks
// the update server right away and shows its exact answer — including why an
// update was not taken — so a failing update can be diagnosed on the phone.
import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import * as Updates from 'expo-updates';
import { colors, radius, touchTarget, type } from '../theme';

const REASON_TEXT: Record<string, string> = {
  noUpdateAvailableOnServer: 'The server has no update for this app (channel or runtime version).',
  updateRejectedBySelectionPolicy: 'The server sent an update, but the app refused it (not newer than what is running).',
  updatePreviouslyFailed: 'The server sent an update that failed to start before, so the app skips it.',
  rollbackRejectedBySelectionPolicy: 'The server asked to go back to the built-in code, but the app refused.',
  rollbackNoEmbedded: 'The server asked to go back to the built-in code, but there is none.'
};

function formatDate(d: Date | null | undefined): string {
  if (!d) return 'unknown';
  return d.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function UpdatesSection() {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [log, setLog] = useState<string | null>(null);

  const running = !Updates.isEnabled
    ? 'Updates are switched off in this build.'
    : Updates.isEmbeddedLaunch
      ? `Built-in code from ${formatDate(Updates.createdAt)}`
      : `Update from ${formatDate(Updates.createdAt)}`;

  async function check() {
    setBusy(true);
    setResult('Checking…');
    try {
      const check = await Updates.checkForUpdateAsync();
      if (check.isAvailable) {
        setResult('Update found. Downloading…');
        const fetched = await Updates.fetchUpdateAsync();
        if (fetched.isNew || fetched.isRollBackToEmbedded) {
          setResult('Downloaded. Restarting…');
          await Updates.reloadAsync();
          return;
        }
        setResult('Downloaded, but it is the same version that is running.');
      } else if ('isRollBackToEmbedded' in check && check.isRollBackToEmbedded) {
        setResult('The server asks to go back to the built-in code.');
      } else {
        const reason = 'reason' in check ? String(check.reason) : 'unknown';
        setResult(`No update. ${REASON_TEXT[reason] ?? ''} (${reason})`);
      }
    } catch (e) {
      setResult(`Error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  async function showLog() {
    try {
      const entries = await Updates.readLogEntriesAsync(60 * 60 * 1000);
      const useful = entries.filter((e) => !e.message.startsWith('embeddedAssetFileMap')).slice(-15);
      setLog(useful.length ? useful.map((e) => `${e.level} ${e.code}: ${e.message}`).join('\n\n') : 'No log entries in the last hour.');
    } catch (e) {
      setLog(`Error: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return (
    <View style={styles.section}>
      <Text style={styles.heading}>App updates</Text>
      <Text style={styles.body}>{running}</Text>
      <Text style={styles.meta}>
        {`Channel: ${Updates.channel ?? 'none'} · Runtime: ${Updates.runtimeVersion ?? 'none'}`}
        {Updates.updateId ? `\nUpdate ID: ${Updates.updateId}` : ''}
      </Text>
      <View style={styles.actionRow}>
        <Pressable onPress={check} disabled={busy || !Updates.isEnabled} style={[styles.actionBtn, styles.actionPrimary, (busy || !Updates.isEnabled) && styles.disabled]}>
          <Text style={styles.actionPrimaryText}>Check for updates</Text>
        </Pressable>
        <Pressable onPress={showLog} style={[styles.actionBtn, styles.actionSecondary]}>
          <Text style={styles.actionSecondaryText}>Show log</Text>
        </Pressable>
      </View>
      <Text style={styles.tip}>Tip: tap Check for updates after a new version is published. The app restarts by itself.</Text>
      {result && <Text selectable style={styles.result}>{result}</Text>}
      {log && <Text selectable style={styles.log}>{log}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: 16, marginBottom: 20 },
  heading: { color: colors.text, ...type.bodyStrong, fontSize: 16, marginBottom: 6 },
  body: { color: colors.textSecondary, ...type.caption, marginBottom: 4 },
  meta: { color: colors.textDim, ...type.caption, marginBottom: 12 },
  actionRow: { flexDirection: 'row', gap: 10, flexWrap: 'wrap' },
  actionBtn: { minHeight: touchTarget, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
  actionPrimary: { backgroundColor: colors.primary },
  actionPrimaryText: { color: colors.onPrimary, fontSize: 15, fontWeight: '700' },
  actionSecondary: { backgroundColor: colors.panel2 },
  actionSecondaryText: { color: colors.text, fontSize: 15, fontWeight: '600' },
  disabled: { opacity: 0.4 },
  tip: { color: colors.textDim, ...type.caption, marginTop: 10 },
  result: { color: colors.text, ...type.caption, marginTop: 12 },
  log: { color: colors.textDim, fontSize: 11, marginTop: 10 }
});
