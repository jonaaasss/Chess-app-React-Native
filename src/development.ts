// Development marks: on each of your knights and bishops that is still on its
// starting square, a small pie chart at the top right of the square with
// where that piece goes in the Lichess explorer's lines from this position
// (both sides' moves by how often they are played). Colours (Jonas's codes,
// White; Black mirrored):
//   Knight: green = the normal square (Nf3, Nc3), orange = towards the centre
//           (Ne2, Nd2), red = to the edge (Nh3, Na3).
//   Bishop: green = Bb5 / Bg5, orange = Bc4 / Bf4, red = Bd3 / Be3,
//           blue = Be2 / Bd2, purple = fianchetto (Bg2 / Bb2),
//           yellow = to the edge (Ba6 / Bh6), teal = past the fianchetto
//           square (Bh3 / Ba3).
//   Grey: the piece stays (not moved within 6 of your moves).
// Lines are followed while they keep at least 5% of the games, rarer ones
// with their most played move; a line that runs out of games or of budget
// before that depth doesn't count for a piece still on its square.
// A piece's first move counts (Nd2 and then Nf3 is orange).
import { toFen } from './chess';
import { makeMove, type GameState } from './chessEngine';
import { moveForSan, type ExplorerResult } from './lichessExplorer';
import type { PieceCode } from './types';

export type DevColor = 'green' | 'orange' | 'red' | 'blue' | 'purple' | 'yellow' | 'teal' | 'grey';

// Light tones (the light arrow colours), easy to see on both square colours.
export const DEV_COLORS: Record<DevColor, string> = {
  green: '#7CDB8A',
  orange: '#F5B266',
  red: '#F27C7C',
  blue: '#7EB8F2',
  purple: '#C9A2F5',
  yellow: '#FDE68A',
  teal: '#6EE0D2',
  grey: '#CBD5E1'
};

export const DEV_COLOR_NAMES: Record<DevColor, string> = {
  green: 'green',
  orange: 'orange',
  red: 'red',
  blue: 'blue',
  purple: 'purple',
  yellow: 'yellow',
  teal: 'teal',
  grey: 'grey'
};

export interface DevSlice {
  color: DevColor;
  share: number; // of the lines where the piece's fate is known
  move?: string; // "Nf3"; none for "stays"
}

export interface DevMark {
  square: string;
  piece: PieceCode;
  slices: DevSlice[]; // largest first
  // The exceptions: an opponent move just before the piece leaves its square
  // ("!c4"; "" = at once, before the opponent moves) after which it mostly
  // goes somewhere else than usual, and where it goes then. Only opponent
  // moves in at least 5% of the piece's lines.
  after: { trigger: string; share: number; moves: { san: string; share: number; color: DevColor }[] }[];
}

const HOME: Record<'w' | 'b', Record<string, 'N' | 'B'>> = {
  w: { b1: 'N', g1: 'N', c1: 'B', f1: 'B' },
  b: { b8: 'N', g8: 'N', c8: 'B', f8: 'B' }
};

// Your knights and bishops still on their starting squares.
export function undevelopedMinors(pieces: GameState['pieces'], yourColor: 'w' | 'b'): { square: string; piece: PieceCode }[] {
  return Object.entries(HOME[yourColor])
    .filter(([sq, kind]) => pieces[sq] === `${yourColor}${kind}`)
    .map(([square, kind]) => ({ square, piece: `${yourColor}${kind}` as PieceCode }));
}

// The colour of a first move from a starting square.
export function developmentColor(piece: PieceCode, from: string, to: string): DevColor {
  const df = to.charCodeAt(0) - from.charCodeAt(0);
  const dist = Math.abs(df);
  if (piece[1] === 'N') {
    if (to[0] === 'a' || to[0] === 'h') return 'red';
    const homeRank = from[1];
    const step = Math.abs(Number(to[1]) - Number(homeRank));
    return step === 2 ? 'green' : 'orange';
  }
  // Bishop: towards the other wing (f1 → a6, c1 → h6) or towards its own
  // wing (f1 → g2 → h3, c1 → b2 → a3).
  const towardsCentre = from[0] === 'f' ? df < 0 : df > 0;
  if (towardsCentre) return (['blue', 'red', 'orange', 'green', 'yellow'] as DevColor[])[Math.min(dist, 5) - 1];
  return dist === 1 ? 'purple' : 'teal';
}

export interface DevOptions {
  minShare: number; // moves keeping at least this weight (share of the games from the position) are followed; otherwise only the most played one
  minGames: number;
  maxRequests: number;
  depth: number; // your moves: a piece that has not moved by then "stays" (grey)
}

export const DEV_OPTIONS: DevOptions = { minShare: 0.05, minGames: 20, maxRequests: 120, depth: 6 };

const memo = new Map<string, DevMark[]>();

// Where your undeveloped knights and bishops go in the explorer's lines from
// `start`. Empty when none is undeveloped or nothing is known.
export async function developmentMarks(
  start: GameState,
  yourColor: 'w' | 'b',
  fetcher: (fen: string) => Promise<ExplorerResult>,
  memoKey: string,
  cancelled?: () => boolean,
  opts: DevOptions = DEV_OPTIONS
): Promise<DevMark[]> {
  const tracked = undevelopedMinors(start.pieces, yourColor);
  if (tracked.length === 0) return [];
  const key = `${memoKey}|${yourColor}|${toFen(start.pieces, start.turn, start.castling, start.enPassant)}`;
  const hit = memo.get(key);
  if (hit) return hit;

  // Per piece (by its square): weight per destination ("" = stays).
  const tally = new Map<string, Map<string, { w: number; to: string; san: string }>>();
  const add = (sq: string, dest: string, san: string, w: number) => {
    const m = tally.get(sq) ?? new Map();
    const e = m.get(dest) ?? { w: 0, to: dest, san };
    e.w += w;
    m.set(dest, e);
    tally.set(sq, m);
  };
  // Per piece: per opponent move just before it moves, weight per destination.
  const byTrigger = new Map<string, Map<string, Map<string, { w: number; san: string }>>>();
  const addAfter = (sq: string, trigger: string, dest: string, san: string, w: number) => {
    const forPiece = byTrigger.get(sq) ?? new Map<string, Map<string, { w: number; san: string }>>();
    const forTrigger = forPiece.get(trigger) ?? new Map<string, { w: number; san: string }>();
    const e = forTrigger.get(dest) ?? { w: 0, san };
    e.w += w;
    forTrigger.set(dest, e);
    forPiece.set(trigger, forTrigger);
    byTrigger.set(sq, forPiece);
  };
  type Task = { st: GameState; weight: number; own: number; open: string[]; last: string };
  const queue: Task[] = [{ st: start, weight: 1, own: 0, open: tracked.map((t) => t.square), last: '' }];
  let requests = 0;
  // A line that reaches the depth: what is still on its square "stays". A
  // line that ends earlier (too few games, the budget) says nothing about it.
  const end = (t: Task) => {
    if (t.own >= opts.depth) for (const sq of t.open) add(sq, '', '', t.weight);
  };
  let failed = false;
  while (queue.length > 0) {
    if (cancelled?.()) return [];
    queue.sort((a, b) => b.weight - a.weight);
    const t = queue.shift()!;
    if (t.open.length === 0) continue;
    if (t.own >= opts.depth || requests >= opts.maxRequests) {
      end(t);
      continue;
    }
    requests += 1;
    let res: ExplorerResult;
    try {
      res = await fetcher(toFen(t.st.pieces, t.st.turn, t.st.castling, t.st.enPassant));
    } catch {
      failed = true;
      break;
    }
    if (cancelled?.()) return [];
    if (res.games < opts.minGames || res.moves.length === 0) {
      end(t);
      continue;
    }
    let followed = res.moves.filter((m) => m.games >= opts.minGames && (t.weight * m.games) / res.games >= opts.minShare);
    // A rarer line goes on with its most played move.
    if (followed.length === 0 && res.moves[0].games >= opts.minGames) followed = [res.moves[0]];
    if (followed.length === 0) {
      end(t);
      continue;
    }
    for (const m of followed) {
      const mv = moveForSan(t.st, m.san);
      if (!mv) continue;
      let next: GameState;
      let san = m.san;
      try {
        const r = makeMove(t.st, mv.from, mv.to, mv.promotion);
        next = r.next;
        san = r.san;
      } catch {
        continue;
      }
      const w = (t.weight * m.games) / res.games;
      const mine = t.st.turn === yourColor;
      let open = t.open;
      if (mine && open.includes(mv.from)) {
        add(mv.from, mv.to, san, w);
        addAfter(mv.from, t.last, mv.to, san, w);
        open = open.filter((sq) => sq !== mv.from);
      } else if (!mine && open.includes(mv.to)) {
        // Taken on its square before it moved: its fate is unknown.
        open = open.filter((sq) => sq !== mv.to);
      }
      queue.push({ st: next, weight: w, own: t.own + (mine ? 1 : 0), open, last: mine ? t.last : san });
    }
  }
  if (failed && tally.size === 0) return [];

  const marks: DevMark[] = [];
  for (const { square, piece } of tracked) {
    const m = tally.get(square);
    if (!m) continue;
    const total = [...m.values()].reduce((s, e) => s + e.w, 0);
    if (total <= 0) continue;
    // Slices by colour (two moves of one colour are one slice).
    const byColor = new Map<DevColor, DevSlice>();
    for (const e of m.values()) {
      const color = e.to ? developmentColor(piece, square, e.to) : 'grey';
      const s = byColor.get(color) ?? { color, share: 0, ...(e.to ? { move: e.san } : {}) };
      s.share += e.w / total;
      byColor.set(color, s);
    }
    const slices = [...byColor.values()].filter((s) => s.share >= 0.03).sort((a, b) => b.share - a.share);
    const sum = slices.reduce((s, x) => s + x.share, 0);
    // The exceptions: opponent moves after which the piece mostly goes
    // somewhere else than it usually does (`usual`: its most common
    // destination, "" = stays).
    const usual = [...m.entries()].sort((a, b) => b[1].w - a[1].w)[0]?.[0] ?? '';
    const after: DevMark['after'] = [...(byTrigger.get(square) ?? new Map<string, Map<string, { w: number; san: string }>>()).entries()]
      .map(([trigger, dests]) => {
        const w = [...dests.values()].reduce((s, e) => s + e.w, 0);
        const moves = [...dests.entries()]
          .map(([to, e]) => ({ to, san: e.san.replace(/[+#]/g, ''), share: e.w / w, color: developmentColor(piece, square, to) }))
          .filter((x) => x.share >= 0.15)
          .sort((a, b) => b.share - a.share);
        return { trigger, share: w / total, moves, top: moves[0]?.to };
      })
      .filter((x) => x.share >= 0.05 && x.moves.length > 0 && x.top !== usual)
      .map(({ trigger, share, moves }) => ({ trigger, share, moves: moves.map(({ san, share: s, color }) => ({ san, share: s, color })) }))
      .sort((a, b) => b.share - a.share)
      .slice(0, 6);
    if (sum > 0) marks.push({ square, piece, slices: slices.map((s) => ({ ...s, share: s.share / sum })), after });
  }
  if (!failed) memo.set(key, marks);
  return marks;
}

// "Knight on g1: Nf3 62% (green) · Ne2 20% (orange) · stays 18% (grey)".
export function developmentText(mark: DevMark): string {
  const name = mark.piece[1] === 'N' ? 'Knight' : 'Bishop';
  const parts = mark.slices.map((s) => `${s.move ? s.move.replace(/[+#]/g, '') : 'stays'} ${Math.round(s.share * 100)}% (${DEV_COLOR_NAMES[s.color]})`);
  const lines = mark.after.map(
    (a) => `${a.trigger ? `After !${a.trigger.replace(/[+#]/g, '')}` : 'At once'}: ${a.moves.map((m) => `${m.san} ${Math.round(m.share * 100)}%`).join(' · ')}`
  );
  return [`${name} on ${mark.square}: ${parts.join(' · ')}`, ...(lines.length ? ['', 'Exceptions:', ...lines] : [])].join('\n');
}
