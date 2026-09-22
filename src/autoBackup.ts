import { AppState } from 'react-native';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from './firebase';
import { onStoreChange } from './storage';
import { backupNow, getBackupMeta, onBackupMetaChange } from './backup';
import { configureGoogleSignIn } from './account';

// Automatic backups while signed in. What gets uploaded is decided in
// `backupNow` (nothing when the data hasn't changed since the last upload);
// this only decides *when* to try:
//  - about a minute after the last change, but not more than once per 10 minutes
//  - as soon as the app goes to the background (at least 2 minutes after the
//    previous attempt), because that's when the app may be closed for good
//  - shortly after starting, and after signing in
// A failed attempt (no internet, say) is retried a little later.
const DEBOUNCE_MS = 60_000;
const MIN_GAP_MS = 10 * 60_000;
const BACKGROUND_GAP_MS = 2 * 60_000;
const RETRY_MS = 2 * 60_000;
const MAX_RETRY_MS = 30 * 60_000;
const START_DELAY_MS = 20_000;

export function startBackupService(): () => void {
  configureGoogleSignIn();

  let dirty = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running = false;
  let failures = 0;
  let lastAttempt = 0;

  // Signed in, turned on, and the question of what to do with a backup that's
  // already there has been settled.
  async function eligible(): Promise<boolean> {
    const user = auth.currentUser;
    if (!user) return false;
    const meta = await getBackupMeta();
    return meta.autoBackup && meta.resolvedUid === user.uid;
  }

  function schedule(delay: number) {
    if (timer) clearTimeout(timer);
    timer = setTimeout(run, delay);
  }

  async function run() {
    timer = undefined;
    if (running || !dirty || !(await eligible())) return;
    running = true;
    lastAttempt = Date.now();
    try {
      await backupNow();
      dirty = false;
      failures = 0;
    } catch {
      failures += 1;
      schedule(Math.min(RETRY_MS * 2 ** (failures - 1), MAX_RETRY_MS));
    } finally {
      running = false;
    }
  }

  const stopStore = onStoreChange(() => {
    dirty = true;
    schedule(Math.max(DEBOUNCE_MS, lastAttempt + MIN_GAP_MS - Date.now()));
  });

  const stopAuth = onAuthStateChanged(auth, () => {
    dirty = true;
    schedule(START_DELAY_MS);
  });

  // Turning the automatic backup on, or settling the existing backup, starts
  // things off; the other changes to what's remembered don't.
  let metaKey = '';
  const stopMeta = onBackupMetaChange(() => {
    getBackupMeta().then((meta) => {
      const key = `${meta.autoBackup}|${meta.resolvedUid}`;
      if (key === metaKey) return;
      metaKey = key;
      dirty = true;
      schedule(5_000);
    });
  });

  const appState = AppState.addEventListener('change', (state) => {
    if (state !== 'active' && dirty && Date.now() - lastAttempt > BACKGROUND_GAP_MS) {
      if (timer) clearTimeout(timer);
      run();
    }
  });

  return () => {
    if (timer) clearTimeout(timer);
    stopStore();
    stopAuth();
    stopMeta();
    appState.remove();
  };
}
