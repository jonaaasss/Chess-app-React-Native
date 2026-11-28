// Lichess cloud analysis (lichess.org/api/cloud-eval): Stockfish evaluations
// that Lichess already worked out for a position, far deeper (often depth 30
// and more) than the phone can, and instant. Generate plan asks here first
// and only runs Stockfish on the phone for a position Lichess doesn't have.
// Up to 5 best moves (else 3). One request at a time, a minute's wait on a
// 429; found answers are also kept on the phone (`lichess.cloud`, last 3000
// positions), missing ones for the session.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getLichessToken } from './lichessExplorer';
import type { PromotionPiece } from './types';

export interface CloudLine {
  from: string;
  to: string;
  promotion?: PromotionPiece;
  cp: number; // White's point of view (mate as ±100000 minus the moves to mate)
}

export interface CloudEval {
  depth: number;
  lines: CloudLine[]; // best first
}

const CACHE_KEY = 'lichess.cloud';
const CACHE_MAX = 3000;
const cache = new Map<string, CloudEval | null>();
let loaded: Promise<void> | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let queue: Promise<unknown> = Promise.resolve();

function load(): Promise<void> {
  if (!loaded) {
    loaded = AsyncStorage.getItem(CACHE_KEY)
      .then((raw) => {
        if (!raw) return;
        for (const [k, v] of JSON.parse(raw) as [string, CloudEval][]) if (!cache.has(k)) cache.set(k, v);
      })
      .catch(() => undefined);
  }
  return loaded;
}

function saveSoon() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    const found = [...cache.entries()].filter((e): e is [string, CloudEval] => e[1] !== null).slice(-CACHE_MAX);
    AsyncStorage.setItem(CACHE_KEY, JSON.stringify(found)).catch(() => undefined);
  }, 2000);
}

// The position part of a FEN (move counters left out).
const keyOf = (fen: string) => fen.split(' ').slice(0, 4).join(' ');

type Pv = { moves: string; cp?: number; mate?: number };

function toLines(pvs: Pv[]): CloudLine[] {
  const out: CloudLine[] = [];
  for (const pv of pvs) {
    const uci = pv.moves.split(' ')[0];
    if (!uci || uci.length < 4) continue;
    const cp = pv.mate !== undefined && pv.mate !== null ? (pv.mate > 0 ? 100000 - pv.mate : -100000 - pv.mate) : pv.cp;
    if (cp === undefined || cp === null) continue;
    const promo = uci[4]?.toUpperCase() as PromotionPiece | undefined;
    out.push({ from: uci.slice(0, 2), to: uci.slice(2, 4), ...(promo ? { promotion: promo } : {}), cp });
  }
  return out;
}

async function ask(fen: string, multiPv: number, token: string | null): Promise<CloudEval | null> {
  const url = `https://lichess.org/api/cloud-eval?fen=${encodeURIComponent(fen)}&multiPv=${multiPv}`;
  for (let attempt = 0; attempt < 2; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, { headers: { Accept: 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) } });
    } catch {
      return null;
    }
    if (res.status === 429) {
      await new Promise((r) => setTimeout(r, 61000));
      continue;
    }
    if (!res.ok) return null;
    try {
      const body = (await res.json()) as { depth?: number; pvs?: Pv[] };
      const lines = toLines(body.pvs ?? []);
      return lines.length ? { depth: body.depth ?? 0, lines } : null;
    } catch {
      return null;
    }
  }
  return null;
}

// Null when Lichess has no evaluation of the position (or can't be reached).
export function fetchCloudEval(fen: string): Promise<CloudEval | null> {
  const key = keyOf(fen);
  if (cache.has(key)) return Promise.resolve(cache.get(key) ?? null);
  const run = queue.then(async () => {
    await load();
    if (cache.has(key)) return cache.get(key) ?? null;
    const token = await getLichessToken();
    const got = (await ask(fen, 5, token)) ?? (await ask(fen, 3, token));
    cache.set(key, got);
    if (got) saveSoon();
    return got;
  });
  queue = run.catch(() => undefined);
  return run;
}
