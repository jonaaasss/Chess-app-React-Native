// Which move is "yours" in a position: one rule for Generate plan, Variations
// (and Add variations) and the Opening map, so they never pick different
// moves in the same position.
//  1. Candidates: your moves played in at least 15% of the games (and at
//     least `minGames` games). None: the caller decides (no move).
//  2. Database: the most played candidate, unless one played at least half as
//     often scores at least 4 percentage points better for you.
//  3. Stockfish as referee: among the candidates played at least half as often
//     as the most played one, Stockfish's best is taken when it is at least
//     0.5 pawn better for you than the move from step 2.
// A move on one of your boards (Add variations) always wins (`yours`).
import { toFen } from './chess';
import { moveForSan, type ExplorerMove, type ExplorerResult } from './lichessExplorer';
import type { GameState } from './chessEngine';

export const OWN_MOVE_RULE = { minShare: 0.15, nearly: 0.5, betterScore: 0.04, engineMargin: 50 };

export type OwnMoveWhy = 'most' | 'score' | 'engine' | 'yours';

// Centipawns from White's point of view per move (UCI "e7e5"); a missing
// move was not evaluated. Null when the engine could not answer.
export type EngineEval = (fen: string, state: GameState, moves: string[]) => Promise<Map<string, number> | null>;

export interface OwnMovePick {
  move: ExplorerMove;
  why: OwnMoveWhy;
  // The other move worth mentioning: the most played one when another was
  // chosen, else the strongest candidate played at least half as often.
  alt?: ExplorerMove;
  // Stockfish's evaluations (White's point of view) when it was asked.
  evals?: Map<string, number>;
}

export function scoreFor(m: { white: number; draws: number; black: number }, color: 'w' | 'b'): number {
  const g = m.white + m.draws + m.black;
  return g ? ((color === 'w' ? m.white : m.black) + m.draws / 2) / g : 0;
}

export function uciOf(state: GameState, san: string): string | null {
  const mv = moveForSan(state, san);
  return mv ? `${mv.from}${mv.to}${mv.promotion ? mv.promotion.toLowerCase() : ''}` : null;
}

// Stockfish's answers for this session, so a rescan doesn't ask again.
const evalCache = new Map<string, Map<string, number>>();

export async function pickOwnMove(
  res: ExplorerResult,
  state: GameState,
  yourColor: 'w' | 'b',
  minGames: number,
  options: { yours?: string; engine?: EngineEval } = {}
): Promise<OwnMovePick | null> {
  const yours = options.yours ? res.moves.find((m) => m.san === options.yours) : undefined;
  if (yours) return { move: yours, why: 'yours', alt: res.moves.find((m) => m !== yours) };
  const candidates = res.moves.filter((m) => m.games >= Math.max(minGames, res.games * OWN_MOVE_RULE.minShare));
  if (candidates.length === 0) return null;
  const most = candidates[0];
  let pick = most;
  let why: OwnMoveWhy = 'most';
  for (const c of candidates.slice(1)) {
    if (c.games >= pick.games * OWN_MOVE_RULE.nearly && scoreFor(c, yourColor) >= scoreFor(pick, yourColor) + OWN_MOVE_RULE.betterScore) {
      pick = c;
      why = 'score';
    }
  }
  const pool = candidates.filter((c) => c.games >= most.games * OWN_MOVE_RULE.nearly);
  if (!pool.includes(pick)) pool.push(pick);
  let evals: Map<string, number> | undefined;
  if (options.engine && pool.length >= 2) {
    const ucis = pool.map((m) => uciOf(state, m.san));
    if (ucis.every((u): u is string => !!u)) {
      const fen = toFen(state.pieces, state.turn, state.castling, state.enPassant);
      const key = `${fen}|${[...ucis].sort().join(',')}`;
      let got: Map<string, number> | null | undefined = evalCache.get(key);
      if (!got) {
        got = await options.engine(fen, state, ucis as string[]).catch(() => null);
        if (got && ucis.every((u) => got!.has(u as string))) evalCache.set(key, got);
      }
      if (got) {
        evals = new Map(pool.map((m, i) => [m.san, got!.get(ucis[i] as string)]).filter((e): e is [string, number] => e[1] !== undefined));
        const forYou = (san: string) => {
          const v = evals!.get(san);
          return v === undefined ? undefined : yourColor === 'w' ? v : -v;
        };
        const best = pool.filter((m) => forYou(m.san) !== undefined).sort((a, b) => forYou(b.san)! - forYou(a.san)!)[0];
        const pickEval = forYou(pick.san);
        if (best && best !== pick && pickEval !== undefined && forYou(best.san)! >= pickEval + OWN_MOVE_RULE.engineMargin) {
          pick = best;
          why = 'engine';
        }
      }
    }
  }
  const alt = why === 'most' ? pool.filter((m) => m !== pick).sort((a, b) => b.games - a.games)[0] : most;
  return { move: pick, why, ...(alt ? { alt } : {}), ...(evals ? { evals } : {}) };
}

// The referee from a running engine (`useStockfishEngine`): one search limited
// to the candidate moves (UCI searchmoves), depth 12, at most 15 s.
type LineLike = { from: string; to: string; promotion?: string; cp: number | null; mate: number | null };
export function engineEvaluator(
  analyzeOnce: (fen: string, turn: 'w' | 'b', options: { searchMoves?: string[]; depth?: number; timeoutMs?: number }) => Promise<LineLike[]>,
  onAsk?: () => void
): EngineEval {
  return async (fen, state, moves) => {
    onAsk?.();
    const lines = await analyzeOnce(fen, state.turn, { searchMoves: moves, depth: 12, timeoutMs: 15000 });
    const out = new Map<string, number>();
    for (const l of lines) {
      const uci = `${l.from}${l.to}${l.promotion ? l.promotion.toLowerCase() : ''}`;
      const v = lineCp(l);
      if (moves.includes(uci) && v !== undefined) out.set(uci, v);
    }
    return out.size ? out : null;
  };
}

// "+0.8", "−0.6", "#3" (White's point of view, as in the board editor).
export function evalText(cp: number | undefined): string {
  if (cp === undefined) return '?';
  if (Math.abs(cp) >= 90000) return `${cp > 0 ? '' : '−'}#${100000 - Math.abs(cp)}`;
  const v = (cp / 100).toFixed(1);
  return cp > 0 ? `+${v}` : cp < 0 ? `−${v.slice(1)}` : '0.0';
}

// An engine line's value in centipawns from White's point of view (mate as
// ±100000 minus the moves to mate).
export function lineCp(line: { cp: number | null; mate: number | null }): number | undefined {
  if (line.mate !== null) return line.mate > 0 ? 100000 - line.mate : -100000 - line.mate;
  return line.cp ?? undefined;
}
