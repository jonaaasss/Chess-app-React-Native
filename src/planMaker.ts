// "Generate plan" in the board editor (Plan and Summary boards): the plan of
// a position from the Lichess opening explorer and Stockfish, without AI.
// (The Opening map keeps the older planGenerator.ts.)
//
// 1. The explorer tree is walked from the position, heaviest lines first,
//    until `depth` of your moves. On the opponent's move every move that comes
//    in at least 5% of the lines is followed (when none does, the most played
//    one). Every line carries a weight: how often it is reached.
// 2. On your move the ACCEPTABLE moves are listed: Stockfish's best moves
//    (Lichess cloud analysis, up to 5, else Stockfish on the phone, top 3)
//    and your moves with at least 5% of the games, at most 0.1 pawn
//    (`margin`) worse than Stockfish's best. Without either: the database
//    rule's move (ownMove.ts).
// 3. Two passes: the first notes in how many lines (weighted) each move is
//    acceptable (`acceptWeight`); the second plays everywhere the acceptable
//    move that is acceptable in the most lines, so one plan move is used
//    wherever it fits (c6 everywhere, not c6 here and c5 there).
// 4. The plan, turn by turn (your 1st, 2nd … move): of the moves played at
//    that turn (at least a quarter as often as the most played one) and not
//    yet in the plan, the one acceptable in the most lines.
//    A light arrow in the turn's colour (1st green, 2nd orange, 3rd red,
//    later blue).
// 5. Reactions: an opponent move just before that turn that comes in at
//    least 5% of the lines (captures too), after which you mostly play a move
//    outside the plan. That opponent move and your move are drawn in the dark
//    tint of the plan move's colour and belong to it (`Arrow.belongsTo`):
//    they stay hidden until the plan arrow's badge is tapped (board editor
//    and Study; in Study you never draw them yourself).
import { toFen } from './chess';
import { makeMove, type GameState } from './chessEngine';
import { moveForSan, type ExplorerResult } from './lichessExplorer';
import { evalText, pickOwnMove, scoreFor, uciOf } from './ownMove';
import { threatReason } from './planGenerator';
import type { Arrow, ArrowColor, PromotionPiece } from './types';

export interface MakePlanOptions {
  depth: number; // how many of your moves deep
  minShare: number; // opponent moves and reactions: share of the lines; your moves: share of the games
  margin: number; // centipawns: an acceptable move is at most this much worse than Stockfish's best
  minGames: number; // positions with fewer games are not explored further
  maxRequests: number; // explorer positions per pass
}

export const MAKE_PLAN_OPTIONS: MakePlanOptions = { depth: 4, minShare: 0.05, margin: 10, minGames: 30, maxRequests: 220 };

export interface EngineMove {
  from: string;
  to: string;
  promotion?: PromotionPiece;
  cp: number; // White's point of view (mate as ±100000 minus the moves to mate)
  source?: 'cloud' | 'phone'; // Lichess cloud analysis or Stockfish on the phone
}

// Stockfish's best lines (up to 5) in a position, optionally only among
// `searchMoves` (UCI); null when it could not answer.
export type EngineLines = (fen: string, state: GameState, searchMoves?: string[]) => Promise<EngineMove[] | null>;

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

interface SeqItem {
  occ: Occ;
  own: boolean;
  before: GameState;
  after: GameState;
  accept?: string[]; // your move: the acceptable moves there ("from+to")
}

interface Leaf {
  weight: number;
  seq: SeqItem[];
}

export interface MadePlanReaction {
  trigger: string; // "!Bxf6"
  answer: string; // "Qxf6"
  share: number; // of the lines at that turn
  reason: string; // "takes on f6", "" for a quiet move
  color: ArrowColor;
  drawn: boolean;
  // Why it is not drawn: its piece is not on that square on this board, or
  // another reaction of the same plan move already uses that move.
  skip?: string;
}

export interface MadePlanTurn {
  n: number;
  plan?: { key: string; san: string; share: number; accepted: number; color: ArrowColor };
  // Your moves at this turn, most played first: the share of the lines at
  // this turn, in how many of them it is acceptable, and after which
  // opponent moves.
  moves: { key: string; san: string; share: number; accepted: number; after: { trigger: string; share: number }[]; color?: ArrowColor }[];
  reactions: MadePlanReaction[];
}

export interface MadePlanDetails {
  lines: number;
  engine: boolean; // Stockfish judged your moves
  // Where the evaluations of your positions came from.
  evals: { cloud: number; phone: number };
  turns: MadePlanTurn[];
  // Where you play another move than the most played one, and why.
  choices: { after: string; chosen: string; instead: string; detail: string }[];
}

export interface MadePlan {
  arrows: Arrow[];
  details?: MadePlanDetails;
  lines: number;
  requests: number;
  keyMoves: string[];
  keyReactions: string[];
  problem?: string;
}

const COLORS: ArrowColor[] = ['green', 'orange', 'red', 'blue'];
const DARK: Record<string, ArrowColor> = { green: 'darkGreen', orange: 'darkOrange', red: 'darkRed', blue: 'darkBlue' };
export const turnColor = (n: number): ArrowColor => COLORS[Math.min(COLORS.length, Math.max(1, n)) - 1];

// Stockfish's answers for this session, so a second pass or a second run
// doesn't ask again.
const engineCache = new Map<string, EngineMove[]>();

async function engineLinesFor(engine: EngineLines, state: GameState, searchMoves?: string[]): Promise<EngineMove[] | null> {
  const fen = toFen(state.pieces, state.turn, state.castling, state.enPassant);
  const key = `${fen}|${searchMoves ? [...searchMoves].sort().join(',') : '*'}`;
  const hit = engineCache.get(key);
  if (hit) return hit;
  const raw = await engine(fen, state, searchMoves).catch(() => null);
  if (!raw || raw.length === 0) return null;
  // Lichess writes castling as the king taking its own rook (e8h8); the app
  // as the king's own move (e8g8).
  const got = raw.map((l) => {
    const piece = state.pieces[l.from];
    if (piece?.[1] !== 'K' || Math.abs(l.to.charCodeAt(0) - l.from.charCodeAt(0)) < 2) return l;
    return { ...l, to: `${l.to[0] === 'h' ? 'g' : l.to[0] === 'a' ? 'c' : l.to[0]}${l.to[1]}` };
  });
  engineCache.set(key, got);
  return got;
}

interface Cand {
  san: string;
  key: string;
  games: number;
}

export async function makePlan(
  start: GameState,
  yourColor: 'w' | 'b',
  fetcher: (fen: string) => Promise<ExplorerResult>,
  opts: MakePlanOptions = MAKE_PLAN_OPTIONS,
  onProgress?: (text: string) => void,
  engine?: EngineLines,
  cancelled?: () => boolean
): Promise<MadePlan> {
  let requests = 0;
  const empty = (problem: string, lines = 0): MadePlan => ({ arrows: [], lines, requests, keyMoves: [], keyReactions: [], problem });
  const forYou = (cp: number) => (yourColor === 'w' ? cp : -cp);
  const fenOf = (st: GameState) => toFen(st.pieces, st.turn, st.castling, st.enPassant);

  let passRequests = 0;
  let passLabel = 'Reading the explorer…';
  async function explore(st: GameState): Promise<ExplorerResult | null> {
    if (passRequests >= opts.maxRequests || cancelled?.()) return null;
    passRequests += 1;
    requests += 1;
    onProgress?.(`${passLabel} ${passRequests} positions`);
    return fetcher(fenOf(st));
  }

  function play(st: GameState, san: string): { next: GameState; move: Move } | null {
    const mv = moveForSan(st, san);
    if (!mv) return null;
    try {
      const r = makeMove(st, mv.from, mv.to, mv.promotion);
      return { next: r.next, move: { ...mv, san: r.san } };
    } catch {
      return null;
    }
  }

  // Your acceptable moves in a position (see the top of the file), with
  // Stockfish's evaluations (White's point of view, by "from+to").
  let usedEngine = false;
  const evalSource = new Map<string, 'cloud' | 'phone'>();
  async function acceptableMoves(st: GameState, res: ExplorerResult): Promise<{ accept: Cand[]; evals: Map<string, number>; most?: Cand; why?: string }> {
    const popular = res.moves.filter((m) => m.games >= Math.max(opts.minGames, res.games * opts.minShare));
    const keyOf = (san: string) => {
      const mv = moveForSan(st, san);
      return mv ? `${mv.from}${mv.to}` : null;
    };
    const mostKey = popular[0] ? keyOf(popular[0].san) : null;
    const most = popular[0] && mostKey ? { san: popular[0].san, key: mostKey, games: popular[0].games } : undefined;
    const evals = new Map<string, number>();
    const top = engine ? await engineLinesFor(engine, st) : null;
    if (top) {
      usedEngine = true;
      evalSource.set(fenOf(st), top[0].source ?? 'phone');
      for (const l of top) evals.set(`${l.from}${l.to}`, l.cp);
      const best = Math.max(...top.map((l) => forYou(l.cp)));
      const worstTop = Math.min(...top.map((l) => forYou(l.cp)));
      // A popular move outside the top 3 can only be acceptable when the
      // 3rd best still is; then Stockfish judges those moves too.
      const rest = popular.map((m) => ({ m, u: uciOf(st, m.san), k: keyOf(m.san) })).filter((x) => x.u && x.k && !evals.has(x.k));
      if (rest.length > 0 && top.length >= 3 && worstTop >= best - opts.margin) {
        const more = await engineLinesFor(engine!, st, rest.map((x) => x.u!));
        if (more) for (const l of more) if (!evals.has(`${l.from}${l.to}`)) evals.set(`${l.from}${l.to}`, l.cp);
      }
      const accept: Cand[] = [];
      const lineOf = new Map([...top].map((l) => [`${l.from}${l.to}`, l]));
      for (const [key, cp] of evals) {
        if (forYou(cp) < best - opts.margin) continue;
        const l = lineOf.get(key);
        let san = res.moves.find((m) => keyOf(m.san) === key)?.san;
        if (!san) {
          try {
            san = makeMove(st, key.slice(0, 2), key.slice(2, 4), l?.promotion).san;
          } catch {
            continue;
          }
        }
        const games = res.moves.find((m) => m.san === san)?.games ?? 0;
        accept.push({ san, key, games });
      }
      if (accept.length > 0) return { accept, evals, most };
    }
    // Without Stockfish: the database rule's move.
    const pick = await pickOwnMove(res, st, yourColor, opts.minGames);
    const k = pick ? keyOf(pick.move.san) : null;
    if (!pick || !k) return { accept: [], evals, most };
    const why = pick.why === 'score' && pick.alt ? `scores ${Math.round(scoreFor(pick.move, yourColor) * 100)}% vs ${Math.round(scoreFor(pick.alt, yourColor) * 100)}%` : undefined;
    return { accept: [{ san: pick.move.san, key: k, games: pick.move.games }], evals, most, why };
  }

  let leaves: Leaf[] = [];
  let choices = new Map<string, MadePlanDetails['choices'][number]>();
  const acceptWeight = new Map<string, number>(); // from pass 1
  type Task = { st: GameState; weight: number; seq: SeqItem[]; ownN: number; oppN: number };

  // False when cancelled.
  async function scan(pass: 1 | 2): Promise<boolean> {
    leaves = [];
    choices = new Map();
    passRequests = 0;
    passLabel = pass === 1 ? 'Reading the explorer and Stockfish…' : 'Making the plan consistent…';
    const planWeight = new Map<string, number>(); // pass 1: weight of the lines that already play the move
    const queue: Task[] = [{ st: start, weight: 1, seq: [], ownN: 0, oppN: 0 }];
    while (queue.length > 0) {
      if (cancelled?.()) return false;
      queue.sort((x, y) => y.weight - x.weight);
      const t = queue.shift()!;
      const finish = () => leaves.push({ weight: t.weight, seq: t.seq });
      if (t.ownN >= opts.depth && t.st.turn === yourColor) {
        finish();
        continue;
      }
      const res = await explore(t.st);
      if (cancelled?.()) return false;
      if (!res || res.games < opts.minGames || res.moves.length === 0) {
        finish();
        continue;
      }
      if (t.st.turn === yourColor) {
        const { accept, evals, most, why } = await acceptableMoves(t.st, res);
        if (cancelled?.()) return false;
        if (accept.length === 0) {
          finish();
          continue;
        }
        if (pass === 1) for (const c of accept) acceptWeight.set(c.key, (acceptWeight.get(c.key) ?? 0) + t.weight);
        const score = (c: Cand) => (pass === 1 ? planWeight : acceptWeight).get(c.key) ?? 0;
        const chosen = [...accept].sort((a, b) => score(b) - score(a) || b.games - a.games)[0];
        const fen = fenOf(t.st);
        const last = t.seq[t.seq.length - 1];
        if (most && chosen.key !== most.key && !choices.has(fen)) {
          const ev = (k: string) => evalText(evals.get(k));
          const detail = accept.some((c) => c.key === most.key)
            ? `both at most 0.1 pawn from Stockfish's best; ${chosen.san} fits more of your lines`
            : evals.size > 0
              ? evals.has(most.key)
                ? `Stockfish ${ev(chosen.key)} vs ${ev(most.key)}`
                : `Stockfish ${ev(chosen.key)}; ${most.san} is not in its top 3`
              : why ?? 'database rule';
          choices.set(fen, { after: last ? `!${last.occ.san}` : 'the start', chosen: chosen.san, instead: most.san, detail });
        }
        // The chosen move, or the next acceptable one if it can't be played here.
        let p = play(t.st, chosen.san);
        if (!p) for (const c of [...accept].sort((a, b) => score(b) - score(a) || b.games - a.games)) if ((p = play(t.st, c.san))) break;
        if (!p) {
          finish();
          continue;
        }
        const occ: Occ = { ...p.move, key: `${p.move.from}${p.move.to}`, idx: t.ownN + 1 };
        planWeight.set(occ.key, (planWeight.get(occ.key) ?? 0) + t.weight);
        const item: SeqItem = { occ, own: true, before: t.st, after: p.next, accept: accept.map((c) => c.key) };
        queue.push({ st: p.next, weight: t.weight, seq: [...t.seq, item], ownN: t.ownN + 1, oppN: t.oppN });
        continue;
      }
      // The opponent: every move in at least `minShare` of the lines, else the most played one.
      let followed = res.moves.filter((m) => m.games >= opts.minGames && (t.weight * m.games) / res.games >= opts.minShare);
      if (followed.length === 0 && res.moves[0].games >= opts.minGames) followed = [res.moves[0]];
      if (followed.length === 0) {
        finish();
        continue;
      }
      for (const m of followed) {
        const p = play(t.st, m.san);
        if (!p) continue;
        const occ: Occ = { ...p.move, key: `${p.move.from}${p.move.to}`, idx: t.oppN + 1 };
        queue.push({
          st: p.next,
          weight: (t.weight * m.games) / res.games,
          seq: [...t.seq, { occ, own: false, before: t.st, after: p.next }],
          ownN: t.ownN,
          oppN: t.oppN + 1
        });
      }
    }
    return true;
  }

  if (!(await scan(1))) return empty('Cancelled.');
  // Without Stockfish every position has one acceptable move: a second pass changes nothing.
  if (usedEngine && !(await scan(2))) return empty('Cancelled.');
  if (cancelled?.()) return empty('Cancelled.');
  if (!leaves.some((l) => l.seq.some((s) => s.own))) return empty('Too few games from this position to make a plan.', leaves.length);

  // ---------- The plan, turn by turn ----------
  type At = { leaf: Leaf; i: number };
  const atTurn = (n: number): At[] =>
    leaves.flatMap((leaf) => {
      const i = leaf.seq.findIndex((x) => x.own && x.occ.idx === n);
      return i < 0 ? [] : [{ leaf, i }];
    });
  const sum = (xs: At[]) => xs.reduce((s, x) => s + x.leaf.weight, 0);
  const planKeys: string[] = [];
  const planAt = new Map<number, { key: string; san: string; from: string; to: string; color: ArrowColor }>();
  const turnsAt = new Map<number, At[]>();
  for (let n = 1; n <= opts.depth; n++) {
    const at = atTurn(n);
    if (sum(at) === 0) break;
    turnsAt.set(n, at);
    const played = new Map<string, { item: SeqItem; w: number }>();
    for (const x of at) {
      const item = x.leaf.seq[x.i];
      const e = played.get(item.occ.key) ?? { item, w: 0 };
      e.w += x.leaf.weight;
      played.set(item.occ.key, e);
    }
    // Only moves really played at this turn (at least a quarter as often as
    // the most played one), so a move that comes here only now and then
    // doesn't take the turn of the usual one.
    const open = [...played.values()].filter((e) => !planKeys.includes(e.item.occ.key));
    const most = Math.max(0, ...open.map((e) => e.w));
    const pick = open
      .filter((e) => e.w >= most * 0.25)
      .sort((a, b) => (acceptWeight.get(b.item.occ.key) ?? 0) - (acceptWeight.get(a.item.occ.key) ?? 0) || b.w - a.w)[0];
    if (!pick) continue;
    planKeys.push(pick.item.occ.key);
    planAt.set(n, { key: pick.item.occ.key, san: pick.item.occ.san, from: pick.item.occ.from, to: pick.item.occ.to, color: turnColor(n) });
  }
  if (planAt.size === 0) return empty('No move of yours comes back in the lines: try a smaller depth.', leaves.length);
  const isPlan = (key: string) => planKeys.includes(key);

  // ---------- Reactions ----------
  type Pair = {
    n: number;
    trigger: Occ;
    answer: Occ;
    trigPiece?: string; // the pieces that move, as they stand before the move
    ansPiece?: string;
    share: number;
    reason: string;
    owner: string;
    color: ArrowColor;
  };
  const pairs: Pair[] = [];
  for (const [n, at] of turnsAt) {
    const plan = planAt.get(n);
    if (!plan) continue;
    const reach = sum(at);
    const byTrigger = new Map<string, At[]>();
    for (const x of at) {
      const prev = x.i > 0 ? x.leaf.seq[x.i - 1] : undefined;
      if (!prev || prev.own) continue;
      byTrigger.set(prev.occ.key, [...(byTrigger.get(prev.occ.key) ?? []), x]);
    }
    for (const list of byTrigger.values()) {
      const w = sum(list);
      if (w / reach < opts.minShare) continue;
      const inPlan = sum(list.filter((x) => isPlan(x.leaf.seq[x.i].occ.key)));
      if (inPlan / w >= 0.5) continue;
      const answers = new Map<string, { item: SeqItem; prev: SeqItem; w: number }>();
      for (const x of list) {
        const item = x.leaf.seq[x.i];
        if (isPlan(item.occ.key)) continue;
        const e = answers.get(item.occ.key) ?? { item, prev: x.leaf.seq[x.i - 1], w: 0 };
        e.w += x.leaf.weight;
        answers.set(item.occ.key, e);
      }
      const top = [...answers.values()].sort((a, b) => b.w - a.w)[0];
      if (!top) continue;
      if (pairs.some((p) => p.trigger.key === top.prev.occ.key && p.answer.key === top.item.occ.key)) continue;
      pairs.push({
        n,
        trigger: top.prev.occ,
        answer: top.item.occ,
        trigPiece: top.prev.before.pieces[top.prev.occ.from],
        ansPiece: top.item.before.pieces[top.item.occ.from],
        share: w / reach,
        reason: threatReason(top.prev, yourColor) ?? '',
        owner: plan.key,
        color: DARK[plan.color]
      });
    }
  }
  pairs.sort((a, b) => a.n - b.n || b.share - a.share);

  // Only what can be drawn on THIS board, one opponent move and one move of
  // yours per reaction: both pieces stand on their start squares in the board
  // position (no chains like !Nc3 then !Ne4), and per plan move each opponent
  // move and each answer is used once (heaviest first), so the numbers pair
  // them up: dark arrow 1 of the opponent goes with your dark arrow 1.
  const drawn = new Set<Pair>();
  const skipped = new Map<Pair, string>();
  for (const p of pairs) {
    if (!p.trigPiece || start.pieces[p.trigger.from] !== p.trigPiece || !p.ansPiece || start.pieces[p.answer.from] !== p.ansPiece) {
      skipped.set(p, 'not drawn: a piece is not on its square on this board');
      continue;
    }
    const same = [...drawn].find((q) => q.owner === p.owner && (q.trigger.key === p.trigger.key || q.answer.key === p.answer.key));
    if (same) {
      skipped.set(p, `not drawn: same move as !${same.trigger.san} → ${same.answer.san}`);
      continue;
    }
    drawn.add(p);
  }

  // ---------- Arrows ----------
  const arrows: Arrow[] = [];
  const seen = new Set<string>();
  const push = (a: Arrow) => {
    const id = `${a.from}${a.to}${a.color}${a.belongsTo ?? ''}`;
    if (seen.has(id)) return;
    seen.add(id);
    arrows.push(a);
  };
  for (const m of [...planAt.values()]) push({ from: m.from, to: m.to, color: m.color });
  for (const p of pairs) {
    if (!drawn.has(p)) continue;
    push({ from: p.trigger.from, to: p.trigger.to, color: p.color, belongsTo: p.owner });
    push({ from: p.answer.from, to: p.answer.to, color: p.color, belongsTo: p.owner });
  }

  // ---------- What lies behind the arrows (the Plan panel) ----------
  const turns: MadePlanTurn[] = [];
  for (const [n, at] of turnsAt) {
    const reach = sum(at);
    // In how many of the lines at this turn each move is acceptable.
    const accepted = new Map<string, number>();
    for (const x of at) for (const k of x.leaf.seq[x.i].accept ?? []) accepted.set(k, (accepted.get(k) ?? 0) + x.leaf.weight);
    const moves = new Map<string, { san: string; w: number; after: Map<string, { trigger: string; w: number }> }>();
    for (const x of at) {
      const item = x.leaf.seq[x.i];
      const m = moves.get(item.occ.key) ?? { san: item.occ.san, w: 0, after: new Map() };
      m.w += x.leaf.weight;
      const prev = x.i > 0 && !x.leaf.seq[x.i - 1].own ? x.leaf.seq[x.i - 1] : undefined;
      if (prev) {
        const a = m.after.get(prev.occ.key) ?? { trigger: `!${prev.occ.san}`, w: 0 };
        a.w += x.leaf.weight;
        m.after.set(prev.occ.key, a);
      }
      moves.set(item.occ.key, m);
    }
    const colorOf = (key: string): ArrowColor | undefined => {
      const m = [...planAt.values()].find((x) => x.key === key);
      if (m) return m.color;
      return pairs.find((p) => drawn.has(p) && p.answer.key === key)?.color;
    };
    const plan = planAt.get(n);
    turns.push({
      n,
      ...(plan
        ? { plan: { key: plan.key, san: plan.san, share: (moves.get(plan.key)?.w ?? 0) / reach, accepted: (accepted.get(plan.key) ?? 0) / reach, color: plan.color } }
        : {}),
      moves: [...moves.entries()]
        .sort((a, b) => b[1].w - a[1].w)
        .map(([key, m]) => {
          const color = colorOf(key);
          return {
            key,
            san: m.san,
            share: m.w / reach,
            accepted: (accepted.get(key) ?? 0) / reach,
            after: [...m.after.values()].sort((a, b) => b.w - a.w).map((a) => ({ trigger: a.trigger, share: a.w / reach })),
            ...(color ? { color } : {})
          };
        }),
      reactions: pairs
        .filter((p) => p.n === n)
        .map((p) => ({ trigger: `!${p.trigger.san}`, answer: p.answer.san, share: p.share, reason: p.reason, color: p.color, drawn: drawn.has(p), ...(skipped.has(p) ? { skip: skipped.get(p) } : {}) }))
    });
  }

  const keyReactions = pairs.filter((p) => drawn.has(p)).map((p) => `!${p.trigger.san} => ${p.answer.san}`);
  return {
    arrows,
    details: {
      lines: leaves.length,
      engine: usedEngine,
      evals: { cloud: [...evalSource.values()].filter((x) => x === 'cloud').length, phone: [...evalSource.values()].filter((x) => x === 'phone').length },
      turns,
      choices: [...choices.values()]
    },
    lines: leaves.length,
    requests,
    keyMoves: [...planAt.values()].map((m) => m.san),
    keyReactions
  };
}

// The description in Jonas's own form.
export function madePlanDescription(r: MadePlan, source: string): string {
  return [
    r.keyMoves.length ? `Key moves: ${r.keyMoves.join(' ')}` : '',
    r.keyReactions.length ? `Key reactions: ${r.keyReactions.join(', ')}` : '',
    `Source: ${source}`
  ]
    .filter(Boolean)
    .join('\n');
}
