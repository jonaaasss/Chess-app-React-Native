// "Generate plan" (board editor, Plan and Summary cards, and the Opening map):
// draws a plan from the Lichess opening explorer, without AI.
//
// 1. From the position the explorer tree is walked (heaviest lines first): on
//    your move the most played move (unless a nearly as popular one scores
//    clearly better), on the opponent's move every move played in at least
//    `minShare` of the games, until `depth` of your moves.
// 2. Every line carries a weight (how often it is reached). Your moves
//    played in at least `planShare` of the weight are the plan.
// 3. Colours (Jonas's convention, as in his Italian):
//    - a move you play whatever the opponent does: a light colour, by when it
//      comes (1st green, 2nd orange, 3rd red, later blue);
//    - a move that answers a THREAT of the opponent: that opponent move (dark)
//      and your answer in the SAME dark tint, so in Study the opponent's move
//      appears first and you then draw your answer. A threat (`threatens`,
//      as in Jonas's Italian and docs/IMPORT_REGELS.md): it takes something,
//      gives check, attacks one of your pieces (a trade offer too), puts a
//      piece on your half of the board, or attacks a pawn more often than it
//      is defended (!Qb3 on f7). An answer: taking back or taking the piece,
//      moving the attacked piece, answering the check, or chasing the piece;
//    - quiet opponent moves (!g3, !f4, !h3) are never reactions.
// 4. Exceptions: a threat after which a light plan move is mostly not played
//    becomes a note on that arrow (once, on the first move it changes).
// 5. Reactions: a threat (at least 10% of the games) that you answer straight
//    away with one move that is not in the plan — "If !Be3 => Bxe3".
//    The Opening map turns these into "Reactions: first move" boards.
// 6. Optional engine check of each light plan move against Stockfish's top 3.
import { squareFromIndex, squareIndex, toFen } from './chess';
import { legalMovesFrom, makeMove, type GameState } from './chessEngine';
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

export interface Move {
  from: string;
  to: string;
  promotion?: PromotionPiece;
  san: string;
}

export interface PlanReaction {
  trigger: Move;
  answer: Move;
  path: Move[]; // from the start position up to and including the trigger
  after: GameState; // the position after the trigger
  share: number; // share of the lines that reach it
}

export interface PlanResult {
  arrows: Arrow[];
  requests: number;
  lines: number;
  // "Key moves" (your light moves, in order) and "Key reactions" ("!exd5 => cxd5").
  keyMoves: string[];
  keyReactions: string[];
  // Your moves on the board (light and answers), "from+to", and their SAN.
  ownKeys: string[];
  ownSan: Record<string, string>;
  // The dark pairs: an opponent move and your answers, in one colour.
  pairs: { trigger: Move; answers: Move[]; color: ArrowColor }[];
  reactions: PlanReaction[];
  // Shown to the user when nothing could be made.
  problem?: string;
}

interface Occ extends Move {
  key: string;
  idx: number; // 1st, 2nd … move of that side in the line
}

interface SeqItem {
  occ: Occ;
  own: boolean;
  before: GameState;
  after: GameState;
}

interface Leaf {
  weight: number;
  seq: SeqItem[];
}

interface OppBranch {
  ownBefore: Set<string>;
  localShare: number; // share of the games at its own position
  move: Move;
  path: Move[];
  after: GameState;
  leaves: Leaf[];
}

const COLORS: ArrowColor[] = ['green', 'orange', 'red', 'blue'];
const DARK: Record<string, ArrowColor> = { green: 'darkGreen', orange: 'darkOrange', red: 'darkRed', blue: 'darkBlue' };

const scoreFor = (m: { white: number; draws: number; black: number }, color: 'w' | 'b') => {
  const g = m.white + m.draws + m.black;
  return g ? ((color === 'w' ? m.white : m.black) + m.draws / 2) / g : 0;
};

const attacks = (st: GameState, from: string, target: string, side: 'w' | 'b'): boolean => {
  try {
    return legalMovesFrom({ ...st, turn: side }, from).includes(target);
  } catch {
    return false;
  }
};

// The squares of `color`'s pieces that attack `square` (x-rays not counted).
function attackersOf(pieces: GameState['pieces'], square: string, color: 'w' | 'b'): string[] {
  const { file, rank } = squareIndex(square);
  const out: string[] = [];
  const at = (f: number, r: number) => {
    const sq = squareFromIndex(f, r);
    return sq ? { sq, p: pieces[sq] } : null;
  };
  const pawnDir = color === 'w' ? -1 : 1; // where an attacking pawn stands
  for (const df of [-1, 1]) {
    const c = at(file + df, rank + pawnDir);
    if (c?.p === `${color}P`) out.push(c.sq);
  }
  for (const [df, dr] of [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]]) {
    const c = at(file + df, rank + dr);
    if (c?.p === `${color}N`) out.push(c.sq);
  }
  for (let df = -1; df <= 1; df++)
    for (let dr = -1; dr <= 1; dr++) {
      if (!df && !dr) continue;
      const c = at(file + df, rank + dr);
      if (c?.p === `${color}K`) out.push(c.sq);
      const diag = df !== 0 && dr !== 0;
      for (let k = 1; k < 8; k++) {
        const s = at(file + df * k, rank + dr * k);
        if (!s) break;
        if (!s.p) continue;
        if (s.p[0] === color && (s.p[1] === 'Q' || s.p[1] === (diag ? 'B' : 'R'))) out.push(s.sq);
        break;
      }
    }
  return out;
}

// Whether the opponent move `prev` threatens something, so that an answer
// to it is a reaction worth drawing.
export function threatens(prev: SeqItem | undefined, yourColor: 'w' | 'b'): boolean {
  if (!prev || prev.own) return false;
  const opp = yourColor === 'w' ? 'b' : 'w';
  if (/[x+#]/.test(prev.occ.san)) return true; // takes something / check
  const before = prev.before.pieces;
  const after = prev.after.pieces;
  const moved = after[prev.occ.to];
  // A piece (not a pawn or the king) on your half of the board.
  const rank = Number(prev.occ.to[1]);
  if (moved && moved[1] !== 'P' && moved[1] !== 'K' && (yourColor === 'b' ? rank >= 5 : rank <= 4)) return true;
  for (const [sq, p] of Object.entries(after)) {
    if (!p || p[0] !== yourColor || p[1] === 'K') continue;
    const attackers = attackersOf(after, sq, opp);
    if (attackers.length === 0) continue;
    if (p[1] !== 'P') {
      // One of your pieces newly attacked (by the moved piece or uncovered).
      if (attackers.includes(prev.occ.to) || attackersOf(before, sq, opp).length === 0) return true;
    } else if (attackers.includes(prev.occ.to) && attackers.length > attackersOf(after, sq, yourColor).length) {
      return true; // a pawn attacked more often than it is defended
    }
  }
  return false;
}

// Whether your move `cur` answers the opponent move `prev` played just before it.
export function answers(prev: SeqItem | undefined, cur: SeqItem, yourColor: 'w' | 'b'): boolean {
  if (!prev || prev.own || !cur.own) return false;
  const opp = yourColor === 'w' ? 'b' : 'w';
  if (cur.occ.to === prev.occ.to) return true; // takes back / takes the piece that came
  if (prev.occ.san.includes('+')) return true; // answers a check
  if (attacks(cur.before, prev.occ.to, cur.occ.from, opp)) return true; // moves an attacked piece
  if (attacks(cur.after, cur.occ.to, prev.occ.to, yourColor)) return true; // chases the piece that came
  return false;
}

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
  const empty = (problem: string, lines = 0): PlanResult => ({ arrows: [], requests, lines, keyMoves: [], keyReactions: [], ownKeys: [], ownSan: {}, pairs: [], reactions: [], problem });

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

  type Task = { st: GameState; weight: number; seq: SeqItem[]; path: Move[]; ownN: number; oppN: number; out: Leaf[][] };
  const queue: Task[] = [{ st: start, weight: 1, seq: [], path: [], ownN: 0, oppN: 0, out: [] }];
  while (queue.length > 0) {
    if (cancelled?.()) break;
    queue.sort((x, y) => y.weight - x.weight);
    const t = queue.shift()!;
    const finish = () => {
      const leaf = { weight: t.weight, seq: t.seq };
      leaves.push(leaf);
      t.out.forEach((list) => list.push(leaf));
    };
    if (t.ownN >= opts.depth && t.st.turn === yourColor) {
      finish();
      continue;
    }
    const res = await explore(t.st);
    if (!res || res.games < opts.minGames || res.moves.length === 0) {
      finish();
      continue;
    }
    if (t.st.turn === yourColor) {
      const candidates = res.moves.filter((m) => m.games >= Math.max(opts.minGames, res.games * 0.15));
      let pick = candidates[0];
      for (const c of candidates.slice(1)) {
        if (c.games >= pick.games * 0.5 && scoreFor(c, yourColor) >= scoreFor(pick, yourColor) + 0.04) pick = c;
      }
      const p = pick ? play(t.st, pick.san) : null;
      if (!p) {
        finish();
        continue;
      }
      const occ: Occ = { ...p.move, key: `${p.move.from}${p.move.to}`, idx: t.ownN + 1 };
      queue.push({ ...t, st: p.next, seq: [...t.seq, { occ, own: true, before: t.st, after: p.next }], path: [...t.path, p.move], ownN: t.ownN + 1 });
      continue;
    }
    const followed = res.moves.filter((m) => m.games / res.games >= opts.minShare && m.games >= opts.minGames);
    if (followed.length === 0) {
      finish();
      continue;
    }
    for (const m of followed) {
      const p = play(t.st, m.san);
      if (!p) continue;
      const path = [...t.path, p.move];
      const branch: OppBranch = {
        ownBefore: new Set(t.seq.filter((s) => s.own).map((s) => s.occ.key)),
        localShare: m.games / res.games,
        move: p.move,
        path,
        after: p.next,
        leaves: []
      };
      branches.push(branch);
      const occ: Occ = { ...p.move, key: `${p.move.from}${p.move.to}`, idx: t.oppN + 1 };
      queue.push({
        st: p.next,
        weight: t.weight * (m.games / res.games),
        seq: [...t.seq, { occ, own: false, before: t.st, after: p.next }],
        path,
        ownN: t.ownN,
        oppN: t.oppN + 1,
        out: [...t.out, branch.leaves]
      });
    }
  }

  if (cancelled?.()) return empty('Cancelled.');
  const total = leaves.reduce((s, l) => s + l.weight, 0);
  if (total === 0 || !leaves.some((l) => l.seq.some((s) => s.own))) return empty('Too few games from this position to make a plan.', leaves.length);

  type Stat = { move: Occ; weight: number; idxSum: number };
  const tally = (own: boolean, subset: Leaf[]) => {
    const stats = new Map<string, Stat>();
    for (const l of subset) {
      const seen = new Set<string>();
      for (const s of l.seq) {
        if (s.own !== own || seen.has(s.occ.key)) continue;
        seen.add(s.occ.key);
        const st = stats.get(s.occ.key) ?? { move: s.occ, weight: 0, idxSum: 0 };
        st.weight += l.weight;
        st.idxSum += s.occ.idx * l.weight;
        stats.set(s.occ.key, st);
      }
    }
    return stats;
  };
  const weightOf = (ls: Leaf[]) => ls.reduce((s, l) => s + l.weight, 0);
  const has = (l: Leaf, key: string, own: boolean) => l.seq.some((s) => s.own === own && s.occ.key === key);
  const ownStats = tally(true, leaves);
  const oppStats = tally(false, leaves);
  const group = (s: Stat) => Math.min(COLORS.length, Math.max(1, Math.round(s.idxSum / s.weight))) - 1;

  const planOwn = [...ownStats.values()].filter((s) => s.weight / total >= opts.planShare).sort((a, b) => a.idxSum / a.weight - b.idxSum / b.weight);
  if (planOwn.length === 0) return empty('No move of yours comes back in most lines: the position is too sharp for a plan. Try a smaller depth.', leaves.length);

  // Answers: pairs (opponent move → your move). A move of yours can answer
  // different opponent moves in different lines (Bxb4 after b4, Bb4+ after
  // cxd4), so pairs are kept per opponent move.
  type Pair = { t: string; m: string; san: string; w: number };
  const pairs: Pair[] = [];
  const relWeight = new Map<string, number>(); // your move → weight where it is an answer
  for (const s of ownStats.values()) {
    if (s.weight / total < 0.1) continue;
    const byT = new Map<string, { rel: number; all: number; san: string }>();
    for (const l of leaves) {
      const i = l.seq.findIndex((x) => x.own && x.occ.key === s.move.key);
      if (i < 1 || l.seq[i - 1].own) continue;
      const e = byT.get(l.seq[i - 1].occ.key) ?? { rel: 0, all: 0, san: l.seq[i].occ.san };
      e.all += l.weight;
      if (threatens(l.seq[i - 1], yourColor) && answers(l.seq[i - 1], l.seq[i], yourColor)) e.rel += l.weight;
      byT.set(l.seq[i - 1].occ.key, e);
    }
    for (const [t, e] of byT) {
      if (e.rel / total >= 0.1 && e.rel / e.all >= 0.6) {
        pairs.push({ t, m: s.move.key, san: e.san, w: e.rel });
        relWeight.set(s.move.key, (relWeight.get(s.move.key) ?? 0) + e.rel);
      }
    }
  }
  // A plan move that is mostly an answer becomes dark; the rest stay light.
  const light = planOwn.filter((s) => (relWeight.get(s.move.key) ?? 0) / s.weight < 0.6);
  const lightKeys = new Set(light.map((s) => s.move.key));
  // At most 4 opponent moves get a pair (one colour family each): the ones
  // reached most often.
  const triggerWeight = new Map<string, number>();
  for (const p of pairs) if (!lightKeys.has(p.m)) triggerWeight.set(p.t, Math.max(triggerWeight.get(p.t) ?? 0, p.w));
  const topTriggers = new Set([...triggerWeight].sort((a, b) => b[1] - a[1]).slice(0, COLORS.length).map(([t]) => t));
  const shown = pairs.filter((p) => !lightKeys.has(p.m) && topTriggers.has(p.t));
  const answerKeys = [...new Set(shown.map((p) => p.m))];

  // Exceptions on light moves, once each; not for an opponent move that
  // already has its own dark pair.
  const exceptions = new Map<string, { trigger: string; text: string }[]>();
  const usedTriggers = new Set<string>();
  // Inside the line of a side move of the opponent that has its own pair,
  // nothing more is noted (it has its own dark colour).
  const pairTriggers = new Set(shown.map((p) => p.t).filter((t) => (oppStats.get(t)?.weight ?? 0) / total <= 0.5));
  const insidePair = (b: OppBranch) => b.path.some((m) => pairTriggers.has(`${m.from}${m.to}`));
  for (const s of light) {
    const key = s.move.key;
    const done = new Set<OppBranch>();
    for (const b of branches) {
      if (b.ownBefore.has(key) || insidePair(b)) continue;
      // Only a threat changes your plan (quiet moves like !O-O or !h3 don't).
      if (!threatens(b.leaves[0]?.seq[b.path.length - 1], yourColor)) continue;
      const w = weightOf(b.leaves);
      if (w / total < opts.minShare) continue;
      if (weightOf(b.leaves.filter((l) => has(l, key, true))) / w >= 0.5) continue;
      if ([...done].some((d) => b.leaves.every((l) => d.leaves.includes(l)))) continue;
      done.add(b);
      const id = `${b.move.san}@${[...b.ownBefore].sort().join(',')}`;
      if (usedTriggers.has(id)) continue;
      usedTriggers.add(id);
      // Only what you play after the opponent's move.
      const local = tally(true, b.leaves.map((l) => ({ weight: l.weight, seq: l.seq.slice(b.path.length) })));
      const instead = [...local.values()]
        .filter((x) => !lightKeys.has(x.move.key) && x.weight / w >= 0.6)
        .sort((a, c) => a.idxSum / a.weight - c.idxSum / c.weight)
        .map((x) => x.move.san);
      const list = exceptions.get(key) ?? [];
      list.push({ trigger: `!${b.move.san}`, text: instead.length ? instead.join(' ') : `no ${s.move.san}` });
      exceptions.set(key, list);
    }
  }

  // Reactions: an opponent move answered straight away by one move outside the plan.
  const reactions: PlanReaction[] = [];
  const pairSet = new Set(shown.map((p) => `${p.t}>${p.m}`));
  for (const b of branches) {
    const w = weightOf(b.leaves);
    if (w / total < 0.1 || b.localShare >= 0.5 || insidePair(b)) continue;
    const at = b.path.length; // index of the reply in each leaf's seq
    const replies = new Map<string, { w: number; item: SeqItem; prev: SeqItem }>();
    for (const l of b.leaves) {
      const item = l.seq[at];
      if (!item || !item.own) continue;
      const r = replies.get(item.occ.key) ?? { w: 0, item, prev: l.seq[at - 1] };
      r.w += l.weight;
      replies.set(item.occ.key, r);
    }
    const top = [...replies.values()].sort((a, c) => c.w - a.w)[0];
    if (!top || top.w / w < 0.7) continue;
    if (lightKeys.has(top.item.occ.key)) continue;
    if (pairSet.has(`${b.move.from}${b.move.to}>${top.item.occ.key}`)) continue;
    if (!threatens(top.prev, yourColor) || !answers(top.prev, top.item, yourColor)) continue;
    if (reactions.some((r) => r.trigger.san === b.move.san && r.answer.san === top.item.occ.san)) continue;
    reactions.push({ trigger: b.move, answer: top.item.occ, path: b.path, after: b.after, share: w / total });
  }
  reactions.sort((a, b) => b.share - a.share);

  // Engine check of each light plan move, in the line where it is most often played.
  const engineNotes = new Map<string, string>();
  if (engineTop) {
    let n = 0;
    for (const s of light) {
      if (cancelled?.()) break;
      n += 1;
      onProgress?.(`Engine check ${n} of ${light.length}…`);
      const heaviest = leaves.filter((l) => has(l, s.move.key, true)).sort((a, b) => b.weight - a.weight)[0];
      const st = heaviest?.seq.find((x) => x.own && x.occ.key === s.move.key)?.before;
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
  for (const s of light) {
    const notes: ArrowNotes = {};
    const exc = exceptions.get(s.move.key);
    if (exc?.length) notes.responses = exc.map((e) => ({ trigger: e.trigger, text: e.text, kind: 'exception' as const }));
    const eng = engineNotes.get(s.move.key);
    if (eng) notes.reason = eng;
    arrows.push({ from: s.move.from, to: s.move.to, color: COLORS[group(s)], ...(Object.keys(notes).length ? { notes } : {}) });
  }
  // Answers: per opponent move, its arrow and your answers in one dark tint.
  const keyReactions: string[] = [];
  const byTrigger = new Map<string, (Stat & { san: string })[]>();
  for (const p of shown) {
    const list = byTrigger.get(p.t) ?? [];
    if (!list.some((x) => x.move.key === p.m)) list.push({ ...ownStats.get(p.m)!, san: p.san });
    byTrigger.set(p.t, list);
  }
  // Each opponent move gets its own colour family: by when your answer
  // comes, moved on to the next free family when another one has it.
  const usedFamilies = new Set<number>();
  const shownPairs: PlanResult['pairs'] = [];
  const triggers = [...byTrigger].sort((a, b) => {
    const ia = Math.min(...a[1].map((m) => m.idxSum / m.weight));
    const ib = Math.min(...b[1].map((m) => m.idxSum / m.weight));
    return ia - ib;
  });
  for (const [tKey, ms] of triggers) {
    const t = oppStats.get(tKey);
    if (!t) continue;
    ms.sort((a, b) => a.idxSum / a.weight - b.idxSum / b.weight);
    let fam = group(ms[0]);
    for (let k = 0; k < COLORS.length && usedFamilies.has(fam); k++) fam = (fam + 1) % COLORS.length;
    usedFamilies.add(fam);
    const color = DARK[COLORS[fam]];
    arrows.push({ from: t.move.from, to: t.move.to, color });
    for (const m of ms) arrows.push({ from: m.move.from, to: m.move.to, color });
    const plain = (o: Move): Move => ({ from: o.from, to: o.to, promotion: o.promotion, san: o.san });
    shownPairs.push({ trigger: plain(t.move), answers: ms.map((m) => ({ ...plain(m.move), san: m.san })), color });
    keyReactions.push(`!${t.move.san} => ${ms.map((m) => m.san).join(' ')}`);
  }
  // Exceptions too, unless that opponent move already has a pair.
  const named = new Set(keyReactions.map((r) => r.split(' => ')[0]));
  for (const list of exceptions.values())
    for (const e of list) {
      if (named.has(e.trigger)) continue;
      named.add(e.trigger);
      keyReactions.push(`${e.trigger} => ${e.text}`);
    }

  return {
    arrows,
    requests,
    lines: leaves.length,
    keyMoves: light.map((s) => s.move.san),
    keyReactions,
    ownKeys: [...light.map((s) => s.move.key), ...answerKeys],
    pairs: shownPairs,
    ownSan: Object.fromEntries([...light.map((s) => [s.move.key, s.move.san]), ...shown.map((p) => [p.m, p.san])]),
    reactions
  };
}

// The description in Jonas's own form.
export function planDescription(r: PlanResult, source: string): string {
  return [
    r.keyMoves.length ? `Key moves: ${r.keyMoves.join(' ')}` : '',
    r.keyReactions.length ? `Key reactions: ${r.keyReactions.join(', ')}` : '',
    `Source: ${source}`
  ]
    .filter(Boolean)
    .join('\n');
}
