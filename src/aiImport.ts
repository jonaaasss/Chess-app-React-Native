// Turns a pasted PGN into the import format by asking Gemini, then hands the
// answer to the same checker that guards the manual "Import PGN" (every move
// replayed, every arrow validated). If the checker rejects the answer, the
// problem is sent back to the model for a corrected version.
//
// TESTING ONLY: the API key is typed in once and kept on this phone. A key
// inside an app can be read by anyone who has the app, so before other people
// get it, these calls must move to a small server that holds the key.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { parseOpeningImport, type ParseResult } from './importOpening';

export type AiSide = 'White' | 'Black';

const KEY_STORAGE = 'aiImport.geminiKey';
const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models/';
// Tried in this order; the next one is used when a model stays busy or is unknown.
const MODELS = ['gemini-3.8-flash', 'gemini-3.6-flash', 'gemini-3.1-flash-lite'];
const TRIES_PER_MODEL = 3;
const FIX_ROUNDS = 2;
const REQUEST_TIMEOUT_MS = 180000;
export const MAX_PGN_CHARS = 60000;

const INSTRUCTION_LINES = [
  "You convert a chess opening study (a PGN with variations) into flashcards for a chess study app. Reply with ONE JSON object and nothing else: no markdown fences, no explanation before or after.",
  "",
  "The user studies the side named in the first line of their message (\"I play White\" or \"I play Black\"). Call that side \"my side\". If no side is named, assume White.",
  "",
  "JSON shape:",
  "{\"format\":\"chess-playbook-import\",\"version\":1,\"opening\":{\"name\":\"...\",\"summary\":\"...\"},\"cards\":[{\"name\":\"...\",\"mode\":\"plan\",\"boards\":[{\"moves\":\"e4 d5 exd5\",\"text\":\"...\",\"arrows\":[{\"from\":\"d2\",\"to\":\"d4\",\"color\":\"green\",\"notes\":{\"reason\":\"...\",\"next\":\"...\",\"responses\":[{\"trigger\":\"Nf6\",\"text\":\"...\",\"kind\":\"reaction\"}]}}],\"circles\":[{\"square\":\"e4\",\"color\":\"red\"}]}]}]}",
  "",
  "CARDS",
  "- Every card has \"mode\":\"plan\". Make one card per important decision or scenario, NOT one card per PGN variation. Example: each main reply of the opponent gets a card, and a challenging opponent move (a pin, a gambit, a trap) gets its own card that shows which move I play in which scenario.",
  "- A card has 1 to 6 boards. Board 1 is the first position; the next boards show how the scenario continues depending on the opponent's reply.",
  "- Only include standard, important replies. Skip rare sidelines.",
  "- Name a card after the opponent's key move, e.g. \"Qa5\" or \"Nf6 and !Bg4\". Put \"!\" directly before a move that is dangerous for me.",
  "",
  "BOARDS",
  "- \"moves\": all moves from the standard starting position in SAN, separated by spaces, with no move numbers, no comments and no result. Every move must be legal. Check this before you answer.",
  "- A board shows the position after \"moves\". The arrows are the moves my side should play next from that position, including follow-up moves of the same plan. A follow-up arrow may start from the square its piece will have reached.",
  "- \"text\": one or two short sentences about this scenario. Name the colours you used if that helps.",
  "- \"arrows\": 1 to 40 per board. Squares are lowercase, like \"e4\". Castling is the king moving: e1 to g1 or e1 to c1 (e8 to g8 or e8 to c8 for Black). Do not draw an arrow for the rook.",
  "- \"circles\": optional, same colours.",
  "",
  "ARROW COLOURS: \"green\", \"orange\", \"red\", \"blue\"",
  "- Use the colours in this order: green first, then orange, then red, then blue. Do not skip a colour in between.",
  "- Group moves that belong together in one colour. A move and the move it makes possible belong together, for example a bishop move that clears the way for castling goes with the castling. Moves with a different goal get a different colour.",
  "- Within one colour, list the arrows in the order they are played, because same-coloured arrows are numbered.",
  "- Use as many of the four colours as the position naturally needs.",
  "",
  "NOTES (optional, keep them short)",
  "- \"reason\": one short sentence on why this move.",
  "- \"next\": what I play afterwards.",
  "- \"responses\": the opponent's possible replies as {\"trigger\":\"Nf6\",\"text\":\"my answer\",\"kind\":\"reaction\"}. Use kind \"exception\" for a rare reply that changes the plan. \"trigger\" is a single SAN move without a move number.",
  "",
  "OPENING SUMMARY (\"opening.summary\")",
  "Plain text, one line per move of my side, lines separated by \\n. Use this exact format:",
  "PIECE => SQUARE if OPPONENT MOVES COLOUR",
  "",
  "- PIECE: NQ = queenside knight (b1/b8), NK = kingside knight (g1/g8), BB = dark-squared bishop, BW = light-squared bishop, Q = queen, R = rook, K = king. A piece's second move or later is written \"NQ later\", \"NK later\", etc.",
  "- Castling is written as K => O-O or K => O-O-O.",
  "- Only list what is typical and important for the plan. Skip the opening's first moves, pawn captures and ordinary pawn moves. Pawns: list only special pawn moves (for example h3 against a pin), written as just the move, with no piece name.",
  "- ONE line per piece and destination square. Put all scenarios that lead to the same square on that one line. If the piece goes there in every scenario, leave out \"if\" completely (never write \"always\").",
  "- \"if\" lists the opponent's moves that decide the scenario, as SAN without move numbers, separated by spaces.",
  "- Leave an empty line between different pieces (an empty line is \\n\\n).",
  "- Align the columns with spaces so every \"=>\", every \"if\" and every colour dot is directly below the previous one. Pad the piece column to 8 characters, the square column to 5 and the \"if\" column to 13.",
  "- Colour dot at the end of the line, ONLY for first moves of a knight or bishop. Knights: green dot = the central or natural development square, then orange, red, blue for the alternatives. Bishops: by the number of steps along the diagonal: 1 step = blue, 2 steps = red, 3 steps = orange, 4 or more steps = green. Use these characters: green 🟢, orange 🟠, red 🔴, blue 🔵. No dot for \"later\" moves, Q, R, K or pawns.",
  "",
  "Example for a different opening, only to show the layout:",
  "NQ       => c3                 🟢",
  "NQ later => e4    if Qa5 c6",
  "",
  "NK       => f3                 🟢",
  "NK later => e5    if Bh5",
  "",
  "BB       => d2    if Qa5       🔵",
  "",
  "BW       => b5    if Qd8 Nc6   🟢",
  "BW       => d3    if Qa5 c6    🔴",
  "",
  "Q        => e2    if Qa5 c6",
  "",
  "K        => O-O   if Qa5 c6",
  "K        => O-O-O if Bxf3",
  "",
  "            h3    if c6 or Bg4",
  "",
  "OUTPUT RULES",
  "- Valid JSON with plain straight quotes. No line breaks inside any string value except the escaped sequence \\n in the summary.",
  "- At most 60 cards, 6 boards per card, 40 arrows per board.",
  "- Before answering, replay every \"moves\" string and check that each move is legal and every arrow square is valid."
];
const INSTRUCTIONS = INSTRUCTION_LINES.join('\n');

export async function getGeminiKey(): Promise<string | null> {
  try {
    return (await AsyncStorage.getItem(KEY_STORAGE))?.trim() || null;
  } catch {
    return null;
  }
}

export async function setGeminiKey(key: string): Promise<void> {
  await AsyncStorage.setItem(KEY_STORAGE, key.trim());
}

interface Turn {
  role: 'user' | 'model';
  parts: { text: string }[];
}

class Cancelled extends Error {}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(done, ms);
    function done() {
      clearTimeout(t);
      signal.removeEventListener('abort', done);
      resolve();
    }
    signal.addEventListener('abort', done);
  });
}

async function post(model: string, key: string, turns: Turn[], signal: AbortSignal): Promise<Response> {
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  signal.addEventListener('abort', onAbort);
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(`${ENDPOINT}${model}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: INSTRUCTIONS }] },
        contents: turns,
        generationConfig: { responseMimeType: 'application/json' }
      }),
      signal: controller.signal
    });
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', onAbort);
  }
}

function errorMessage(body: unknown): string {
  const m = (body as { error?: { message?: unknown } } | null)?.error?.message;
  return typeof m === 'string' ? m : '';
}

// One answer from the model, with automatic retries and fallback models.
async function askModel(key: string, turns: Turn[], onStatus: (s: string) => void, signal: AbortSignal): Promise<string> {
  for (const model of MODELS) {
    for (let attempt = 1; attempt <= TRIES_PER_MODEL; attempt++) {
      if (signal.aborted) throw new Cancelled();
      onStatus(attempt === 1 ? `Asking ${model}…` : `${model} is busy, trying again…`);
      let res: Response;
      try {
        res = await post(model, key, turns, signal);
      } catch {
        if (signal.aborted) throw new Cancelled();
        // Timeout or no connection: try again, then move on.
        await sleep(attempt * 3000, signal);
        continue;
      }
      let body: unknown = null;
      try {
        body = await res.json();
      } catch {
        body = null;
      }
      if (res.ok) {
        const parts = (body as { candidates?: { content?: { parts?: { text?: string }[] } }[] } | null)?.candidates?.[0]?.content?.parts;
        const text = (parts ?? []).map((p) => p.text ?? '').join('');
        if (text.trim()) return text;
        await sleep(attempt * 3000, signal);
        continue;
      }
      if (res.status === 404) break; // unknown model: next one
      if (res.status === 429 || res.status >= 500) {
        await sleep(attempt * 5000, signal);
        continue;
      }
      if (res.status === 400 && /api key/i.test(errorMessage(body))) {
        throw new Error('The API key is not valid. Tap "API key" to change it.');
      }
      if (res.status === 401 || res.status === 403) {
        throw new Error('Gemini refused the API key. Tap "API key" to change it.');
      }
      throw new Error(`Gemini error ${res.status}: ${errorMessage(body) || 'unknown problem'}`);
    }
  }
  throw new Error('The AI service is too busy or not reachable right now. Check your connection and try again in a few minutes.');
}

export async function generateImportFromPgn(
  pgn: string,
  side: AiSide,
  key: string,
  onStatus: (s: string) => void,
  signal: AbortSignal
): Promise<ParseResult> {
  const turns: Turn[] = [{ role: 'user', parts: [{ text: `I play ${side}\n${pgn.trim()}` }] }];
  let lastError = '';
  try {
    for (let round = 0; round <= FIX_ROUNDS; round++) {
      const text = await askModel(key, turns, onStatus, signal);
      onStatus('Checking every move…');
      const parsed = parseOpeningImport(text);
      if (parsed.ok) return parsed;
      lastError = parsed.error;
      if (round === FIX_ROUNDS) break;
      onStatus(`Asking the AI to fix a problem (${round + 1}/${FIX_ROUNDS})…`);
      turns.push(
        { role: 'model', parts: [{ text }] },
        { role: 'user', parts: [{ text: `The app rejected your answer: ${parsed.error} Reply with the complete corrected JSON object only.` }] }
      );
    }
    return { ok: false, error: `The AI's answer did not pass the checks: ${lastError}` };
  } catch (e) {
    if (e instanceof Cancelled) return { ok: false, error: 'Cancelled.' };
    return { ok: false, error: e instanceof Error ? e.message : 'Something went wrong.' };
  }
}
