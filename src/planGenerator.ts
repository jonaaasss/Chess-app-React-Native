// "Generate plan" (board editor, Plan and Summary cards): draws a plan from
// the Lichess opening explorer, without AI.
//
// 1. From the position on the board the explorer tree is walked: on your
//    move the most played move (unless a nearly as popular one scores
//    clearly better), on the opponent's move every move played in at least
//    `minShare` of the games. The walk stops after `depth` of your moves, or
//    when a position has too few games.
// 2. Every line of that tree carries a weight (how often it is reached).
//    Your moves played in at least `planShare` of the weight become the
//    plan's arrows; the opponent's moves that common become dark arrows.
// 3. Colour by when the move comes on average: 1st green, 2nd orange, 3rd
//    red, 4th and later blue (Study draws one colour at a time, in any order
//    within the colour).
// 4. Exceptions: an opponent move (at least `minShare` of the games) after
//    which a plan move is mostly not played becomes a note on that arrow:
//    "if !Bg5" → what you play there instead.
// 5. Optional engine check: each plan move is looked up in Stockfish's top 3
//    in the position where it is played; if it is not there, its note says so.
import { toFen } from './chess';
import { makeMove, type GameState } from './chessEngine';
import { moveForSan, type ExplorerResult } from './lichessExplorer';
import type { Arrow, ArrowColor, ArrowNotes, PromotionPiece } from './types';

export interface PlanOptions {
  depth: number; // how many of your moves deep
  minShare: number; // an opponent move must have this share of the games to be followed
  planShare: number; // a move must be played in this share of the lines to be in the plan
  minGames: number; // positions with fewer games are not explored further
  maxRequests: number;
}

export const DEFAULT_PLAN_OPTIONS: PlanOptions = { depth: 4, minShare: 0.12, planShare: 0.6, minGames: 30, maxRequests: 160 };

export interface EngineTop {
  from: string;
  to: string;
}

export interface PlanResult {
  arrows: Arrow[];
  requests: number;
  lines: number;
  // Shown to the user when nothing could be made.
  problem?: string;
}

interface Move {
  from: string;
  to: string;
  promotion?: PromotionPiece;
  san: string;
}

interface Occ extends Move {
  key: string;
  idx: number; // 1st, 2nd … move of that side in the line
}

interface Leaf {
  weight: number;
  own: Occ[];
  opp: Occ[];
  // The state before each of your moves, by key (for the engine check).
  before: Map<string, GameState>;
}

interface OppBranch {
  // Your moves already played before this branching point.
  ownBefore: Set<string>;
  san: string;
  leaves: Leaf[];
}

const COLORS: ArrowColor[] = ['green', 'orange', 'red', 'blue'];
const DARK: Record<string, ArrowColor> = { green: 'darkGreen', orange: 'darkOrange', red: 'darkRed', blue: 'darkBlue' };

const sideOf = (st: GameState) => st.turn;
const scoreFor = (m: { white: number; draws: number; black: number }, color: 'w' | 'b') => {
  const g = m.white + m.draws + m.black;
  return g ? ((color === 'w' ? m.white : m.black) + m.draws / 2) / g : 0;
};

export async function generatePlan(
  start: GameState,
  yourColor: 'w' | 'b',
  fetcher: (fen: string) => Promise<ExplorerResult>,
  opts: PlanOptions = DEFAULT_PLAN_OPTIONS,
  onProgress?: (text: string) => void,
  engineTop?: (fen: string, turn: 'w' | 'b') => Promise<EngineTop[]>,
  cancelled?: () => boolean
): Promise<PlanResult> {
  let requests = 0;
  const leaves: Leaf[] = [];
  const branches: OppBranch[] = [];

  async function explore(st: GameState): Promise<ExplorerResult | null> {
    if (requests >= opts.maxRequests || cancelled?.()) return null;
    requests += 1;
    onProgress?.(`Reading the explorer… ${requests} positions`);
    return fetcher(toFen(st.pieces, st.turn, st.castling, st.enPassant));
  }

  function play(st: GameState, san: string): { next: GameState; move: Move } | null {
    const mv = moveForSan(st, san);
    if (!mv) return null;
    const r = makeMove(st, mv.from, mv.to, mv.promotion);
    return { next: r.next, move: { ...mv, san: r.san } };
  }

  // Walks the tree heaviest position first, so when the request budget runs
  // out it is the rarest lines that stay unexplored. Every finished line is
  // pushed to `leaves` and to the leaf lists of the branches it belongs to.
  type Task = { st: GameState; weight: number; own: Occ[]; opp: Occ[]; before: Map<string, GameState>; out: Leaf[][] };
  const queue: Task[] = [{ st: start, weight: 1, own: [], opp: [], before: new Map(), out: [] }];
  while (queue.length > 0) {
    if (cancelled?.()) break;
    queue.sort((x, y) => y.weight - x.weight);
    const { st, weight, own, opp, before, out } = queue.shift()!;
    const finish = () => {
      const leaf = { weight, own, opp, before };
      leaves.push(leaf);
      out.forEach((list) => list.push(leaf));
    };
    if (own.length >= opts.depth && sideOf(st) === yourColor) {
      finish();
      continue;
    }
    const res = await explore(st);
    if (!res || res.games < opts.minGames || res.moves.length === 0) {
      finish();
      continue;
    }
    if (sideOf(st) === yourColor) {
      const candidates = res.moves.filter((m) => m.games >= Math.max(opts.minGames, res.games * 0.15));
      let pick = candidates[0];
      for (const c of candidates.slice(1)) {
        if (c.games >= pick.games * 0.5 && scoreFor(c, yourColor) >= scoreFor(pick, yourColor) + 0.04) pick = c;
      }
      const p = pick ? play(st, pick.san) : null;
      if (!p) {
        finish();
        continue;
      }
      const key = `${p.move.from}${p.move.to}`;
      const nextBefore = new Map(before);
      if (!nextBefore.has(key)) nextBefore.set(key, st);
      queue.push({ st: p.next, weight, own: [...own, { ...p.move, key, idx: own.length + 1 }], opp, before: nextBefore, out });
      continue;
    }
    const followed = res.moves.filter((m) => m.games / res.games >= opts.minShare && m.games >= opts.minGames);
    if (followed.length === 0) {
      finish();
      continue;
    }
    for (const m of followed) {
      const p = play(st, m.san);
      if (!p) continue;
      const branch: OppBranch = { ownBefore: new Set(own.map((o) => o.key)), san: p.move.san, leaves: [] };
      branches.push(branch);
      const key = `${p.move.from}${p.move.to}`;
      queue.push({ st: p.next, weight: weight * (m.games / res.games), own, opp: [...opp, { ...p.move, key, idx: opp.length + 1 }], before, out: [...out, branch.leaves] });
    }
  }

  if (cancelled?.()) return { arrows: [], requests, lines: 0, problem: 'Cancelled.' };
  const total = leaves.reduce((s, l) => s + l.weight, 0);
  const usable = leaves.filter((l) => l.own.length > 0);
  if (total === 0 || usable.length === 0) {
    return { arrows: [], requests, lines: leaves.length, problem: 'Too few games from this position to make a plan.' };
  }

  // How often a move comes, and when on average.
  type Stat = { move: Occ; weight: number; idxSum: number };
  const tally = (pick: (l: Leaf) => Occ[], subset: Leaf[]) => {
    const stats = new Map<string, Stat>();
    for (const l of subset) {
      const seen = new Set<string>();
      for (const o of pick(l)) {
        if (seen.has(o.key)) continue;
        seen.add(o.key);
        const s = stats.get(o.key) ?? { move: o, weight: 0, idxSum: 0 };
        s.weight += l.weight;
        s.idxSum += o.idx * l.weight;
        stats.set(o.key, s);
      }
    }
    return stats;
  };
  const weightOf = (ls: Leaf[]) => ls.reduce((s, l) => s + l.weight, 0);
  const ownStats = tally((l) => l.own, leaves);
  const oppStats = tally((l) => l.opp, leaves);
  const group = (s: Stat) => Math.min(COLORS.length, Math.max(1, Math.round(s.idxSum / s.weight))) - 1;

  const planOwn = [...ownStats.values()].filter((s) => s.weight / total >= opts.planShare).sort((a, b) => a.idxSum / a.weight - b.idxSum / b.weight);
  const planOpp = [...oppStats.values()].filter((s) => s.weight / total >= opts.planShare);
  if (planOwn.length === 0) {
    return { arrows: [], requests, lines: leaves.length, problem: 'No move of yours comes back in most lines: the position is too sharp for a plan. Try a smaller depth.' };
  }
  const planKeys = new Set(planOwn.map((s) => s.move.key));

  // Exceptions: an opponent move after which the plan move mostly is not played.
  // The same exception goes only on the first plan move it changes.
  const exceptions = new Map<string, { trigger: string; text: string }[]>();
  const usedTriggers = new Set<string>();
  for (const s of planOwn) {
    const key = s.move.key;
    const done = new Set<OppBranch>();
    for (const b of branches) {
      if (b.ownBefore.has(key)) continue;
      const w = weightOf(b.leaves);
      if (w / total < opts.minShare) continue;
      const withMove = weightOf(b.leaves.filter((l) => l.own.some((o) => o.key === key)));
      if (withMove / w >= 0.5) continue;
      // Only the highest branching point where it happens.
      if ([...done].some((d) => b.leaves.every((l) => d.leaves.includes(l)))) continue;
      done.add(b);
      const local = tally((l) => l.own, b.leaves);
      const instead = [...local.values()]
        .filter((x) => !planKeys.has(x.move.key) && x.weight / w >= 0.6)
        .sort((a, c) => a.idxSum / a.weight - c.idxSum / c.weight)
        .map((x) => x.move.san);
      const trigger = `!${b.san}@${[...b.ownBefore].sort().join(',')}`;
      if (usedTriggers.has(trigger)) continue;
      usedTriggers.add(trigger);
      const list = exceptions.get(key) ?? [];
      list.push({ trigger: `!${b.san}`, text: instead.length ? instead.join(' ') : `no ${s.move.san}` });
      exceptions.set(key, list);
    }
  }

  // Engine check of each plan move, in the line where it is most often played.
  const engineNotes = new Map<string, string>();
  if (engineTop) {
    let n = 0;
    for (const s of planOwn) {
      if (cancelled?.()) break;
      n += 1;
      onProgress?.(`Engine check ${n} of ${planOwn.length}…`);
      const heaviest = leaves.filter((l) => l.before.has(s.move.key)).sort((a, b) => b.weight - a.weight)[0];
      const st = heaviest?.before.get(s.move.key);
      if (!st) continue;
      const top = await engineTop(toFen(st.pieces, st.turn, st.castling, st.enPassant), st.turn);
      if (top.length > 0 && !top.some((t) => t.from === s.move.from && t.to === s.move.to)) {
        let best = `${top[0].from}-${top[0].to}`;
        try {
          best = makeMove(st, top[0].from, top[0].to).san;
        } catch {
          // Keep the squares.
        }
        engineNotes.set(s.move.key, `Engine check: not in Stockfish's top 3 here (best: ${best})`);
      }
    }
  }

  const arrows: Arrow[] = [];
  for (const s of planOwn) {
    const notes: ArrowNotes = {};
    const exc = exceptions.get(s.move.key);
    if (exc?.length) notes.responses = exc.map((e) => ({ trigger: e.trigger, text: e.text, kind: 'exception' as const }));
    const eng = engineNotes.get(s.move.key);
    if (eng) notes.reason = eng;
    arrows.push({ from: s.move.from, to: s.move.to, color: COLORS[group(s)], ...(Object.keys(notes).length ? { notes } : {}) });
  }
  for (const s of planOpp) arrows.push({ from: s.move.from, to: s.move.to, color: DARK[COLORS[group(s)]] });
  return { arrows, requests, lines: leaves.length };
}
