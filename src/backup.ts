import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocFromServer,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc
} from 'firebase/firestore';
import { gzip, ungzip } from 'pako';
import { auth, db } from './firebase';
import { exportStoreJson, getUserDataSummary, uid as newId } from './storage';

// The cloud side of the backup. Layout in Firestore, per user:
//   users/{uid}/backups/{id}                what, when, from which phone, sizes
//                                           (+ the data itself when it's small)
//   users/{uid}/backups/{id}/chunks/{nnnn}  the data, in pieces, when it's big
// The data is the whole store as JSON, gzipped and written as base64. The
// last KEEP_BACKUPS are kept; older ones are removed after each upload.

export const KEEP_BACKUPS = 10;
// Firestore documents top out at 1 MiB: small backups sit in their own
// document, bigger ones are split.
const INLINE_MAX = 100_000;
const CHUNK_SIZE = 700_000;
const SCHEMA_VERSION = 1;

// ---------- What this phone remembers about its backups ----------
// Kept out of the store itself, so the data format is untouched (and an older
// version of the app reads the same data).

const META_KEY = 'chess-flashcards-backup-meta';

export interface BackupMeta {
  // Tells this phone's backups apart from another phone's.
  deviceId: string;
  autoBackup: boolean;
  // The account for which "what about the backup that's already there?" has
  // been settled. Nothing is uploaded automatically before that.
  resolvedUid: string | null;
  lastBackupAt: number | null;
  // What was last uploaded (or restored): nothing new to upload while the
  // data still hashes to this.
  lastBackupHash: string | null;
  lastBackupId: string | null;
  lastError: string | null;
}

let metaCache: BackupMeta | null = null;
const metaListeners = new Set<() => void>();

export async function getBackupMeta(): Promise<BackupMeta> {
  if (metaCache) return metaCache;
  const raw = await AsyncStorage.getItem(META_KEY);
  const saved = raw ? (JSON.parse(raw) as Partial<BackupMeta>) : {};
  metaCache = {
    deviceId: saved.deviceId ?? newId(),
    autoBackup: saved.autoBackup ?? true,
    resolvedUid: saved.resolvedUid ?? null,
    lastBackupAt: saved.lastBackupAt ?? null,
    lastBackupHash: saved.lastBackupHash ?? null,
    lastBackupId: saved.lastBackupId ?? null,
    lastError: saved.lastError ?? null
  };
  if (!raw) await AsyncStorage.setItem(META_KEY, JSON.stringify(metaCache));
  return metaCache;
}

export async function updateBackupMeta(patch: Partial<BackupMeta>): Promise<void> {
  metaCache = { ...(await getBackupMeta()), ...patch };
  await AsyncStorage.setItem(META_KEY, JSON.stringify(metaCache));
  metaListeners.forEach((listener) => listener());
}

export function onBackupMetaChange(listener: () => void): () => void {
  metaListeners.add(listener);
  return () => {
    metaListeners.delete(listener);
  };
}

// ---------- Small helpers ----------

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function toBase64(bytes: Uint8Array): string {
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    parts.push(
      BASE64[b0 >> 2] +
        BASE64[((b0 & 3) << 4) | (b1 >> 4)] +
        (i + 1 < bytes.length ? BASE64[((b1 & 15) << 2) | (b2 >> 6)] : '=') +
        (i + 2 < bytes.length ? BASE64[b2 & 63] : '=')
    );
  }
  return parts.join('');
}

function fromBase64(text: string): Uint8Array {
  const lookup = new Uint8Array(128);
  for (let i = 0; i < BASE64.length; i++) lookup[BASE64.charCodeAt(i)] = i;
  const padding = text.endsWith('==') ? 2 : text.endsWith('=') ? 1 : 0;
  const bytes = new Uint8Array((text.length / 4) * 3 - padding);
  let p = 0;
  for (let i = 0; i < text.length; i += 4) {
    const e0 = lookup[text.charCodeAt(i)];
    const e1 = lookup[text.charCodeAt(i + 1)];
    const e2 = lookup[text.charCodeAt(i + 2)];
    const e3 = lookup[text.charCodeAt(i + 3)];
    if (p < bytes.length) bytes[p++] = (e0 << 2) | (e1 >> 4);
    if (p < bytes.length) bytes[p++] = ((e1 & 15) << 4) | (e2 >> 2);
    if (p < bytes.length) bytes[p++] = ((e2 & 3) << 6) | e3;
  }
  return bytes;
}

// A cheap fingerprint of the data (FNV-1a plus the length), only used to see
// whether anything has changed since the last upload.
export function hashJson(json: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < json.length; i++) {
    hash ^= json.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `${(hash >>> 0).toString(16)}:${json.length}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function formatDateTime(ms: number): string {
  const d = new Date(ms);
  const two = (n: number) => String(n).padStart(2, '0');
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}, ${two(d.getHours())}:${two(d.getMinutes())}`;
}

export function formatAgo(ms: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return formatDateTime(ms);
}

export function describeError(error: unknown): string {
  const code = String((error as { code?: string } | null)?.code ?? '');
  if (code.includes('unavailable') || code.includes('network')) return 'no internet connection';
  if (code.includes('permission-denied')) return "you're not allowed to do that (are you signed in?)";
  if (code.includes('unauthenticated')) return "you're signed out";
  if (code.includes('quota')) return 'the backup service is over its free limit for today';
  if (error instanceof Error && error.message) return error.message;
  return 'something went wrong';
}

function deviceName(): string {
  return (Platform.constants as { Model?: string } | undefined)?.Model ?? 'Android phone';
}

// ---------- The cloud ----------

export interface BackupInfo {
  id: string;
  createdAtMs: number;
  deviceName: string;
  counts: { repertoires: number; openings: number; cards: number };
  hash: string;
}

function backupsPath(userId: string) {
  return collection(db, 'users', userId, 'backups');
}

const chunkId = (i: number) => String(i).padStart(4, '0');

// Reading a document from the server fails right away when there's no
// connection (writes would just wait in a queue, and never say so): a cheap
// way to find out before starting.
async function assertOnline(userId: string): Promise<void> {
  await getDocFromServer(doc(db, 'users', userId, 'meta', 'ping'));
}

async function uploadBackup(userId: string, json: string, hash: string): Promise<BackupInfo> {
  await assertOnline(userId);
  const meta = await getBackupMeta();
  const summary = await getUserDataSummary();
  const createdAtMs = Date.now();
  const id = String(createdAtMs);
  const payload = toBase64(gzip(json));
  const info: BackupInfo = {
    id,
    createdAtMs,
    deviceName: deviceName(),
    counts: { repertoires: summary.repertoires, openings: summary.openings, cards: summary.cards },
    hash
  };

  const chunks: string[] = [];
  if (payload.length > INLINE_MAX) {
    for (let i = 0; i < payload.length; i += CHUNK_SIZE) chunks.push(payload.slice(i, i + CHUNK_SIZE));
    for (let i = 0; i < chunks.length; i++) {
      await setDoc(doc(db, 'users', userId, 'backups', id, 'chunks', chunkId(i)), { data: chunks[i] });
    }
  }
  // Written last: a backup only exists once its main document does.
  await setDoc(doc(db, 'users', userId, 'backups', id), {
    createdAtMs: info.createdAtMs,
    createdAt: serverTimestamp(),
    deviceId: meta.deviceId,
    deviceName: info.deviceName,
    schemaVersion: SCHEMA_VERSION,
    counts: info.counts,
    hash: info.hash,
    chunkCount: chunks.length,
    ...(chunks.length === 0 ? { payload } : {})
  });
  return info;
}

async function deleteBackupDocument(userId: string, id: string, chunkCount: number): Promise<void> {
  for (let i = 0; i < chunkCount; i++) {
    await deleteDoc(doc(db, 'users', userId, 'backups', id, 'chunks', chunkId(i)));
  }
  await deleteDoc(doc(db, 'users', userId, 'backups', id));
}

async function pruneBackups(userId: string): Promise<void> {
  const snapshot = await getDocs(query(backupsPath(userId), orderBy('createdAtMs', 'desc'), limit(KEEP_BACKUPS + 10)));
  for (const old of snapshot.docs.slice(KEEP_BACKUPS)) {
    await deleteBackupDocument(userId, old.id, Number(old.data().chunkCount ?? 0));
  }
}

// Newest first.
export async function listBackups(userId: string): Promise<BackupInfo[]> {
  const snapshot = await getDocs(query(backupsPath(userId), orderBy('createdAtMs', 'desc'), limit(KEEP_BACKUPS)));
  return snapshot.docs.map((d) => {
    const data = d.data();
    return {
      id: d.id,
      createdAtMs: Number(data.createdAtMs ?? 0),
      deviceName: String(data.deviceName ?? 'Unknown phone'),
      counts: {
        repertoires: Number(data.counts?.repertoires ?? 0),
        openings: Number(data.counts?.openings ?? 0),
        cards: Number(data.counts?.cards ?? 0)
      },
      hash: String(data.hash ?? '')
    };
  });
}

export async function downloadBackupJson(userId: string, id: string): Promise<string> {
  const snapshot = await getDoc(doc(db, 'users', userId, 'backups', id));
  if (!snapshot.exists()) throw new Error('That backup no longer exists.');
  const data = snapshot.data();
  let payload = typeof data.payload === 'string' ? data.payload : '';
  const chunkCount = Number(data.chunkCount ?? 0);
  for (let i = 0; i < chunkCount; i++) {
    const chunk = await getDoc(doc(db, 'users', userId, 'backups', id, 'chunks', chunkId(i)));
    if (!chunk.exists()) throw new Error('This backup is incomplete.');
    payload += String(chunk.data().data);
  }
  if (!payload) throw new Error('This backup is empty.');
  return ungzip(fromBase64(payload), { toText: true });
}

export async function deleteAllBackups(userId: string): Promise<void> {
  const snapshot = await getDocs(backupsPath(userId));
  for (const backup of snapshot.docs) {
    await deleteBackupDocument(userId, backup.id, Number(backup.data().chunkCount ?? 0));
  }
}

// ---------- Making a backup ----------

export type BackupResult = 'uploaded' | 'unchanged';

let inFlight: Promise<BackupResult> | null = null;

async function runBackup(force: boolean): Promise<BackupResult> {
  const user = auth.currentUser;
  if (!user) throw new Error("You're not signed in.");
  const summary = await getUserDataSummary();
  // A phone with nothing but the example repertoire has nothing worth
  // backing up, and must never push out a real backup with it.
  if (!summary.hasUserData && !force) return 'unchanged';
  const json = await exportStoreJson();
  const hash = hashJson(json);
  const meta = await getBackupMeta();
  if (!force && meta.lastBackupHash === hash) return 'unchanged';
  try {
    const info = await uploadBackup(user.uid, json, hash);
    await updateBackupMeta({
      lastBackupAt: info.createdAtMs,
      lastBackupHash: hash,
      lastBackupId: info.id,
      lastError: null
    });
    await pruneBackups(user.uid).catch(() => {});
    return 'uploaded';
  } catch (error) {
    await updateBackupMeta({ lastError: describeError(error) });
    throw error;
  }
}

// One backup at a time: asking while one is running just waits for it.
export function backupNow(options: { force?: boolean } = {}): Promise<BackupResult> {
  if (!inFlight) {
    inFlight = runBackup(Boolean(options.force)).finally(() => {
      inFlight = null;
    });
  }
  return inFlight;
}
