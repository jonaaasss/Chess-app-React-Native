import type { ArrowColor } from './types';

// The "Make my first card" tutorial: walks the user through creating a real
// opening and card in their own app, on the real screens, starting from the
// home screen. Each step spotlights a control (`target` is the id that
// control registered under) and moves on when the matching event is
// reported. Steps belong to a `surface`: the screen or window whose popup
// layer is allowed to show it.

export type TutorialSurface =
  | 'home'
  | 'repertoires'
  | 'openings'
  | 'cards'
  | 'prompt'
  | 'cardEditor'
  | 'boardEditor';

export interface TutorialStep {
  id: string;
  surface: TutorialSurface;
  // Registered target id to spotlight; none = centered popup.
  target?: string;
  text: string;
  sub?: string;
  // 'button' = "Got it"; otherwise the event that finishes the step.
  advance: string;
  // Skipped automatically if the flow gets to a later step's screen without
  // ever showing this one (a single repertoire skips its list).
  optional?: boolean;
  // Pre-fills the name prompt this step's button opens.
  promptPrefill?: string;
  // Board-editor steps that ask for one specific move: the editor accepts only
  // this move (piece first, then destination) and ignores everything else.
  expectMove?: { from: string; to: string };
  // Animated finger; `tap` = tap the first square then the second (moves in
  // the editor are made by tapping, not dragging).
  finger?: { from: string; to: string; tap?: boolean };
  // Board editor: keep the engine's suggestions (paneel, arrows, eval bar)
  // visible for this step; they're hidden during the rest of the tutorial.
  showEngine?: boolean;
  // Board editor: show the mode's how-it-works tip box for this step (it's
  // hidden during the rest of the tutorial).
  showTip?: boolean;
  // Leave the spotlit control touchable even though the step ends with
  // "Got it" (typing into a field, say).
  holeOpen?: boolean;
  // A tutorial flag that must be true before "Got it" works.
  requires?: string;
  // Board editor: text written into the Description field when this step
  // starts (only if it's still empty), so the suggestion is already there.
  prefillDescription?: string;
  // Board-editor steps that ask for one specific arrow: the editor accepts
  // only a drag from `from` to `to` (in this color) and ignores everything
  // else, circles included.
  expectArrow?: { from: string; to: string; color: ArrowColor };
}

// A board-editor step that waits for one exact arrow.
function drawStep(id: string, from: string, to: string, color: ArrowColor, text: string, sub?: string): TutorialStep {
  return {
    id,
    surface: 'boardEditor',
    target: 'boardEditor.board',
    text,
    sub,
    advance: 'arrowDrawn',
    expectArrow: { from, to, color },
    finger: { from, to }
  };
}

// A board-editor step that waits for one arrow color to be picked.
function pickColorStep(id: string, color: ArrowColor, text: string): TutorialStep {
  return {
    id,
    surface: 'boardEditor',
    target: `boardEditor.swatch.${color}`,
    text,
    advance: `colorPicked:${color}`
  };
}

// A board-editor step that waits for one exact move.
function moveStep(id: string, from: string, to: string, text: string, sub?: string): TutorialStep {
  return {
    id,
    surface: 'boardEditor',
    target: 'boardEditor.board',
    text,
    sub,
    advance: 'moved',
    expectMove: { from, to },
    finger: { from, to, tap: true }
  };
}

export const TUTORIAL_OPENING_NAME = 'Italian Game';
export const TUTORIAL_CARD_NAME = 'Reactions';

export const TUTORIAL_STEPS: TutorialStep[] = [
  { id: 'home.white', surface: 'home', target: 'home.white', text: 'Start here: open White.', advance: 'openGroup' },
  {
    id: 'repertoires.own',
    surface: 'repertoires',
    target: 'repertoires.own',
    text: 'Open your own repertoire.',
    sub: 'The Example Repertoire is just for looking around.',
    advance: 'openRepertoire',
    optional: true
  },
  {
    id: 'openings.add',
    surface: 'openings',
    target: 'openings.add',
    text: 'Add your first opening.',
    advance: 'addPressed',
    promptPrefill: TUTORIAL_OPENING_NAME
  },
  {
    id: 'prompt.opening',
    surface: 'prompt',
    target: 'prompt.save',
    text: `Call it "${TUTORIAL_OPENING_NAME}" and tap Save.`,
    advance: 'promptSave'
  },
  { id: 'openings.open', surface: 'openings', target: 'openings.new', text: 'Open your new opening.', advance: 'openOpening' },
  {
    id: 'cards.add',
    surface: 'cards',
    target: 'cards.add',
    text: 'Add your first card.',
    advance: 'addPressed',
    promptPrefill: TUTORIAL_CARD_NAME
  },
  {
    id: 'prompt.card',
    surface: 'prompt',
    target: 'prompt.save',
    text: `Call it "${TUTORIAL_CARD_NAME}" and tap Save.`,
    advance: 'promptSave'
  },
  {
    id: 'cardEditor.mode',
    surface: 'cardEditor',
    target: 'cardEditor.mode.reactions',
    text: 'Choose the card type: tap Reactions.',
    sub: 'A Reactions card trains how to answer your opponent\'s moves.',
    advance: 'mode:reactions'
  },
  {
    id: 'cardEditor.board',
    surface: 'cardEditor',
    target: 'cardEditor.board',
    text: 'Now tap the board to build your position.',
    advance: 'openBoardEditor'
  },
  {
    id: 'be.intro',
    surface: 'boardEditor',
    target: 'boardEditor.tip',
    text: "This is the board editor. Here's how a Reactions card is made.",
    advance: 'button',
    showTip: true
  },
  moveStep(
    'be.setup1',
    'e2',
    'e4',
    'Play e4.',
    'Set up the position your card starts from: tap the pawn, then the square it goes to.'
  ),
  moveStep('be.setup2', 'e7', 'e5', 'Now Black: play e5.'),
  moveStep('be.setup3', 'g1', 'f3', 'Play Nf3.'),
  moveStep('be.setup4', 'b8', 'c6', 'Black plays Nc6.'),
  {
    id: 'be.play',
    surface: 'boardEditor',
    target: 'boardEditor.play',
    text: 'The position is ready. Tap Play to start recording.',
    sub: 'From now on, every move you play is recorded as your line.',
    advance: 'playPressed'
  },
  {
    id: 'be.engine1',
    surface: 'boardEditor',
    target: 'boardEditor.engineMoves',
    text: "These are the engine's best moves for this position, with their evaluation.",
    sub: 'Later you can tap one to play it.',
    advance: 'button',
    showEngine: true
  },
  {
    id: 'be.engine2',
    surface: 'boardEditor',
    target: 'boardEditor.boardRow',
    text: 'The arrows on the board show these best moves. The bar next to it shows who is better.',
    sub: 'It fills white when White is better, dark when Black is.',
    advance: 'button',
    showEngine: true
  },
  moveStep('be.rec1', 'f1', 'c4', 'Now play the line you want to study: Bc4.'),
  moveStep('be.rec2', 'f8', 'c5', 'Black replies: Bc5.'),
  {
    id: 'be.back',
    surface: 'boardEditor',
    target: 'boardEditor.back',
    text: 'Tap ‹ to go one move back.',
    advance: 'backPressed'
  },
  moveStep(
    'be.var',
    'g8',
    'f6',
    'Now play a different reply: Nf6.',
    'A move that differs from the recorded one creates a variation. This is how you add variations to a card.'
  ),
  {
    id: 'be.notation',
    surface: 'boardEditor',
    target: 'boardEditor.notation',
    text: 'Both lines are listed here.',
    sub: 'Tap a move to jump to it.',
    advance: 'button'
  },
  {
    id: 'be.description',
    surface: 'boardEditor',
    target: 'boardEditor.description',
    text: 'This is the idea of this line: why you play it.',
    sub: 'You can change this text.',
    advance: 'button',
    holeOpen: true,
    requires: 'description',
    prefillDescription: 'Bc4 aims at f7 and prepares to castle quickly.'
  },
  {
    id: 'be.save',
    surface: 'boardEditor',
    target: 'boardEditor.save',
    text: 'Tap Save to keep the board.',
    advance: 'boardSaved'
  },
  {
    id: 'ce.save',
    surface: 'cardEditor',
    target: 'cardEditor.save',
    text: 'Save the card as well.',
    advance: 'cardSaved'
  },
  { id: 'cards.reactionsReady', surface: 'cards', text: 'Your Reactions card is ready! Next, a Plan card.', advance: 'button' },

  // ---- The Plan card ----
  { id: 'cards.add2', surface: 'cards', target: 'cards.add', text: 'Add another card.', advance: 'addPressed', promptPrefill: 'Plan' },
  { id: 'prompt.plan', surface: 'prompt', target: 'prompt.save', text: 'Call it "Plan" and tap Save.', advance: 'promptSave' },
  {
    id: 'cardEditor.modePlan',
    surface: 'cardEditor',
    target: 'cardEditor.mode.plan',
    text: 'Choose the card type: tap Plan.',
    sub: 'A Plan card trains the general plan in a position, not exact moves.',
    advance: 'mode:plan'
  },
  {
    id: 'cardEditor.boardPlan',
    surface: 'cardEditor',
    target: 'cardEditor.board',
    text: 'Now tap the board to build your position.',
    advance: 'openBoardEditor'
  },
  {
    id: 'bp.intro',
    surface: 'boardEditor',
    target: 'boardEditor.tip',
    text: "This is a Plan board. Here's how a Plan card is made.",
    advance: 'button',
    showTip: true
  },
  moveStep('bp.s1', 'e2', 'e4', 'Play e4.', 'Set up the position first, like before.'),
  moveStep('bp.s2', 'e7', 'e5', 'Black: e5.'),
  moveStep('bp.s3', 'g1', 'f3', 'Play Nf3.'),
  moveStep('bp.s4', 'b8', 'c6', 'Black: Nc6.'),
  moveStep('bp.s5', 'f1', 'c4', 'Play Bc4.'),
  moveStep('bp.s6', 'f8', 'c5', 'Black: Bc5.'),
  moveStep('bp.s7', 'c2', 'c3', 'Play c3.'),
  moveStep('bp.s8', 'g8', 'f6', 'Black: Nf6.'),
  {
    id: 'bp.draw',
    surface: 'boardEditor',
    target: 'boardEditor.board',
    text: 'Now draw the plan: arrows that show what you want to do here.',
    sub: "In Study you'll have to redraw them yourself.",
    advance: 'button'
  },
  pickColorStep('bp.green', 'green', 'Pick a color: tap green.'),
  drawStep('bp.a1', 'd2', 'd3', 'green', 'Drag from d2 to d3.'),
  drawStep(
    'bp.a2',
    'b1',
    'd2',
    'green',
    'Add a second green arrow: b1 to d2.',
    'Arrows of the same color get numbers: the order you draw them in.'
  ),
  pickColorStep('bp.orange', 'orange', 'Now tap orange.'),
  drawStep('bp.a3', 'e1', 'g1', 'orange', 'Castle: drag from e1 to g1.'),
  {
    id: 'bp.order',
    surface: 'boardEditor',
    target: 'boardEditor.swatches',
    text: 'In Study the colors come in this order: green, orange, red, blue.',
    sub: 'Several arrows of the same color mark moves that should be remembered together.',
    advance: 'button'
  },
  {
    id: 'bp.description',
    surface: 'boardEditor',
    target: 'boardEditor.description',
    text: 'This is the idea behind the plan: why, not what.',
    sub: 'G1 = the green arrow with number 1, G2 = the green arrow with number 2, O = the orange arrow. You can change this text.',
    advance: 'button',
    holeOpen: true,
    requires: 'description',
    prefillDescription: [
      'G1) d3 supports e4',
      'G2) the knight will later travel to f1 and g3',
      'O) castling with idea of Re1 to get the knight there'
    ].join('\n')
  },
  { id: 'bp.save', surface: 'boardEditor', target: 'boardEditor.save', text: 'Tap Save to keep the board.', advance: 'boardSaved' },
  { id: 'ce.savePlan', surface: 'cardEditor', target: 'cardEditor.save', text: 'Save the card as well.', advance: 'cardSaved' },

  // ---- The end: what to do with the finished opening ----
  {
    id: 'cards.study',
    surface: 'cards',
    target: 'cards.study',
    text: 'Both cards are ready! Tap ▶ Study this opening to practice them.',
    advance: 'button'
  },
  {
    id: 'cards.back',
    surface: 'cards',
    target: 'cards.back',
    text: 'Use the back arrows to go up a level: Openings, Repertoires, Home.',
    advance: 'button'
  }
];
