import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet, PanResponder, Switch, type PanResponderInstance } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { allSquares, faceAnnotations, flipIndex, squareFromIndex } from '../chess';
import { hasArrowNotes } from '../arrowNotes';
import { sameThreat, THREAT_COLOR, threatOfArrow, threatOfCircle, type ThreatKind } from '../threats';
import { ArrowNoteBody } from '../components/ArrowNoteBody';
import { CloseCircleButton } from '../overlay';
import { MoveText } from '../components/MoveText';
import type { Arrow, ArrowColor, Card, Circle, PieceCode, ReactionBoard } from '../types';
import { ARROW_COLOR_NAMES, ARROW_COLOR_ORDER, arrowColors, BASE_ARROW_COLORS, boardStyles, DARK_TINT, colors, radius, touchTarget } from '../theme';
import { BoardCoords, CirclesSvg, PieceGlyph, NumberedArrowsSvg, NumberedArrowBadges, arrowIsOpponent, effectiveArrowColor, isOpponentArrow, numberBadgeCenter, opponentTint, parallelOffsets, separateBadgeCenters, type NumberedArrow, type Point } from '../components/ChessBoard';
import { PIECE_ANIM_DURATION_MS } from '../components/PieceAnimation';
import type { GuideTargets } from '../components/GuideCoach';
import type { CoachEvent } from '../guideContent';
import { ArrowLinkNoteBadges, hasNoteText, pointOn } from './SummaryBoard';
import { openCardViewer } from './CardViewerOverlay';

// Same pace as ReactionStudy's opponent/preview moves, so an arrow appearing
// here and a piece sliding there feel like the same tempo.
const PREVIEW_STEP_MS = PIECE_ANIM_DURATION_MS + 300;

// How long a preview-revealed arrow sits on its own, unannounced, before its
// note popup appears — long enough to register "that's the arrow", short of
// feeling like a separate wait.
const NOTE_PREVIEW_DELAY_MS = 500;

// Drawn, not the '⏸'/'▶' text glyphs — Android renders those as colour
// emoji (inconsistently between the two), overriding whatever text color is
// set. A path always comes out exactly `color`, matching between both.
function PauseIcon({ size, color }: { size: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M6 5h4v14H6zM14 5h4v14h-4z" fill={color} />
    </Svg>
  );
}

function PlayIcon({ size, color }: { size: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M8 5v14l11-7z" fill={color} />
    </Svg>
  );
}

// A wrong arrow flashes briefly before it's removed — long enough to
// register as "that's what I drew", short enough not to block retrying.
const WRONG_ARROW_SHOW_MS = 700;
// Pause after a board's plan is fully found before moving to the next one,
// so the completed picture is visible for a moment rather than vanishing
// the instant the last arrow lands.
const BOARD_DONE_PAUSE_MS = 900;
// Pause before the opponent's (dashed) arrows of a colour appear, once the
// previous colour is complete — so it reads as "and now they play this".
const OPPONENT_ARROW_DELAY_MS = 700;

const BOARD_SIZE = 300;
const CELL = BOARD_SIZE / 8;

// The order colour groups are asked in: each colour, then its dark tint
// (see theme.ts). Unused colours are skipped.
const COLOR_CYCLE: readonly ArrowColor[] = ARROW_COLOR_ORDER;

// One colour's arrows on a board: the opponent's (dashed) arrows are drawn
// for you the moment the group comes up; your own you draw yourself.
interface ColorGroup {
  color: ArrowColor;
  auto: Arrow[];
  own: Arrow[];
}

// An arrow's Description note, as shown in the popup and in the running
// "seen so far" list below the buttons.
interface ShownNote {
  arrow: Arrow;
  number?: number;
}

const keyOf = (a: Arrow) => `${a.from}-${a.to}-${a.color}`;

// A Summary threat as studied: its arrows in order, the opponent's ones
// (`auto`) appearing by themselves, plus the circles that belong to it.
interface StudyThreat {
  kind: ThreatKind;
  letter: string;
  key: string;
  steps: { arrow: Arrow; auto: boolean }[];
  circles: Circle[];
  title: string;
}

// A colour and its dark tint form one family (light green + dark green, …).
function familyOf(c: ArrowColor): ArrowColor {
  return BASE_ARROW_COLORS.find((b) => b === c || DARK_TINT[b] === c) ?? c;
}

// A short move name for a threat chip, e.g. "Bg5" or "Nxe5".
function sanLike(a: Arrow, pieces: Partial<Record<string, PieceCode>> | undefined): string {
  const piece = pieces?.[a.from];
  const kind = piece ? piece[1] : '';
  const capture = pieces?.[a.to] ? 'x' : '';
  if (kind === 'P' || !kind) return capture ? `${a.from[0]}x${a.to}` : a.to;
  return `${kind}${capture}${a.to}`;
}

function allOwnOrdered(groups: ColorGroup[], keys: Set<string>): Arrow[] {
  return groups.flatMap((g) => g.own.filter((a) => keys.has(keyOf(a))));
}

function buildColorGroups(arrows: Arrow[], pieces: Partial<Record<string, PieceCode>> | undefined, yourColor: 'w' | 'b'): ColorGroup[] {
  return COLOR_CYCLE.map((color) => {
    const ofColor = arrows.filter((a) => a.color === color);
    return {
      color,
      auto: ofColor.filter((a) => isOpponentArrow(a.from, pieces, yourColor)),
      own: ofColor.filter((a) => !isOpponentArrow(a.from, pieces, yourColor))
    };
  }).filter((g) => g.auto.length + g.own.length > 0);
}

// The badge number an arrow shows in the board editor is its position
// within its own same-color group there (only shown once a color is used
// 2+ times) — keyed by from/to/color so a drawn arrow in Study can look up
// the exact same number instead of just numbering by the order you find
// them in, which would rarely match. Opponent arrows are numbered among
// themselves; threat arrows (Summary) get "!" and no number.
function editorArrowNumbers(arrows: Arrow[], pieces: Partial<Record<string, PieceCode>> | undefined, yourColor: 'w' | 'b'): Map<string, number> {
  const numbered = arrows.filter((a) => !threatOfArrow(a));
  const opp = numbered.filter((a) => isOpponentArrow(a.from, pieces, yourColor));
  const own = numbered.filter((a) => !isOpponentArrow(a.from, pieces, yourColor));
  const numbers = new Map<string, number>();
  for (const group of [own, opp]) numberWithinColors(group, numbers);
  return numbers;
}

function numberWithinColors(arrows: Arrow[], numbers: Map<string, number>): void {
  const countByColor: Partial<Record<ArrowColor, number>> = {};
  for (const a of arrows) countByColor[a.color] = (countByColor[a.color] ?? 0) + 1;
  const seenByColor: Partial<Record<ArrowColor, number>> = {};
  for (const a of arrows) {
    const seen = (seenByColor[a.color] = (seenByColor[a.color] ?? 0) + 1);
    if ((countByColor[a.color] ?? 0) > 1) numbers.set(keyOf(a), seen);
  }
}

// Interactive Plan (and Summary) study: the position starts bare and you
// draw the plan's arrows yourself, one colour group at a time in the fixed
// green → dark green → orange → … order. When a group comes up, its dashed
// opponent arrows appear by themselves; you draw your own (order inside a
// group doesn't matter). ‹ › take back / show one arrow, « » a whole group;
// showing counts as a slip once per arrow (never on a Summary, which isn't
// scored). Only the colour being worked on is shown unless "Show all colors" is on (and once the board is complete); the group being
// worked on. A Summary also shows link and note badges on drawn arrows.
export function PlanStudy({
  card,
  yourColor,
  boardStyle,
  onResult,
  boardRef,
  onEditBoard,
  preview,
  paused,
  onTogglePause,
  guideTargets,
  onGuideEvent
}: {
  card: Card;
  yourColor: 'w' | 'b';
  boardStyle: number;
  onResult: (correct: boolean) => void;
  boardRef?: React.MutableRefObject<ReactionBoard | null>;
  onEditBoard?: () => void;
  // Passive preview: arrows appear one at a time by themselves, same pace as
  // ReactionStudy's moves; no drawing, Continue fires itself. `paused`/
  // `onTogglePause` back the preview-only Pause/Play button.
  preview?: boolean;
  paused?: boolean;
  onTogglePause?: () => void;
  // Guide coach hooks (optional): where the popups' spotlights go, and the
  // Show solution press a popup can wait on.
  guideTargets?: GuideTargets;
  onGuideEvent?: (event: CoachEvent) => void;
}) {
  const isSummary = card.mode === 'summary';
  const boards = useMemo(() => [...card.boards].sort((a, b) => a.order - b.order), [card]);
  const [boardIdx, setBoardIdx] = useState(0);
  // Your own arrows found so far, in the order found (shown solutions included).
  const [found, setFound] = useState<Arrow[]>([]);
  // Arrows already shown with › or » — each costs a slip only the first time.
  const revealedRef = useRef<Set<string>>(new Set());
  const [wrongArrow, setWrongArrow] = useState<{ from: string; to: string } | null>(null);
  const [mistakes, setMistakes] = useState(0);
  const [allDone, setAllDone] = useState(false);
  const [tempArrow, setTempArrow] = useState<{ from: string; to: string } | null>(null);
  // Off: only the arrows and circles of the colour being worked on are shown.
  const [showAll, setShowAll] = useState(false);
  // The last colour group whose opponent arrows are on the board already.
  const [autoShownGroup, setAutoShownGroup] = useState(-1);
  // Summary: the threat being studied (its letter) and your answers found so far.
  const [threatMode, setThreatMode] = useState<string | null>(null); // "opp:A" / "mine:A"
  const [threatFound, setThreatFound] = useState(0);

  // Plan: an arrow's notes pop up the moment it is found and must be
  // dismissed (Got it) before going on. Summary: notes open from the orange
  // badge instead (`summaryNote`), and links from the link badge.
  const [pendingNote, setPendingNote] = useState<ShownNote | null>(null);
  const [shownNotes, setShownNotes] = useState<ShownNote[]>([]);
  const [summaryNote, setSummaryNote] = useState<Arrow | null>(null);
  const containerRef = useRef<View>(null);
  const noteDelayRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function dismissNote() {
    if (!pendingNote) return;
    setShownNotes((prev) => [...prev, pendingNote]);
    setPendingNote(null);
  }

  useEffect(() => {
    if (allDone) onGuideEvent?.('allDone');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allDone]);

  const board: ReactionBoard | undefined = boards[boardIdx];
  if (board && boardRef) boardRef.current = board;

  // A Plan board has one position — `back` holds it, its arrows and circles
  // (the final position's, see chess.ts's faceAnnotations).
  // Opponent arrows count in their dark tint (that's how they are shown).
  const finalAnnotations = useMemo(() => {
    if (!board) return { arrows: [], circles: [] };
    const a = faceAnnotations(board.back);
    return { arrows: a.arrows.map((x) => ({ ...x, color: effectiveArrowColor(x, board.back.pieces, yourColor, a.arrows) })), circles: a.circles };
  }, [board, yourColor]);
  const colorGroups = useMemo(
    () => buildColorGroups(finalAnnotations.arrows, board?.back.pieces, yourColor),
    [finalAnnotations, board, yourColor]
  );
  const arrowNumbers = useMemo(
    () => editorArrowNumbers(finalAnnotations.arrows, board?.back.pieces, yourColor),
    [finalAnnotations, board, yourColor]
  );
  // Threats (Summary), outside the colour order: the opponent's (purple: their
  // move first, then your answers) and yours (teal: in the order drawn — your
  // threatening move, the opponent's reply appearing by itself, your follow-up).
  // Each is a list of steps; `threatFound` is how many are on the board.
  const threats = useMemo(() => {
    const pieces = board?.back.pieces;
    const isOpp = (a: Arrow) => arrowIsOpponent(a, pieces, yourColor, finalAnnotations.arrows);
    const out: StudyThreat[] = [];
    for (const kind of ['opp', 'mine'] as const) {
      const letters = new Set<string>();
      for (const a of finalAnnotations.arrows) {
        const t = threatOfArrow(a);
        if (t?.kind === kind) letters.add(t.letter);
      }
      for (const letter of [...letters].sort()) {
        const ref = { kind, letter };
        const all = finalAnnotations.arrows.filter((a) => sameThreat(threatOfArrow(a), ref));
        const opp = all.filter(isOpp);
        const own = all.filter((a) => !isOpp(a));
        const ordered = kind === 'opp' ? [...opp, ...own] : all;
        const lead = kind === 'opp' ? opp[0] : own[0];
        out.push({
          kind,
          letter,
          key: `${kind}:${letter}`,
          steps: ordered.map((arrow) => ({ arrow, auto: isOpp(arrow) })),
          circles: finalAnnotations.circles.filter((c) => sameThreat(threatOfCircle(c), ref)),
          title: `${kind === 'opp' ? '!' : '★'}${letter}${lead ? ` ${sanLike(lead, pieces)}` : ''}`
        });
      }
    }
    return out;
  }, [finalAnnotations, board, yourColor]);
  const activeThreat = threats.find((t) => t.key === threatMode);
  const noArrows = colorGroups.length === 0 && threats.length === 0;
  // Every own arrow in study order — what preview and »/› step through.
  const allOwn = useMemo(() => colorGroups.flatMap((g) => g.own), [colorGroups]);

  // Where the board stands, all derived from `found`: the active group is the
  // first one with own arrows still to find; every group up to it shows its
  // opponent arrows. A group with only opponent arrows is passed straight
  // through.
  // The active group is the first one that still has own arrows to find, or
  // opponent arrows still waiting to appear (see OPPONENT_ARROW_DELAY_MS).
  const foundKeys = useMemo(() => new Set(found.map(keyOf)), [found]);
  let groupIdx = colorGroups.findIndex(
    (g, i) => g.own.some((a) => !foundKeys.has(keyOf(a))) || (g.auto.length > 0 && autoShownGroup < i)
  );
  const boardDone = !noArrows && groupIdx === -1;
  if (groupIdx === -1) groupIdx = colorGroups.length - 1;
  const activeGroup = colorGroups[groupIdx];
  const autoPending = !boardDone && !!activeGroup && activeGroup.auto.length > 0 && autoShownGroup < groupIdx;
  const remaining = activeGroup ? activeGroup.own.filter((a) => !foundKeys.has(keyOf(a))) : [];
  const shownAuto = colorGroups.slice(0, groupIdx + 1).flatMap((g, i) => (i < groupIdx || !autoPending ? g.auto : []));
  // Own arrows in study order (colour order, then their number order).
  const foundInOrder = allOwnOrdered(colorGroups, foundKeys);
  const drawnArrows = [...shownAuto, ...foundInOrder];

  // After a beat, the active group's opponent arrows appear by themselves.
  useEffect(() => {
    if (!autoPending) return;
    const t = setTimeout(() => setAutoShownGroup(groupIdx), OPPONENT_ARROW_DELAY_MS);
    return () => clearTimeout(t);
  }, [autoPending, groupIdx]);

  const gridRef = useRef<View>(null);
  const gridOrigin = useRef({ x: 0, y: 0 });
  const arrowStartRef = useRef<string | null>(null);
  const flipped = yourColor === 'b';

  function measureGrid(cb?: () => void) {
    gridRef.current?.measureInWindow((x, y) => {
      gridOrigin.current = { x, y };
      cb?.();
    });
  }

  useEffect(() => {
    measureGrid();
  }, []);

  function squareFromPage(pageX: number, pageY: number): string | null {
    const file = Math.floor((pageX - gridOrigin.current.x) / CELL);
    const rank = Math.floor((pageY - gridOrigin.current.y) / CELL);
    return squareFromIndex(flipIndex(file, flipped), flipIndex(rank, flipped));
  }

  // A new board resets the whole exercise.
  useEffect(() => {
    setFound([]);
    setAutoShownGroup(-1);
    revealedRef.current = new Set();
    setWrongArrow(null);
    if (noteDelayRef.current) {
      clearTimeout(noteDelayRef.current);
      noteDelayRef.current = null;
    }
    setPendingNote(null);
    setShownNotes([]);
    setSummaryNote(null);
    setThreatMode(null);
    setThreatFound(0);
  }, [colorGroups]);

  function continueToNextBoard() {
    setBoardIdx((i) => i + 1);
  }

  // Only preview (and the very last board, onto the allDone screen) moves on
  // by itself; interactive solving waits for Continue.
  useEffect(() => {
    if (!boardDone || pendingNote) return;
    const isLast = boardIdx >= boards.length - 1;
    if (!preview && !isLast) return;
    const t = setTimeout(() => {
      if (isLast) setAllDone(true);
      else continueToNextBoard();
    }, BOARD_DONE_PAUSE_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardDone, boardIdx, boards.length, pendingNote, preview]);

  // Preview: one more arrow every beat — paused while a note popup is up.
  useEffect(() => {
    if (!preview || paused || noArrows || boardDone || allDone || pendingNote) return;
    const t = setTimeout(() => revealNextPreviewArrow(), PREVIEW_STEP_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preview, paused, noArrows, boardDone, allDone, pendingNote, found.length, allOwn]);

  function noteFor(arrow: Arrow): ShownNote {
    return { arrow, number: arrowNumbers.get(keyOf(arrow)) };
  }

  // Plan only: queue the popup for a found arrow that has notes to read.
  function popNoteFor(arrow: Arrow, delayed: boolean) {
    if (isSummary || !hasArrowNotes(arrow) || !(arrow.notes?.reason || arrow.notes?.next || arrow.notes?.responses?.length)) return;
    if (noteDelayRef.current) {
      clearTimeout(noteDelayRef.current);
      noteDelayRef.current = null;
    }
    if (!delayed) {
      if (pendingNote) dismissNote();
      setPendingNote(noteFor(arrow));
      return;
    }
    noteDelayRef.current = setTimeout(() => {
      noteDelayRef.current = null;
      setPendingNote(noteFor(arrow));
    }, NOTE_PREVIEW_DELAY_MS);
  }

  function revealNextPreviewArrow() {
    if (autoPending) {
      setAutoShownGroup(groupIdx);
      return;
    }
    const next = allOwn.find((a) => !foundKeys.has(keyOf(a)));
    if (!next) return;
    setFound((prev) => [...prev, next]);
    popNoteFor(next, true);
  }

  function handleDrawnArrow(from: string, to: string) {
    if (activeThreat) {
      if (wrongArrow) return;
      const next = activeThreat.steps[threatFound];
      if (!next || next.auto) return;
      if (next.arrow.from === from && next.arrow.to === to) setThreatFound((n) => n + 1);
      else {
        setWrongArrow({ from, to });
        setTimeout(() => setWrongArrow(null), WRONG_ARROW_SHOW_MS);
      }
      return;
    }
    if (preview || !board || boardDone || allDone || wrongArrow || noArrows || autoPending) return;
    const match = remaining.find((a) => a.from === from && a.to === to);
    if (!match) {
      if (!isSummary) setMistakes((m) => m + 1);
      setWrongArrow({ from, to });
      setTimeout(() => setWrongArrow(null), WRONG_ARROW_SHOW_MS);
      return;
    }
    setFound((prev) => [...prev, match]);
    popNoteFor(match, false);
  }

  // Shows arrows for you; on a Plan each costs one slip, only the first time.
  function reveal(arrows: Arrow[]) {
    if (arrows.length === 0) return;
    let slips = 0;
    for (const a of arrows) {
      if (!revealedRef.current.has(keyOf(a))) {
        revealedRef.current.add(keyOf(a));
        slips++;
      }
    }
    if (!isSummary && slips > 0) setMistakes((m) => m + slips);
    setFound((prev) => [...prev, ...arrows]);
    popNoteFor(arrows[arrows.length - 1], false);
    onGuideEvent?.('solution');
  }

  const blocked = boardDone || Boolean(wrongArrow) || Boolean(pendingNote) || noArrows;
  // › the next arrow in order (an opponent arrow still waiting comes first);
  // » the whole current step — the opponent arrows and your own of that colour
  // together (or, once a colour is complete, the next one, which is then current).
  const canNext = !blocked && (remaining.length > 0 || autoPending);
  function stepNext() {
    if (!canNext) return;
    if (autoPending) setAutoShownGroup(groupIdx);
    else reveal([remaining[0]]);
  }
  function stepNextGroup() {
    if (!canNext) return;
    if (autoPending) setAutoShownGroup(groupIdx);
    reveal(remaining);
  }
  // ‹ takes back the last arrow in order; « the current colour's arrows, or
  // if there are none yet, the whole previous colour. Also after the board
  // (or the whole card) is complete.
  const canBack = !wrongArrow && !pendingNote && (found.length > 0 || autoShownGroup >= 0);
  function stepBack() {
    if (!canBack) return;
    setAllDone(false);
    const last = foundInOrder[foundInOrder.length - 1];
    const lastGroup = last ? colorGroups.findIndex((g) => g.own.some((o) => keyOf(o) === keyOf(last))) : -1;
    // Opponent arrows of a later colour than your last arrow go first.
    if (autoShownGroup > lastGroup && autoShownGroup >= 0) {
      setAutoShownGroup(autoShownGroup - 1);
      return;
    }
    if (last) setFound((prev) => prev.filter((a) => keyOf(a) !== keyOf(last)));
  }
  function stepBackGroup() {
    if (!canBack) return;
    setAllDone(false);
    const inGroup = (a: Arrow, g: ColorGroup | undefined) => !!g && g.own.some((o) => keyOf(o) === keyOf(a));
    const currentIdx = boardDone ? colorGroups.length - 1 : groupIdx;
    const current = colorGroups[currentIdx];
    const hasProgress = found.some((a) => inGroup(a, current)) || (current?.auto.length && autoShownGroup >= currentIdx);
    const targetIdx = hasProgress ? currentIdx : currentIdx - 1;
    const target = colorGroups[targetIdx];
    setFound((prev) => prev.filter((a) => !inGroup(a, target)));
    setAutoShownGroup((g) => Math.min(g, targetIdx - 1));
  }

  function toggleThreat(key: string) {
    setThreatMode((cur) => (cur === key ? null : key));
    setThreatFound(0);
    setWrongArrow(null);
    setSummaryNote(null);
  }
  const threatSteps = activeThreat?.steps ?? [];
  const threatDone = !!activeThreat && threatFound >= threatSteps.length;
  const threatOwnTotal = threatSteps.filter((st) => !st.auto).length;
  const threatOwnShown = threatSteps.slice(0, threatFound).filter((st) => !st.auto).length;
  const threatAutoPending = !!activeThreat && !threatDone && threatSteps[threatFound].auto;
  // The opponent's moves in a threat appear by themselves (at once when the
  // threat opens, after a beat when they answer your move).
  useEffect(() => {
    if (!threatAutoPending) return;
    const t = setTimeout(() => setThreatFound((n) => n + 1), threatFound === 0 ? 0 : OPPONENT_ARROW_DELAY_MS);
    return () => clearTimeout(t);
  }, [threatAutoPending, threatFound]);
  // ‹ takes back your last move in the threat (and the opponent's replies after it).
  function threatBack() {
    let k = threatFound - 1;
    while (k >= 0 && threatSteps[k].auto) k--;
    setThreatFound(Math.max(0, k));
  }
  // › shows your next move in the threat (with the opponent's moves before it).
  function threatNext() {
    let j = threatFound;
    while (j < threatSteps.length && threatSteps[j].auto) j++;
    setThreatFound(Math.min(threatSteps.length, j + 1));
  }

  const panResponderRef = useRef<PanResponderInstance | null>(null);
  const handleDrawnArrowRef = useRef(handleDrawnArrow);
  handleDrawnArrowRef.current = handleDrawnArrow;
  if (!panResponderRef.current) {
    panResponderRef.current = PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (evt) => {
        const { pageX, pageY } = evt.nativeEvent;
        measureGrid(() => {
          const sq = squareFromPage(pageX, pageY);
          if (!sq) return;
          arrowStartRef.current = sq;
          setTempArrow(null);
        });
      },
      onPanResponderMove: (evt) => {
        if (!arrowStartRef.current) return;
        const { pageX, pageY } = evt.nativeEvent;
        const hoverSq = squareFromPage(pageX, pageY);
        const start = arrowStartRef.current;
        setTempArrow(hoverSq && hoverSq !== start ? { from: start, to: hoverSq } : null);
      },
      onPanResponderRelease: (evt) => {
        const start = arrowStartRef.current;
        arrowStartRef.current = null;
        setTempArrow(null);
        if (!start) return;
        const { pageX, pageY } = evt.nativeEvent;
        const endSq = squareFromPage(pageX, pageY);
        if (endSq && endSq !== start) handleDrawnArrowRef.current(start, endSq);
      }
    });
  }
  const panResponder = panResponderRef.current;

  // By default only one colour family is on the board (e.g. light and dark
  // green together; "Show all colors" lifts that). A new family takes over
  // only once something of it is on the board, so a finished colour stays
  // visible until then (also after » or while the opponent's arrows wait).
  const groupHasProgress = (i: number) =>
    !!colorGroups[i] &&
    (colorGroups[i].own.some((a) => foundKeys.has(keyOf(a))) || (colorGroups[i].auto.length > 0 && autoShownGroup >= i));
  let displayIdx = groupIdx;
  if (!boardDone && !groupHasProgress(groupIdx)) {
    for (let i = groupIdx - 1; i >= 0; i--) {
      if (groupHasProgress(i)) {
        displayIdx = i;
        break;
      }
    }
  }
  const displayGroup = colorGroups[displayIdx];
  const visibleFamily = !showAll && !boardDone && displayGroup ? familyOf(displayGroup.color) : null;
  const visibleArrows = activeThreat
    ? threatSteps.slice(0, threatFound).map((st) => st.arrow)
    : visibleFamily
      ? drawnArrows.filter((a) => familyOf(a.color) === visibleFamily)
      : drawnArrows;
  // A colour's circles appear together with that colour's step.
  const reachedOrder = boardDone ? COLOR_CYCLE.length : COLOR_CYCLE.indexOf(activeGroup?.color ?? 'green');
  const circleColor = (c: { square: string; color: ArrowColor }) =>
    board && isOpponentArrow(c.square, board.back.pieces, yourColor) ? opponentTint(c.color) : c.color;
  const visibleCircles = activeThreat ? activeThreat.circles : finalAnnotations.circles.filter((c) => !threatOfCircle(c)).filter((c) =>
    visibleFamily ? familyOf(circleColor(c)) === visibleFamily && COLOR_CYCLE.indexOf(circleColor(c)) <= reachedOrder : COLOR_CYCLE.indexOf(circleColor(c)) <= reachedOrder
  );

  // Opponent threat: "!A" on their move, "A1", "A2" on your answers.
  // Your threat: "★A" on your threatening move, "A1", "A2" on your follow-up,
  // no badge on the opponent's replies.
  function threatLabel(a: Arrow): string | undefined {
    const ref = threatOfArrow(a);
    const t = ref && threats.find((x) => x.kind === ref.kind && x.letter === ref.letter);
    if (!t) return undefined;
    const own = t.steps.filter((st) => !st.auto).map((st) => keyOf(st.arrow));
    const i = own.indexOf(keyOf(a));
    if (i === -1) return t.kind === 'opp' ? `!${t.letter}` : undefined;
    if (t.kind === 'mine') return i === 0 ? `★${t.letter}` : `${t.letter}${i}`;
    return `${t.letter}${i + 1}`;
  }
  const numberedArrows: NumberedArrow[] = visibleArrows.map((a, i) => ({
    id: `${keyOf(a)}-${i}`,
    from: a.from,
    to: a.to,
    color: arrowColors[a.color],
    ...(threatOfArrow(a)
      ? { label: threatLabel(a), opponent: arrowIsOpponent(a, board?.back.pieces, yourColor, finalAnnotations.arrows) }
      : { number: arrowNumbers.get(keyOf(a)) })
  }));
  if (wrongArrow) {
    numberedArrows.push({ id: 'wrong', from: wrongArrow.from, to: wrongArrow.to, color: colors.danger });
  } else if (tempArrow) {
    const tempColor = activeThreat ? arrowColors[THREAT_COLOR[activeThreat.kind]] : activeGroup ? arrowColors[activeGroup.color] : colors.textDim;
    numberedArrows.push({ id: 'preview', from: tempArrow.from, to: tempArrow.to, color: tempColor });
  }

  // All badges of the board placed together — numbers / "!" and, on a
  // Summary, link and note badges — so overlapping ones move to free space.
  // Worked out once over every arrow of the board (or of the threat being
  // studied), so a badge never jumps when other arrows appear.
  const badgeLayout = useMemo(() => {
    const all = activeThreat ? activeThreat.steps.map((st) => st.arrow) : finalAnnotations.arrows.filter((a) => !threatOfArrow(a));
    const offsets = parallelOffsets(all);
    const kinds: { key: string; kind: 'number' | 'link' | 'note' }[] = [];
    const pts: Point[] = [];
    all.forEach((a, i) => {
      const k = keyOf(a);
      if (threatOfArrow(a) ? threatLabel(a) !== undefined : arrowNumbers.get(k) !== undefined) {
        kinds.push({ key: k, kind: 'number' });
        pts.push(numberBadgeCenter(a, i, BOARD_SIZE, flipped, offsets[i]));
      }
      if (!isSummary) return;
      const side = i % 2 === 0 ? 1 : -1;
      if (a.notes?.linkCardId) {
        kinds.push({ key: k, kind: 'link' });
        pts.push(pointOn(a, 0.4, BOARD_SIZE, flipped, side));
      }
      if (hasNoteText(a)) {
        kinds.push({ key: k, kind: 'note' });
        pts.push(pointOn(a, 0.25, BOARD_SIZE, flipped, -side));
      }
    });
    const placed = separateBadgeCenters(pts, 26, BOARD_SIZE);
    const at = new Map<string, Point>();
    kinds.forEach((x, i) => at.set(`${x.kind}:${x.key}`, placed[i]));
    return at;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeThreat, finalAnnotations, arrowNumbers, isSummary, flipped]);
  const numberCenters: (Point | undefined)[] = visibleArrows.map((a) => badgeLayout.get(`number:${keyOf(a)}`));
  const linkNotePositions: { link?: Point; note?: Point }[] = visibleArrows.map((a) => ({
    link: badgeLayout.get(`link:${keyOf(a)}`),
    note: badgeLayout.get(`note:${keyOf(a)}`)
  }));

  if (!board) {
    return <Text style={{ color: colors.textDim }}>This card has no boards to study.</Text>;
  }

  const styleSet = boardStyles[boardStyle] ?? boardStyles[0];

  const groupTotal = activeGroup ? activeGroup.own.length : 0;
  const groupDone = groupTotal - remaining.length;
  const colorName = activeGroup ? ARROW_COLOR_NAMES[activeGroup.color] : '';
  const threatName = activeThreat ? `${activeThreat.kind === 'mine' ? 'My threat' : 'Threat'} ${activeThreat.letter}` : '';
  const statusText = activeThreat
    ? wrongArrow
      ? 'Wrong arrow — try again'
      : threatDone
        ? `${threatName} complete — tap it again to go back`
        : threatAutoPending
          ? `${threatName}: the opponent plays…`
          : `${threatName}: your ${activeThreat.kind === 'mine' ? 'move' : 'answer'} ${threatOwnShown + 1} of ${threatOwnTotal}`
    : boardDone
    ? 'Board complete!'
    : wrongArrow
      ? 'Wrong arrow — try again'
      : autoPending
        ? `${colorName}: the opponent plays…`
        : activeGroup
        ? `${colorName} arrows: ${groupDone} of ${groupTotal}`
        : "Draw the plan's arrows";
  const statusColor = activeThreat ? (wrongArrow ? colors.danger : arrowColors[THREAT_COLOR[activeThreat.kind]]) : boardDone ? colors.primary : wrongArrow ? colors.danger : activeGroup ? arrowColors[activeGroup.color] : colors.textDim;

  return (
    <View ref={containerRef} collapsable={false} style={{ alignItems: 'center', gap: 10 }}>
      {board.back.text ? <MoveText text={board.back.text} style={styles.boardText} /> : null}
      {noArrows ? (
        <View style={styles.warning}>
          <Text style={styles.warningTitle}>
            {boards.length > 1 ? `Board ${boardIdx + 1} / ${boards.length}: ` : ''}No arrows to study
          </Text>
          <Text style={styles.warningText}>
            {'This board has no arrows yet, so there is nothing to draw.\nAdd at least one arrow in the board editor to study it.'}
          </Text>
          {onEditBoard && (
            <Pressable onPress={onEditBoard} style={styles.warningBtn}>
              <Text style={styles.warningBtnText}>Open board editor</Text>
            </Pressable>
          )}
        </View>
      ) : (
        <Text style={[styles.status, { color: statusColor }]}>
          {boards.length > 1 ? `Board ${boardIdx + 1} / ${boards.length} — ` : ''}
          {statusText}
        </Text>
      )}

      <View ref={guideTargets?.board} collapsable={false}>
        <View
          ref={gridRef}
          onLayout={() => measureGrid()}
          style={[styles.board, { width: BOARD_SIZE, height: BOARD_SIZE }]}
          {...panResponder.panHandlers}
        >
          <View style={{ width: BOARD_SIZE, height: BOARD_SIZE, flexDirection: 'row', flexWrap: 'wrap' }}>
            {(flipped ? [...allSquares()].reverse() : allSquares()).map((sq, i) => {
              const file = i % 8;
              const rank = Math.floor(i / 8);
              const isLight = (file + rank) % 2 === 0;
              const piece = board.back.pieces[sq];
              return (
                <View
                  key={sq}
                  style={{ width: CELL, height: CELL, backgroundColor: isLight ? styleSet.light : styleSet.dark, alignItems: 'center', justifyContent: 'center' }}
                >
                  {piece && <PieceGlyph code={piece} cell={CELL} />}
                </View>
              );
            })}
          </View>
          <BoardCoords size={BOARD_SIZE} flipped={flipped} styleSet={styleSet} />
          <View style={StyleSheet.absoluteFill} pointerEvents="none">
            <NumberedArrowsSvg arrows={numberedArrows} size={BOARD_SIZE} flipped={flipped} pieces={board.back.pieces} yourColor={yourColor} />
            <NumberedArrowBadges arrows={numberedArrows} size={BOARD_SIZE} flipped={flipped} pieces={board.back.pieces} yourColor={yourColor} centers={numberCenters} />
            {visibleCircles.length > 0 && <CirclesSvg circles={visibleCircles} size={BOARD_SIZE} flipped={flipped} pieces={board.back.pieces} yourColor={yourColor} />}
          </View>
        </View>
        {isSummary && (
          <ArrowLinkNoteBadges
            arrows={visibleArrows}
            size={BOARD_SIZE}
            flipped={flipped}
            onOpenLink={(cardId, boardId) => openCardViewer(cardId, yourColor, boardStyle, boardId)}
            onShowNote={setSummaryNote}
            positions={linkNotePositions}
          />
        )}
      </View>

      {isSummary &&
        !preview &&
        // Threats sit outside the colour order, in two rows (the opponent's and
        // yours): tap one to study it, tap again to go back.
        (['opp', 'mine'] as const).map((kind) => {
          const list = threats.filter((t) => t.kind === kind);
          if (list.length === 0) return null;
          const accent = arrowColors[THREAT_COLOR[kind]];
          const dark = arrowColors[kind === 'opp' ? 'darkPurple' : 'darkTeal'];
          return (
            <View key={kind} style={styles.threatGroup}>
              <Text style={[styles.threatGroupTitle, { color: accent }]}>{kind === 'opp' ? 'Opponent threats' : 'My threats'}</Text>
              <View style={styles.threatRow}>
                {list.map((t) => {
                  const on = threatMode === t.key;
                  return (
                    <Pressable
                      key={t.key}
                      onPress={() => toggleThreat(t.key)}
                      style={[styles.threatChip, { borderColor: dark }, on && { backgroundColor: dark }]}
                      accessibilityLabel={`Study ${kind === 'opp' ? 'opponent threat' : 'my threat'} ${t.letter}`}
                    >
                      <Text style={[styles.threatChipText, { color: accent }, on && styles.threatChipTextActive]}>{t.title}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          );
        })}

      {!noArrows && !preview && !activeThreat && (
        <View style={styles.onlyRow}>
          <Text style={styles.onlyLabel}>Show all colors</Text>
          <Switch
            value={showAll}
            onValueChange={setShowAll}
            trackColor={{ false: colors.panel2, true: colors.primary }}
            thumbColor={colors.textPrimary}
          />
        </View>
      )}

      {summaryNote && (
        <View style={noteStyles.panel}>
          <View style={noteStyles.panelHeader}>
            <ArrowNoteIcon color={arrowColors[summaryNote.color]} number={arrowNumbers.get(keyOf(summaryNote))} size={24} />
            <Text style={noteStyles.panelTitle}>Notes</Text>
            <CloseCircleButton onPress={() => setSummaryNote(null)} />
          </View>
          <ArrowNoteBody notes={summaryNote.notes} accent={arrowColors[summaryNote.color]} />
        </View>
      )}

      {pendingNote && (
        // Under the board (not over it), so the arrow being described stays visible.
        <View style={noteStyles.panel}>
          <View style={noteStyles.panelHeader}>
            <ArrowNoteIcon color={arrowColors[pendingNote.arrow.color]} number={pendingNote.number} size={24} />
            <Text style={noteStyles.panelTitle}>Notes</Text>
            <CloseCircleButton onPress={dismissNote} />
          </View>
          <ArrowNoteBody notes={pendingNote.arrow.notes} accent={arrowColors[pendingNote.arrow.color]} />
          <Pressable onPress={dismissNote} style={noteStyles.panelBtn}>
            <Text style={noteStyles.panelBtnText}>Got it</Text>
          </Pressable>
        </View>
      )}

      {preview && !noArrows && !pendingNote && (
        <View style={styles.navRow}>
          <Pressable onPress={stepBack} disabled={found.length === 0} style={[styles.navBtn, found.length === 0 && styles.navBtnDisabled]}>
            <Text style={styles.navBtnText}>‹</Text>
          </Pressable>
          <Pressable onPress={() => onTogglePause?.()} style={styles.navBtn}>
            {paused ? <PlayIcon size={18} color={colors.gold} /> : <PauseIcon size={18} color={colors.gold} />}
          </Pressable>
          <Pressable onPress={revealNextPreviewArrow} disabled={boardDone} style={[styles.navBtn, boardDone && styles.navBtnDisabled]}>
            <Text style={styles.navBtnText}>›</Text>
          </Pressable>
        </View>
      )}

      {!preview && activeThreat && (
        // ‹ › one of your moves back / forward, « » all of this threat.
        <View style={styles.navRow}>
          <Pressable onPress={() => setThreatFound(0)} disabled={threatOwnShown === 0} style={[styles.navBtn, threatOwnShown === 0 && styles.navBtnDisabled]} accessibilityLabel="Take back all moves">
            <Text style={styles.navBtnText}>«</Text>
          </Pressable>
          <Pressable onPress={threatBack} disabled={threatOwnShown === 0} style={[styles.navBtn, threatOwnShown === 0 && styles.navBtnDisabled]} accessibilityLabel="Take back one move">
            <Text style={styles.navBtnText}>‹</Text>
          </Pressable>
          <Pressable onPress={threatNext} disabled={threatDone} style={[styles.navBtn, threatDone && styles.navBtnDisabled]} accessibilityLabel="Show the next move">
            <Text style={styles.navBtnText}>›</Text>
          </Pressable>
          <Pressable onPress={() => setThreatFound(threatSteps.length)} disabled={threatDone} style={[styles.navBtn, threatDone && styles.navBtnDisabled]} accessibilityLabel="Show all moves">
            <Text style={styles.navBtnText}>»</Text>
          </Pressable>
        </View>
      )}

      {!preview && !noArrows && !activeThreat && (
        // « whole group back · ‹ one arrow back · › show one arrow · » show the group
        <View ref={guideTargets?.solution} collapsable={false} style={styles.navRow}>
          <Pressable onPress={stepBackGroup} disabled={!canBack} style={[styles.navBtn, !canBack && styles.navBtnDisabled]} accessibilityLabel="Take back this colour">
            <Text style={styles.navBtnText}>«</Text>
          </Pressable>
          <Pressable onPress={stepBack} disabled={!canBack} style={[styles.navBtn, !canBack && styles.navBtnDisabled]} accessibilityLabel="Take back one arrow">
            <Text style={styles.navBtnText}>‹</Text>
          </Pressable>
          <Pressable onPress={stepNext} disabled={!canNext} style={[styles.navBtn, !canNext && styles.navBtnDisabled]} accessibilityLabel="Show the next arrow">
            <Text style={styles.navBtnText}>›</Text>
          </Pressable>
          <Pressable onPress={stepNextGroup} disabled={!canNext} style={[styles.navBtn, !canNext && styles.navBtnDisabled]} accessibilityLabel="Show this colour">
            <Text style={styles.navBtnText}>»</Text>
          </Pressable>
        </View>
      )}

      {allDone ? (
        <Pressable
          ref={guideTargets?.continue}
          collapsable={false}
          onPress={() => {
            onGuideEvent?.('continue');
            onResult(preview || isSummary || mistakes === 0);
          }}
          style={styles.continueBtn}
        >
          <Text style={styles.continueText}>
            {preview || isSummary ? 'Continue' : mistakes === 0 ? '✓ Perfect — continue' : `Continue (${mistakes} slip${mistakes === 1 ? '' : 's'})`}
          </Text>
        </Pressable>
      ) : noArrows || preview ? null : boardDone && boardIdx < boards.length - 1 ? (
        <Pressable onPress={continueToNextBoard} style={styles.continueBtn}>
          <Text style={styles.continueText}>Continue</Text>
        </Pressable>
      ) : isSummary ? null : (
        <Text style={styles.slipNote}>› and » show arrows for you; each shown arrow counts as a slip once.</Text>
      )}

      {shownNotes.length > 0 && (
        <View style={noteStyles.list}>
          {shownNotes.map((note, i) => (
            <View key={i} style={noteStyles.listRow}>
              <ArrowNoteIcon color={arrowColors[note.arrow.color]} number={note.number} size={20} />
              <ArrowNoteBody notes={note.arrow.notes} accent={arrowColors[note.arrow.color]} compact style={noteStyles.listBody} />
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

// A small colored circle matching the arrow's own color, with its badge
// number inside when it has one — the same visual language as the board's
// numbered-arrow badges, so a list entry reads as "that arrow" at a glance.
function ArrowNoteIcon({ color, number, size }: { color: string; number?: number; size: number }) {
  return (
    <View style={[noteStyles.icon, { width: size, height: size, borderRadius: size / 2, backgroundColor: color }]}>
      {number !== undefined && <Text style={noteStyles.iconText}>{number}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  navRow: { flexDirection: 'row', gap: 10 },
  navBtn: { width: touchTarget, height: touchTarget, borderRadius: 10, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.panel2, alignItems: 'center', justifyContent: 'center' },
  navBtnDisabled: { opacity: 0.4 },
  navBtnText: { color: colors.text, fontSize: 18 },
  boardText: { color: colors.text, fontSize: 15, lineHeight: 22, textAlign: 'center', paddingHorizontal: 12 },
  status: { color: colors.textDim, fontSize: 13, fontWeight: '600' },
  board: { borderRadius: 6, overflow: 'hidden', borderWidth: 1, borderColor: colors.border },
  warning: {
    alignSelf: 'stretch',
    backgroundColor: colors.panel2,
    borderWidth: 1,
    borderColor: colors.gold,
    borderRadius: radius.md,
    padding: 14,
    gap: 8
  },
  warningTitle: { color: colors.gold, fontSize: 14, fontWeight: '700' },
  warningText: { color: colors.text, fontSize: 13, lineHeight: 19 },
  warningBtn: { alignSelf: 'flex-start', backgroundColor: colors.gold, borderRadius: radius.pill, paddingVertical: 8, paddingHorizontal: 16, marginTop: 2 },
  warningBtnText: { color: colors.onGold, fontSize: 13, fontWeight: '700' },
  slipNote: { color: colors.textDim, fontSize: 12 },
  actionRow: { flexDirection: 'row', gap: 10, alignSelf: 'stretch', paddingHorizontal: 12 },
  actionBtn: { flex: 1, minHeight: touchTarget, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16, borderRadius: radius.pill },
  solutionBtn: { backgroundColor: colors.primary },
  solutionText: { color: colors.onPrimary, fontSize: 13, fontWeight: '700' },
  actionDisabled: { opacity: 0.4 },
  continueBtn: { marginTop: 4, minHeight: touchTarget, justifyContent: 'center', paddingHorizontal: 20, borderRadius: radius.pill, backgroundColor: colors.primary },
  continueText: { color: colors.onPrimary, fontSize: 14, fontWeight: '700' },
  onlyRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  threatGroup: { alignItems: 'center', gap: 6 },
  threatGroupTitle: { fontSize: 13, fontWeight: '700', letterSpacing: 0.5 },
  threatRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 8, paddingHorizontal: 16 },
  threatChip: { minHeight: 44, paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center', borderRadius: 999, borderWidth: 1, borderColor: arrowColors.darkPurple },
  threatChipActive: { backgroundColor: arrowColors.darkPurple },
  threatChipText: { color: arrowColors.purple, fontSize: 14, fontWeight: '700' },
  threatChipTextActive: { color: '#ffffff' },
  onlyLabel: { color: colors.textDim, fontSize: 13 }
});

const noteStyles = StyleSheet.create({
  icon: { alignItems: 'center', justifyContent: 'center' },
  iconText: { color: '#fff', fontSize: 10, fontWeight: '700' },
  list: { alignSelf: 'stretch', paddingHorizontal: 12, gap: 10, marginTop: 4 },
  listRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  listBody: { flex: 1 },
  panel: {
    alignSelf: 'stretch',
    marginHorizontal: 12,
    backgroundColor: colors.panel2,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    gap: 14
  },
  panelHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  panelTitle: { color: colors.text, fontSize: 16, fontWeight: '700', flex: 1 },
  panelBtn: { alignSelf: 'stretch', minHeight: touchTarget, alignItems: 'center', justifyContent: 'center', borderRadius: radius.pill, backgroundColor: colors.primary },
  panelBtnText: { color: colors.onPrimary, fontSize: 14, fontWeight: '700' }
});
