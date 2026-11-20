// The Lichess opening explorer (explorer.lichess.ovh): which moves are played
// in a position, how often, and how they score. Lichess asks for a personal
// API token (no scopes needed); it is typed in once under Settings → Lichess
// and kept on this phone only (its own AsyncStorage key, not in the backup).
// One request at a time, as Lichess asks; answers are remembered for the
// rest of the session so going back and forth costs nothing.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { legalMovesFrom, makeMove, type GameState } from './chessEngine';
import type { PromotionPiece } from './types';

const TOKEN_KEY = 'lichess.token';
const DB_KEY = 'lichess.explorerDb';
export const TOKEN_PAGE = 'https://lichess.org/account/oauth/token/create?description=Chess%20Playbook%20explorer';

export type ExplorerDb = 'lichess' | 'masters';
export const DB_LABEL: Record<ExplorerDb, string> = { lichess: 'Lichess 2200–2500', masters: 'Masters' };

export interface ExplorerMove {
  san: string;
  white: number;
  draws: number;
  black: number;
  games: number;
}

export interface ExplorerResult {
  games: number;
  moves: ExplorerMove[];
}

export async function getLichessToken(): Promise<string | null> {
  try {
    return (await AsyncStorage.getItem(TOKEN_KEY))?.trim() || null;
  } catch {
    return null;
  }
}

export async function setLichessToken(token: string): Promise<void> {
  const t = token.trim();
  if (t) await AsyncStorage.setItem(TOKEN_KEY, t);
  else await AsyncStorage.removeItem(TOKEN_KEY);
  cache.clear();
}

export async function getExplorerDb(): Promise<ExplorerDb> {
  try {
    return (await AsyncStorage.getItem(DB_KEY)) === 'masters' ? 'masters' : 'lichess';
  } catch {
    return 'lichess';
  }
}

export async function setExplorerDb(db: ExplorerDb): Promise<void> {
  try {
    await AsyncStorage.setItem(DB_KEY, db);
  } catch {
    // Only a remembered preference.
  }
}

export class ExplorerError extends Error {
  constructor(message: string, readonly kind: 'noToken' | 'badToken' | 'rateLimit' | 'network' | 'other') {
    super(message);
  }
}

function urlFor(db: ExplorerDb, fen: string): string {
  const f = encodeURIComponent(fen);
  return db === 'masters'
    ? `https://explorer.lichess.ovh/masters?fen=${f}&moves=12&topGames=0`
    : `https://explorer.lichess.ovh/lichess?variant=standard&speeds=blitz,rapid,classical&ratings=2200,2500&fen=${f}&moves=12&topGames=0&recentGames=0`;
}

const cache = new Map<string, ExplorerResult>();
let queue: Promise<unknown> = Promise.resolve();

export function fetchExplorer(fen: string, db: ExplorerDb): Promise<ExplorerResult> {
  const key = `${db}|${fen}`;
  const hit = cache.get(key);
  if (hit) return Promise.resolve(hit);
  const run = queue.then(() => doFetch(key, fen, db));
  queue = run.catch(() => undefined);
  return run;
}

async function doFetch(key: string, fen: string, db: ExplorerDb): Promise<ExplorerResult> {
  const hit = cache.get(key);
  if (hit) return hit;
  const token = await getLichessToken();
  if (!token) throw new ExplorerError('Add your Lichess token in Settings → Lichess.', 'noToken');
  let res: Response;
  // Lichess answers 429 when asked too much; it asks to wait a full minute.
  for (let attempt = 0; ; attempt++) {
    try {
      res = await fetch(urlFor(db, fen), { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
    } catch {
      throw new ExplorerError('No connection to Lichess.', 'network');
    }
    if (res.status !== 429 || attempt >= 2) break;
    await new Promise((r) => setTimeout(r, 61000));
  }
  if (res.status === 401 || res.status === 403) throw new ExplorerError('Lichess refused the token. Check it in Settings → Lichess.', 'badToken');
  if (res.status === 429) throw new ExplorerError('Lichess asks to wait a minute (too many requests).', 'rateLimit');
  if (!res.ok) throw new ExplorerError(`Lichess error ${res.status}.`, 'other');
  const body = (await res.json()) as { white: number; draws: number; black: number; moves: { san: string; white: number; draws: number; black: number }[] };
  const result: ExplorerResult = {
    games: body.white + body.draws + body.black,
    moves: (body.moves ?? []).map((m) => ({ san: m.san, white: m.white, draws: m.draws, black: m.black, games: m.white + m.draws + m.black }))
  };
  cache.set(key, result);
  return result;
}

// The legal move with this SAN in this position (by the app's own SAN, so
// castling and promotions come out right), or null.
export function moveForSan(state: GameState, san: string): { from: string; to: string; promotion?: PromotionPiece } | null {
  const clean = (s: string) => s.replace(/[+#!?]/g, '');
  const want = clean(san);
  const promo = /=([QRBN])/.exec(want)?.[1] as PromotionPiece | undefined;
  for (const [from, piece] of Object.entries(state.pieces)) {
    if (!piece || piece[0] !== state.turn) continue;
    for (const to of legalMovesFrom(state, from)) {
      try {
        const isPromo = piece[1] === 'P' && (to[1] === '8' || to[1] === '1');
        const p = isPromo ? promo ?? 'Q' : undefined;
        if (clean(makeMove(state, from, to, p).san) === want) return { from, to, promotion: p };
      } catch {
        // Not a playable move after all.
      }
    }
  }
  return null;
}
