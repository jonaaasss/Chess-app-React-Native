import { auth } from './firebase';
import { deleteAccountAndBackups, signInWithGoogle, signOutAccount } from './account';
import {
  backupNow,
  describeError,
  downloadBackupJson,
  formatDateTime,
  hashJson,
  listBackups,
  updateBackupMeta,
  type BackupInfo
} from './backup';
import { exportStoreJson, getBeforeRestoreJson, getUserDataSummary, replaceStoreFromJson } from './storage';
import { alertDialog, choiceDialog, confirmDialog, showSnackbar, simpleMenu } from './overlay';

// The steps a person goes through in Settings, with their questions and
// messages. Everything that touches the data is in backup.ts / account.ts.

const cardCount = (n: number) => `${n} card${n === 1 ? '' : 's'}`;

async function restoreFromBackup(userId: string, info: BackupInfo): Promise<void> {
  const json = await downloadBackupJson(userId, info.id);
  await replaceStoreFromJson(json);
  // What's on the phone now is what's in that backup: nothing to upload.
  await updateBackupMeta({
    lastBackupAt: info.createdAtMs,
    lastBackupId: info.id,
    lastBackupHash: hashJson(await exportStoreJson()),
    lastError: null
  });
  showSnackbar({
    message: `Restored the backup from ${formatDateTime(info.createdAtMs)}`,
    actionLabel: 'Undo',
    onAction: async () => {
      const before = await getBeforeRestoreJson();
      if (!before) return;
      await replaceStoreFromJson(before);
      await updateBackupMeta({ lastBackupHash: null });
      showSnackbar({ message: 'Restore undone' });
    }
  });
}

// Right after signing in: what to do with a backup that's already in the
// account. Nothing is ever uploaded before this has been settled, so a new
// phone can't overwrite the good backup with an empty one.
export async function resolveInitialSync(userId: string): Promise<void> {
  try {
    const backups = await listBackups(userId);
    const latest = backups[0];
    const local = await getUserDataSummary();

    if (!latest) {
      await updateBackupMeta({ resolvedUid: userId });
      if (local.hasUserData) await backupNow({ force: true });
      return;
    }

    if (!local.hasUserData) {
      const restore = await confirmDialog(
        `Your account has a backup from ${formatDateTime(latest.createdAtMs)} (${cardCount(latest.counts.cards)}). Restore it on this phone?`,
        { confirmLabel: 'Restore', cancelLabel: 'Not now', confirmVariant: 'primary' }
      );
      if (restore) await restoreFromBackup(userId, latest);
      await updateBackupMeta({ resolvedUid: userId });
      return;
    }

    const choice = await choiceDialog<'restore' | 'keep' | 'later'>(
      `This phone has your cards (${cardCount(local.cards)}), and your account has a backup from ${formatDateTime(latest.createdAtMs)} (${cardCount(latest.counts.cards)}). Which one should be kept?`,
      [
        { label: 'Use the backup', value: 'restore', variant: 'primary' },
        { label: 'Keep this phone', value: 'keep' },
        { label: 'Decide later', value: 'later' }
      ]
    );
    if (choice === 'restore') {
      await restoreFromBackup(userId, latest);
      await updateBackupMeta({ resolvedUid: userId });
    } else if (choice === 'keep') {
      await updateBackupMeta({ resolvedUid: userId });
      await backupNow({ force: true });
      showSnackbar({ message: 'Backed up this phone. Older backups are kept.' });
    }
  } catch (error) {
    await alertDialog(`Couldn't check your backups: ${describeError(error)}. Try again from Settings.`);
  }
}

export async function signInFlow(): Promise<void> {
  try {
    const user = await signInWithGoogle();
    if (!user) return;
    await resolveInitialSync(user.uid);
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    const hint = message.includes('DEVELOPER_ERROR')
      ? " Google sign-in isn't set up for this build of the app (the app's signing key must be added in Firebase)."
      : '';
    await alertDialog(`Signing in didn't work: ${describeError(error)}.${hint}`);
  }
}

export async function signOutFlow(): Promise<void> {
  const ok = await confirmDialog(
    'Sign out? Your cards stay on this phone and your backups stay in your account.',
    { confirmLabel: 'Sign out', confirmVariant: 'primary' }
  );
  if (ok) await signOutAccount();
}

export async function backupNowFlow(): Promise<void> {
  try {
    const result = await backupNow({ force: true });
    showSnackbar({ message: result === 'uploaded' ? 'Backed up.' : 'Nothing new to back up.' });
  } catch (error) {
    await alertDialog(`The backup didn't work: ${describeError(error)}.`);
  }
}

export async function restoreFlow(): Promise<void> {
  const user = auth.currentUser;
  if (!user) return;
  try {
    const backups = await listBackups(user.uid);
    if (backups.length === 0) {
      await alertDialog('There are no backups in your account yet.');
      return;
    }
    const labels = backups.map(
      (b) => `${formatDateTime(b.createdAtMs)} · ${b.deviceName} · ${cardCount(b.counts.cards)}`
    );
    const chosen = await simpleMenu(labels, 'Restore from backup');
    if (!chosen) return;
    const info = backups[labels.indexOf(chosen)];
    const ok = await confirmDialog(
      `Replace the data on this phone with the backup from ${formatDateTime(info.createdAtMs)} (${cardCount(info.counts.cards)})? You can undo this right afterwards.`,
      { confirmLabel: 'Restore', confirmVariant: 'primary' }
    );
    if (!ok) return;
    await restoreFromBackup(user.uid, info);
  } catch (error) {
    await alertDialog(`Restoring didn't work: ${describeError(error)}.`);
  }
}

export async function deleteAccountFlow(): Promise<void> {
  const ok = await confirmDialog(
    'Delete your account and all your backups? Your cards on this phone stay. This cannot be undone.',
    { confirmLabel: 'Delete' }
  );
  if (!ok) return;
  try {
    await deleteAccountAndBackups();
    showSnackbar({ message: 'Your account and backups were deleted.' });
  } catch (error) {
    await alertDialog(`Deleting your account didn't work: ${describeError(error)}.`);
  }
}
