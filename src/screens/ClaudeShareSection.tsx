// Settings → Developer → "Share my data with Claude" (see claudeShare.ts):
// the switch, the secret code to hand to Claude, and loading a version
// Claude prepared.
import React, { useEffect, useState } from 'react';
import { AppState, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, radius, touchTarget, type } from '../theme';
import { ToggleRow } from '../components/ToggleRow';
import { alertDialog, confirmDialog, showSnackbar } from '../overlay';
import { describeError, formatAgo, formatDateTime } from '../backup';
import {
  currentDataHash,
  fetchClaudeVersion,
  getShareState,
  hasClaudeVersion,
  onShareStateChange,
  removeClaudeVersion,
  shareNow,
  turnOffShare,
  turnOnShare,
  type ShareState
} from '../claudeShare';
import { getBeforeRestoreJson, replaceStoreFromJson } from '../storage';

const DESCRIPTION =
  'Keeps a copy of all your data in your account under a secret code, so Claude can open it. Needs Google sign-in. Off: the copy is deleted and the code stops working.';

export function ClaudeShareSection() {
  const [state, setState] = useState<ShareState | null>(null);
  const [busy, setBusy] = useState(false);
  // Whether Claude left a version to load (null: not known).
  const [waiting, setWaiting] = useState<boolean | null>(null);

  useEffect(() => {
    const reload = () => {
      getShareState().then((s) => setState({ ...s }));
    };
    reload();
    return onShareStateChange(reload);
  }, []);

  const on = !!state?.code;

  function lookForClaude() {
    hasClaudeVersion()
      .then(setWaiting)
      .catch(() => setWaiting(null));
  }
  // When Settings opens, when sharing is turned on, and when the app comes back.
  useEffect(() => {
    if (!on) return undefined;
    lookForClaude();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') lookForClaude();
    });
    return () => sub.remove();
  }, [on]);

  async function toggle() {
    if (busy) return;
    setBusy(true);
    try {
      if (on) {
        await turnOffShare();
        showSnackbar({ message: 'Stopped sharing. The copy was deleted.' });
      } else {
        await turnOnShare();
      }
    } catch (error) {
      await alertDialog(`Sharing didn't work: ${describeError(error)}.`);
    } finally {
      setBusy(false);
    }
  }

  async function share() {
    setBusy(true);
    try {
      await shareNow({ force: true });
      showSnackbar({ message: 'Shared.' });
      lookForClaude();
    } catch (error) {
      await alertDialog(`Sharing didn't work: ${describeError(error)}.`);
    } finally {
      setBusy(false);
    }
  }

  async function loadClaudeChanges() {
    setBusy(true);
    try {
      const version = await fetchClaudeVersion();
      if (!version) {
        setWaiting(false);
        await alertDialog("Claude hasn't prepared any changes.");
        return;
      }
      const changedSince = !!version.baseHash && (await currentDataHash()) !== version.baseHash;
      const message = [
        `Claude prepared a version on ${formatDateTime(version.createdAtMs)}${version.note ? `:\n${version.note}` : '.'}`,
        'Load it? It replaces the data on this phone. You can undo this right afterwards.',
        changedSince ? 'You changed things after Claude read your data: loading this version undoes those changes.' : ''
      ]
        .filter(Boolean)
        .join('\n\n');
      const ok = await confirmDialog(message, { confirmLabel: 'Load', confirmVariant: 'primary' });
      if (!ok) return;
      await replaceStoreFromJson(version.json);
      await removeClaudeVersion(version).catch(() => {});
      setWaiting(false);
      showSnackbar({
        message: "Loaded Claude's changes",
        actionLabel: 'Undo',
        onAction: async () => {
          const before = await getBeforeRestoreJson();
          if (!before) return;
          await replaceStoreFromJson(before);
          showSnackbar({ message: "Claude's changes undone" });
        }
      });
    } catch (error) {
      await alertDialog(`Loading Claude's changes didn't work: ${describeError(error)}.`);
    } finally {
      setBusy(false);
    }
  }

  // "Shared 23 Nov 2026, 20:57 · nothing new since (checked 5 min ago)": shows
  // that the app does look for changes even when there is nothing to share.
  const checkedLater = !!state?.lastCheckedAt && !!state.lastSharedAt && state.lastCheckedAt - state.lastSharedAt > 60_000;
  const status = !state
    ? ''
    : state.lastError
      ? `Not shared: ${state.lastError}.`
      : state.lastSharedAt
        ? `Shared ${formatAgo(state.lastSharedAt)}${checkedLater ? ` · nothing new since (checked ${formatAgo(state.lastCheckedAt!)})` : ''}. Changes are shared about 30 seconds later.`
        : 'Sharing…';
  const noChanges = waiting === false;

  return (
    <>
      <ToggleRow label="Share my data with Claude" value={on} onToggle={toggle} description={DESCRIPTION} />
      {on && state?.code && (
        <View style={styles.box}>
          <Text style={styles.caption}>Your code: long-press it, tap Copy and paste it in your chat with Claude.</Text>
          <Text selectable style={styles.code}>
            {state.code}
          </Text>
          <Text style={styles.caption}>{status}</Text>
          <View style={styles.row}>
            <Pressable onPress={share} disabled={busy} style={[styles.btn, busy && styles.disabled]}>
              <Text style={styles.btnText}>Share now</Text>
            </Pressable>
            <Pressable
              onPress={loadClaudeChanges}
              disabled={busy || noChanges}
              style={[styles.btn, styles.btnPrimary, (busy || noChanges) && styles.disabled]}
              accessibilityState={{ disabled: busy || noChanges }}
            >
              <Text style={styles.btnPrimaryText}>Load Claude's changes</Text>
            </Pressable>
          </View>
          {noChanges && <Text style={styles.caption}>No changes from Claude yet.</Text>}
        </View>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  box: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: 16, marginBottom: 16, gap: 10 },
  caption: { color: colors.textSecondary, ...type.caption },
  code: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '700',
    backgroundColor: colors.panel2,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 12
  },
  row: { flexDirection: 'row', gap: 10, flexWrap: 'wrap' },
  btn: { minHeight: touchTarget, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16, backgroundColor: colors.panel2 },
  btnText: { color: colors.text, fontSize: 15, fontWeight: '600' },
  btnPrimary: { backgroundColor: colors.primary },
  btnPrimaryText: { color: colors.onPrimary, fontSize: 15, fontWeight: '700' },
  disabled: { opacity: 0.4 }
});
