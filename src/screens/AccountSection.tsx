import React, { useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { useAccount } from '../account';
import { formatAgo, getBackupMeta, onBackupMetaChange, updateBackupMeta, type BackupMeta } from '../backup';
import {
  backupNowFlow,
  deleteAccountFlow,
  resolveInitialSync,
  restoreFlow,
  signInFlow,
  signOutFlow
} from '../backupFlow';
import { ToggleRow } from '../components/ToggleRow';
import { colors, radius, touchTarget, type } from '../theme';

// The standard four-colour Google "G".
function GoogleGIcon({ size }: { size: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 18 18">
      <Path
        d="M17.64 9.2045c0-.6381-.0573-1.2518-.1636-1.8409H9v3.4814h4.8436c-.2086 1.125-.8427 2.0782-1.7959 2.7164v2.2581h2.9087c1.7018-1.5668 2.6836-3.874 2.6836-6.615z"
        fill="#4285F4"
      />
      <Path
        d="M9 18c2.43 0 4.4673-.806 5.9564-2.1805l-2.9087-2.2581c-.8059.54-1.8368.859-3.0477.859-2.344 0-4.3282-1.5831-5.036-3.7104H.9574v2.3318C2.4382 15.9832 5.4818 18 9 18z"
        fill="#34A853"
      />
      <Path
        d="M3.964 10.71c-.18-.54-.2822-1.1168-.2822-1.71s.1023-1.17.2823-1.71V4.9582H.9573A8.9965 8.9965 0 0 0 0 9c0 1.4523.3477 2.8268.9573 4.0418L3.964 10.71z"
        fill="#FBBC05"
      />
      <Path
        d="M9 3.5795c1.3214 0 2.5077.4541 3.4405 1.346l2.5813-2.5814C13.4627.8918 11.4259 0 9 0 5.4818 0 2.4382 2.0168.9573 4.9582L3.964 7.29C4.6718 5.1627 6.6559 3.5795 9 3.5795z"
        fill="#EA4335"
      />
    </Svg>
  );
}

function useBackupMeta(): BackupMeta | null {
  const [meta, setMeta] = useState<BackupMeta | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () => {
      getBackupMeta().then((m) => {
        if (alive) setMeta({ ...m });
      });
    };
    load();
    const stop = onBackupMetaChange(load);
    return () => {
      alive = false;
      stop();
    };
  }, []);
  return meta;
}

// "Account & backup" in Settings: sign in with Google, back up, restore.
export function AccountSection() {
  const { user, ready } = useAccount();
  const meta = useBackupMeta();
  const [busy, setBusy] = useState<string | null>(null);
  // Re-renders now and then so "3 min ago" keeps up.
  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick((n) => n + 1), 30_000);
    return () => clearInterval(timer);
  }, []);

  async function run(name: string, action: () => Promise<void>) {
    if (busy) return;
    setBusy(name);
    try {
      await action();
    } finally {
      setBusy(null);
    }
  }

  if (!ready && !user) return null;

  if (!user) {
    return (
      <View style={styles.section}>
        <Text style={styles.heading}>Account & backup</Text>
        <Text style={styles.body}>
          Your cards are only on this phone. Sign in with Google to back them up, so you can get them back on a new phone.
        </Text>
        <Pressable
          onPress={() => run('signin', signInFlow)}
          disabled={busy !== null}
          style={({ pressed }) => [styles.googleBtn, pressed && { opacity: 0.85 }]}
        >
          <GoogleGIcon size={20} />
          <Text style={styles.googleBtnText}>{busy === 'signin' ? 'Signing in…' : 'Sign in with Google'}</Text>
        </Pressable>
      </View>
    );
  }

  const paused = meta !== null && meta.resolvedUid !== user.uid;
  let status = 'No backup yet.';
  if (paused) status = 'Backup is paused: your account already has a backup. Choose what to do with it.';
  else if (meta?.lastError) status = `The last backup failed (${meta.lastError}). It's tried again automatically.`;
  else if (meta?.lastBackupAt) status = `Last backup: ${formatAgo(meta.lastBackupAt)}.`;

  return (
    <View style={styles.section}>
      <Text style={styles.heading}>Account & backup</Text>
      <Text style={styles.body}>
        Signed in as <Text style={styles.strong}>{user.email ?? 'your Google account'}</Text>
      </Text>
      <Text style={[styles.status, (paused || meta?.lastError) && styles.statusWarn]}>{status}</Text>

      {paused ? (
        <Pressable
          onPress={() => run('resolve', () => resolveInitialSync(user.uid))}
          disabled={busy !== null}
          style={[styles.actionBtn, styles.actionPrimary]}
        >
          <Text style={styles.actionPrimaryText}>{busy === 'resolve' ? 'Checking…' : 'Choose…'}</Text>
        </Pressable>
      ) : (
        <>
          <View style={styles.actionRow}>
            <Pressable
              onPress={() => run('backup', backupNowFlow)}
              disabled={busy !== null}
              style={[styles.actionBtn, styles.actionPrimary, { flex: 1 }]}
            >
              <Text style={styles.actionPrimaryText}>{busy === 'backup' ? 'Backing up…' : 'Back up now'}</Text>
            </Pressable>
            <Pressable
              onPress={() => run('restore', restoreFlow)}
              disabled={busy !== null}
              style={[styles.actionBtn, styles.actionOutline, { flex: 1 }]}
            >
              <Text style={styles.actionOutlineText}>{busy === 'restore' ? 'Loading…' : 'Restore…'}</Text>
            </Pressable>
          </View>
          <ToggleRow
            label="Automatic backup"
            value={meta?.autoBackup ?? true}
            onToggle={() => updateBackupMeta({ autoBackup: !(meta?.autoBackup ?? true) })}
            description="Backs up a minute after you change something, and when you leave the app. Your last 10 versions are kept."
          />
        </>
      )}

      <Pressable onPress={() => run('signout', signOutFlow)} disabled={busy !== null} style={styles.linkBtn}>
        <Text style={styles.linkText}>Sign out</Text>
      </Pressable>
      <Pressable onPress={() => run('delete', deleteAccountFlow)} disabled={busy !== null} style={styles.linkBtn}>
        <Text style={[styles.linkText, { color: colors.dangerText }]}>Delete account and backups</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: 16,
    marginBottom: 20
  },
  heading: { color: colors.text, ...type.bodyStrong, fontSize: 16, marginBottom: 6 },
  body: { color: colors.textSecondary, ...type.caption, marginBottom: 10 },
  strong: { color: colors.text },
  status: { color: colors.textDim, ...type.caption, marginBottom: 12 },
  statusWarn: { color: colors.gold },
  googleBtn: {
    minHeight: touchTarget,
    borderRadius: radius.pill,
    backgroundColor: '#ffffff',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingHorizontal: 18
  },
  googleBtnText: { color: '#1f1f1f', fontSize: 15, fontWeight: '600' },
  actionRow: { flexDirection: 'row', gap: 10, marginBottom: 6 },
  actionBtn: { minHeight: touchTarget, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
  actionPrimary: { backgroundColor: colors.primary },
  actionPrimaryText: { color: colors.onPrimary, fontSize: 14, fontWeight: '700' },
  actionOutline: { borderWidth: 1, borderColor: colors.textDim },
  actionOutlineText: { color: colors.text, fontSize: 14, fontWeight: '700' },
  linkBtn: { minHeight: touchTarget, justifyContent: 'center' },
  linkText: { color: colors.textDim, fontSize: 14, fontWeight: '600' }
});
