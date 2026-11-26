// The explanations behind the (i) buttons (`HelpButton`): each topic in a
// simple and a technical version; the help window has a switch between them.
// Keep the technical texts in step with the code (planGenerator.ts,
// variationMap.ts, openingMap.ts / openingBuilder.ts, ownMove.ts).

export interface HelpTopic {
  title: string;
  simple: string;
  technical: string[];
}

export const HELP_GENERATE_PLAN: HelpTopic = {
  title: 'How Generate plan works',
  simple:
    'Looks in the Lichess database at what strong players play from this position, and asks Stockfish which of your moves are good: every move at most 0.1 pawn worse than its best counts as acceptable. Per turn the acceptable move that comes back most often is the plan: one light arrow, coloured by when it comes (green, orange, red, blue). An opponent move after which you play something else gets a dark pair in the same colour: their move and your reaction. The dark pairs are hidden: tap the small badge on a plan arrow to see them, in the board editor and in Study (in Study you never draw them yourself).',
  technical: [
    "Walks the explorer from the board's position, heaviest lines first, up to Depth of your moves (at most 220 positions per pass; a position with fewer than 30 games stops the line). Every line weighs how often it is reached.",
    'Opponent: every move that comes in at least 5% of the lines (captures too); when none does, the most played one.',
    "Your move: the acceptable moves are Stockfish's top 3 (depth 12) and your moves with at least 5% of the games, at most 0.1 pawn worse than Stockfish's best. Without Stockfish: the database rule (Your move).",
    'Two passes: the first notes in how many lines each move is acceptable; the second plays everywhere the acceptable move that is acceptable in the most lines, so one plan move is used wherever it fits.',
    'The plan per turn: of the moves played at that turn (at least a quarter as often as the most played one) and not yet in the plan, the one acceptable in the most lines.',
    'Reaction: an opponent move just before that turn, in at least 5% of the lines at that turn, after which you play a plan move in less than half of the lines. Your most played move there is the reaction; both are drawn in the dark tint of the plan move and belong to it (hidden until its badge is tapped). Only drawn when both pieces stand on their start squares on this board (or get there by a drawn move).',
    'Move by move: for your 1st, 2nd, … move (up to Depth), which move you play as a share of the lines that get that far, and after which opponent moves.'
  ]
};

export const HELP_VARIATIONS: HelpTopic = {
  title: 'How variations are found',
  simple:
    'Finds the moments where an opponent move sends your pieces (knights, bishops, queen, castling side) to other squares. Each such moment is a plan and gets its own board on the position where it starts, with all the moves from the opening\'s start. Draw the arrows with Generate plan. "Next:" is a move still to come in that plan, "Played:" one already on the board.',
  technical: [
    "Scan from the opening's start, 8 of your moves deep (at most 800 positions). Opponent moves with at least 15% there and 2% of all games, otherwise the main move.",
    'Setup of a line: where your pieces stand after your first 6 moves. A move fixes a square when at least 40% choose it, when it was chosen for its score or by Stockfish, or when it is on your board; otherwise the piece is open. Recaptures and not-yet-castled don\'t count; a piece taken within those 6 moves doesn\'t count.',
    "Lines are merged bottom-up when no piece is fixed on two different squares (fixed against open counts half); a plan's square is the one fixed in at least 60% of its games.",
    'A plan whose position comes up in fewer than 2% of the games (real share from the start) joins the most similar plan.',
    'Board position: after the opponent move where the plan leaves the closest other line, plus the moves at least 70% play.',
    'Add variations: a board\'s own plan is the most played plan through its position; a new plan through a board\'s position "Continues from board N".'
  ]
};

export const HELP_OPENING_MAP: HelpTopic = {
  title: 'How the Opening map works',
  simple:
    "Scans the Lichess database from the opening's start and proposes cards in the style of your Italian: a Summary with your plan and the opponent's main replies, a Specific line for each forcing try (captures and checks), a Reaction card when a quiet reply changes three or more of your moves, and Reactions: first move. Tick the cards you want; nothing is saved before Create.",
  technical: [
    "Scan from the opening's start, 6 of your moves deep. Your move: the shared rule (or the one you pick under Your moves); opponent moves with at least 15% of the games.",
    'At each opponent decision the followed moves get a plan signature (your moves common in the next 3 of yours); similar ones are merged. A decision with two or more groups, each at least 15% of all games, is a split (at most two levels deep).',
    "Summary at the opening's start: Generate plan from there for the light plan; for each group of the first split the opponent's move and your answer in one dark tint, linked to its card; single-move reactions as threats A, B, …",
    'Specific line (Reactions card) for a forcing group: two or more captures or checks in the first six moves; your moves and the opponent moves reached in at least 10% of all games, 4 of your moves deep.',
    'Reaction: !X (Plan card) for a quiet group that changes 3 or more of your moves; otherwise only its dark pair on the Summary.',
    'Reactions: first move: one board per single-move reaction (at most 6), and the opening summary tables (Start, Reply, Piece).'
  ]
};

export const HELP_YOUR_MOVE: HelpTopic = {
  title: 'Your move',
  simple:
    'Your move is the one most players choose, unless another popular move scores clearly better or Stockfish finds it clearly stronger. Variations and the Opening map use this rule; Generate plan uses it only when Stockfish is not ready.',
  technical: [
    'Candidates: your moves with at least 15% of the games.',
    'The most played one, unless a move played at least half as often scores at least 4 percentage points better for you.',
    'Stockfish as referee: among the moves played at least half as often as the most played, its best (depth 12, only those moves) wins when it is at least 0.5 pawn better.',
    'A move on your boards (Add variations) always wins.',
    'Database: one setting for the Explorer panel, Generate plan, Variations and the Opening map.'
  ]
};
