import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState } from 'react-native';
import { onAuthStateChanged } from 'firebase/auth';
import { collection, deleteDoc, doc, getDoc, getDocFromServer, setDoc } from 'firebase/firestore';
import { gzip, ungzip } from 'pako';
import { auth, db } from './firebase';
import { describeError, fromBase64, hashJson, toBase64 } from './backup';
import { exportStoreJson, getUserDataSummary, onStoreChange } from './storage';

// "Share my data with Claude" (Settings → Developer). Claude works in a cloud
// session without an account; with this on, a copy of the whole store sits in
// Firestore under a long secret code, so Claude can read it and open it in
// its web test build. Layout:
//   shared/{code}                   owner (uid), hash, updatedAtMs, counts,
//                                   chunkCount (+ payload when small)
//   shared/{code}/chunks/{nnnn}     the data in pieces when it's big
//   shared/{code}/fromClaude/meta   a version Claude prepared: hash, baseHash,
//                                   note, createdAtMs, chunkCount (+ payload)
//   shared/{code}/fromClaude/cnnnn  its pieces
// The data is the store as JSON, gzipped, as base64 (as in the backup).
// Firestore rules (docs/firestore.rules): whoever knows the code can read
// these documents (no listing); only the owner writes the copy; a version in
// fromClaude is only used when the owner taps "Load Claude's changes", and
// that can be undone right afterwards.

const STATE_KEY = 'claudeShare';
const INLINE_MAX = 100_000;
const CHUNK_SIZE = 700_000;
const DEBOUNCE_MS = 30_000;
const RETRY_MS = 2 * 60_000;
const START_DELAY_MS = 15_000;

export interface ShareState {
  code: string | null;
  lastSharedAt: number | null;
  // The last time the app looked for changes to share (shared or not).
  lastCheckedAt: number | null;
  lastHash: string | null;
  lastChunkCount: number;
  lastError: string | null;
}

const EMPTY: ShareState = { code: null, lastSharedAt: null, lastCheckedAt: null, lastHash: null, lastChunkCount: 0, lastError: null };

let stateCache: ShareState | null = null;
const listeners = new Set<() => void>();

export async function getShareState(): Promise<ShareState> {
  if (stateCache) return stateCache;
  const raw = await AsyncStorage.getItem(STATE_KEY);
  stateCache = { ...EMPTY, ...(raw ? (JSON.parse(raw) as Partial<ShareState>) : {}) };
  return stateCache;
}

async function updateShareState(patch: Partial<ShareState>): Promise<void> {
  stateCache = { ...(await getShareState()), ...patch };
  await AsyncStorage.setItem(STATE_KEY, JSON.stringify(stateCache));
  listeners.forEach((listener) => listener());
}

export function onShareStateChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const chunkId = (i: number) => String(i).padStart(4, '0');
const claudePart = (i: number) => `c${chunkId(i)}`;

function splitPayload(payload: string): string[] {
  const chunks: string[] = [];
  if (payload.length > INLINE_MAX) for (let i = 0; i < payload.length; i += CHUNK_SIZE) chunks.push(payload.slice(i, i + CHUNK_SIZE));
  return chunks;
}

// ---------- The shared copy ----------

let inFlight: Promise<void> | null = null;

async function upload(force: boolean): Promise<void> {
  const user = auth.currentUser;
  const state = await getShareState();
  if (!user || !state.code) return;
  const json = await exportStoreJson();
  const hash = hashJson(json);
  if (!force && hash === state.lastHash) {
    await updateShareState({ lastCheckedAt: Date.now() });
    return;
  }
  const code = state.code;
  const main = doc(db, 'shared', code);
  try {
    // Fails right away without a connection (writes would just wait).
    await getDocFromServer(main);
    const payload = toBase64(gzip(json));
    const chunks = splitPayload(payload);
    const summary = await getUserDataSummary();
    // The main document must exist before its pieces can be written.
    if (state.lastHash === null) await setDoc(main, { owner: user.uid, hash: '', chunkCount: 0, updatedAtMs: Date.now() });
    for (let i = 0; i < chunks.length; i++) await setDoc(doc(db, 'shared', code, 'chunks', chunkId(i)), { data: chunks[i], hash });
    await setDoc(main, {
      owner: user.uid,
      hash,
      updatedAtMs: Date.now(),
      counts: { repertoires: summary.repertoires, openings: summary.openings, cards: summary.cards },
      chunkCount: chunks.length,
      ...(chunks.length === 0 ? { payload } : {})
    });
    for (let i = chunks.length; i < state.lastChunkCount; i++) await deleteDoc(doc(db, 'shared', code, 'chunks', chunkId(i))).catch(() => {});
    await updateShareState({ lastSharedAt: Date.now(), lastCheckedAt: Date.now(), lastHash: hash, lastChunkCount: chunks.length, lastError: null });
  } catch (error) {
    await updateShareState({ lastError: describeError(error) });
    throw error;
  }
}

// One upload at a time; asking while one runs waits for it.
export function shareNow(options: { force?: boolean } = {}): Promise<void> {
  if (!inFlight) {
    inFlight = upload(Boolean(options.force)).finally(() => {
      inFlight = null;
    });
  }
  return inFlight;
}

// A new secret code (two Firestore ids: 40 random letters and digits).
function newCode(): string {
  return doc(collection(db, 'shared')).id + doc(collection(db, 'shared')).id;
}

export async function turnOnShare(): Promise<void> {
  if (!auth.currentUser) throw new Error('Sign in with Google first (Account & backup, at the top of Settings)');
  await updateShareState({ code: newCode(), lastSharedAt: null, lastHash: null, lastChunkCount: 0, lastError: null });
  await shareNow({ force: true });
}

// Deletes the copy (and a version Claude left); a new code is made when it is
// turned on again, so the old code stops working for good.
export async function turnOffShare(): Promise<void> {
  const state = await getShareState();
  const code = state.code;
  await updateShareState({ ...EMPTY });
  if (!code || !auth.currentUser) return;
  await deleteClaudeVersion(code).catch(() => {});
  for (let i = 0; i < state.lastChunkCount; i++) await deleteDoc(doc(db, 'shared', code, 'chunks', chunkId(i))).catch(() => {});
  await deleteDoc(doc(db, 'shared', code)).catch(() => {});
}

// While signed in and turned on: about 30 s after a change, when the app goes
// to the background, and shortly after starting; retried after a failure.
export function startClaudeShareService(): () => void {
  let dirty = true;
  let timer: ReturnType<typeof setTimeout> | undefined;

  function schedule(delay: number) {
    if (timer) clearTimeout(timer);
    timer = setTimeout(run, delay);
  }

  async function run() {
    timer = undefined;
    if (!dirty || !auth.currentUser || !(await getShareState()).code) return;
    try {
      await shareNow();
      dirty = false;
    } catch {
      schedule(RETRY_MS);
    }
  }

  const stopStore = onStoreChange(() => {
    dirty = true;
    schedule(DEBOUNCE_MS);
  });
  const stopAuth = onAuthStateChanged(auth, () => {
    dirty = true;
    schedule(START_DELAY_MS);
  });
  const appState = AppState.addEventListener('change', (s) => {
    if (s !== 'active' && dirty) {
      if (timer) clearTimeout(timer);
      run();
    }
  });
  return () => {
    if (timer) clearTimeout(timer);
    stopStore();
    stopAuth();
    appState.remove();
  };
}

// ---------- A version Claude prepared ----------

export interface ClaudeVersion {
  json: string;
  note: string;
  createdAtMs: number;
  // The data Claude started from; when the phone's data no longer hashes to
  // this, loading Claude's version would undo changes made since.
  baseHash: string;
  chunkCount: number;
}

// Whether Claude left a version to load (null: couldn't tell, e.g. offline).
export async function hasClaudeVersion(): Promise<boolean | null> {
  const code = (await getShareState()).code;
  if (!code) return false;
  try {
    return (await getDocFromServer(doc(db, 'shared', code, 'fromClaude', 'meta'))).exists();
  } catch {
    return null;
  }
}

export async function fetchClaudeVersion(): Promise<ClaudeVersion | null> {
  const code = (await getShareState()).code;
  if (!code) return null;
  const meta = await getDocFromServer(doc(db, 'shared', code, 'fromClaude', 'meta'));
  if (!meta.exists()) return null;
  const data = meta.data();
  const chunkCount = Number(data.chunkCount ?? 0);
  let payload = typeof data.payload === 'string' ? data.payload : '';
  for (let i = 0; i < chunkCount; i++) {
    const part = await getDoc(doc(db, 'shared', code, 'fromClaude', claudePart(i)));
    if (!part.exists()) throw new Error("Claude's version is incomplete.");
    payload += String(part.data().data ?? '');
  }
  if (!payload) throw new Error("Claude's version is empty.");
  const json = ungzip(fromBase64(payload), { toText: true });
  if (data.hash && hashJson(json) !== data.hash) throw new Error("Claude's version is damaged (it doesn't match its fingerprint).");
  return {
    json,
    note: String(data.note ?? ''),
    createdAtMs: Number(data.createdAtMs ?? 0),
    baseHash: String(data.baseHash ?? ''),
    chunkCount
  };
}

async function deleteClaudeVersion(code: string, chunkCount?: number): Promise<void> {
  let count = chunkCount;
  if (count === undefined) {
    const meta = await getDoc(doc(db, 'shared', code, 'fromClaude', 'meta'));
    count = meta.exists() ? Number(meta.data().chunkCount ?? 0) : 0;
  }
  await deleteDoc(doc(db, 'shared', code, 'fromClaude', 'meta'));
  for (let i = 0; i < count; i++) await deleteDoc(doc(db, 'shared', code, 'fromClaude', claudePart(i))).catch(() => {});
}

// After loading it: gone from the cloud, so it can't be loaded twice.
export async function removeClaudeVersion(version: ClaudeVersion): Promise<void> {
  const code = (await getShareState()).code;
  if (code) await deleteClaudeVersion(code, version.chunkCount);
}

export async function currentDataHash(): Promise<string> {
  return hashJson(await exportStoreJson());
}
