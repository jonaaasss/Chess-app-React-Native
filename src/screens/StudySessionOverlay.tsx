import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView, Animated } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';
import { getBoardStyle, getCard, getCards, getOpening, getRepertoire, getSetting, restoreCard, saveCard } from '../storage';
import { defaultOverviewText, descriptionFace, faceAnnotations, mainLineLeaf } from '../chess';
import { choiceDialog, confirmDialog, showOverlay, showSnackbar, SnackbarLayer, useOverlayBack } from '../overlay';
import type { Arrow, Card, CardMode, Circle, ReactionBoard } from '../types';
import { colors, radius, touchTarget, type } from '../theme';
import { ChessBoardView } from '../components/ChessBoard';
import { MoveText } from '../components/MoveText';
import { BackCircleButton, EditCircleButton } from '../components/Common';
import {
  GUIDE_CARDS,
  GUIDE_COACH,
  GUIDE_DONE_TEXT,
  GUIDE_OPENING_NAME,
  GUIDE_ROUNDS_STEP,
  type CoachEvent
} from '../guideContent';
import { GuideCoach, type CoachChoice, type GuideTargets } from '../components/GuideCoach';
import { useTutorial } from '../tutorial';
import { openCardEditor } from './CardEditorOverlay';
import { openReactionBoardEditor } from './ReactionBoardEditorOverlay';
import { ReactionStudy } from './ReactionStudy';
import { PlanStudy } from './PlanStudy';

// Skip-to-next glyph, drawn (not a Unicode character) like the app's other icons.
function SkipIcon({ size, color }: { size: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" fill={color} />
    </Svg>
  );
}

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

// Same triangle as PlayIcon, turned to point down — the "expanded" state of
// a row in the Cards list.
function DownIcon({ size, color }: { size: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M5 8h14l-7 11z" fill={color} />
    </Svg>
  );
}

// "Others" cards: each board has its own independent front and back, text
// included — flipping the card flips which face of every board is shown,
// text and all. Reactions cards use ReactionStudy instead, Plan cards use
// PlanStudy (both show their own per-board text internally).
function OthersBoardsView({
  card,
  showBack,
  yourColor,
  boardStyle
}: {
  card: Card;
  showBack: boolean;
  yourColor: 'w' | 'b';
  boardStyle: number;
}) {
  const sorted = [...card.boards].sort((a, b) => a.order - b.order);
  return (
    <View style={{ gap: 16, alignItems: 'center' }}>
      {sorted.map((b) => {
        const face = showBack ? b.back : b.front;
        // The face's *final* position's annotations (see chess.ts's
        // faceAnnotations) — what Study actually shows, regardless of how
        // many moves built up to this position.
        const annotations = faceAnnotations(face);
        return (
          <View key={b.id} style={{ alignItems: 'center', gap: 10 }}>
            {face.text ? <MoveText text={face.text} style={styles.studyCardText} /> : null}
            <ChessBoardView
              board={{ pieces: face.pieces, style: boardStyle, arrows: annotations.arrows, circles: annotations.circles }}
              size={230}
              flipped={yourColor === 'b'}
            />
          </View>
        );
      })}
    </View>
  );
}

// The end state of a board, for the Overview popup's little previews below
// the summary text — the position Study actually finished on, not however
// it was set up. Reactions has no front/back position of its own (those are
// only ever used for its Description text) — its real position/recording
// live at the top level, so the end state is the main line's last node (the
// line Study actually auto-plays through), falling back to the pre-Play
// position for the rare board with no recording at all. Others/Plan already
// keep their *current* position on the relevant face directly; only the
// annotations need the "final position, not position 0" resolution (see
// chess.ts's faceAnnotations) — same convention BoardsGrid's own preview
// tiles use for which face represents a mode (front, except back for Plan).
function finalBoardPreview(board: ReactionBoard, mode: CardMode): { pieces: ReactionBoard['pieces']; arrows: Arrow[]; circles: Circle[] } {
  if (mode === 'reactions') {
    const leaf = mainLineLeaf(board.recording);
    return { pieces: leaf ? leaf.piecesAfter : board.pieces, arrows: [], circles: [] };
  }
  const face = mode === 'plan' ? board.back : board.front;
  const annotations = faceAnnotations(face);
  return { pieces: face.pieces, arrows: annotations.arrows, circles: annotations.circles };
}

// A read-only 2-column grid of every board's end position, in order — the
// same layout/size BoardsGrid itself uses in the editor — so the Overview's
// "1) ... 2) ..." text can actually be matched up against what each board
// looked like, without having to step back through the whole card.
function OverviewBoards({ boards, mode, boardStyle, yourColor }: { boards: ReactionBoard[]; mode: CardMode; boardStyle: number; yourColor: 'w' | 'b' }) {
  const sorted = [...boards].sort((a, b) => a.order - b.order);
  return (
    <View style={overviewStyles.boardsGrid}>
      {sorted.map((board, i) => {
        const preview = finalBoardPreview(board, mode);
        return (
          <View key={board.id} style={overviewStyles.boardTile}>
            <ChessBoardView board={{ pieces: preview.pieces, style: boardStyle, arrows: preview.arrows, circles: preview.circles }} size={148} flipped={yourColor === 'b'} />
            <Text style={overviewStyles.boardTileCaption}>Board {i + 1}</Text>
          </View>
        );
      })}
    </View>
  );
}

// What an expanded row of the Cards list shows as text: the card's own
// overview when it has one, otherwise the auto-generated one — except for a
// one-board card, whose single description is shown without the "1)".
function cardOverviewText(c: Card): string {
  if (c.overviewText?.trim()) return c.overviewText.trim();
  if (c.boards.length <= 1) {
    const b = c.boards[0];
    return b ? b[descriptionFace(c.mode)].text.trim() : '';
  }
  return defaultOverviewText(c.mode, c.boards).trim();
}

// Full-screen list of every card in the opening, shown before a card starts:
// each title expands (arrow on the right: pointing right = closed, down =
// open) into that card's overview and end positions, and the card you are
// about to study is highlighted.
function CardsListScreen({
  openingName,
  cards,
  currentId,
  boardStyle,
  yourColor,
  onContinue
}: {
  openingName: string;
  cards: Card[];
  currentId: string;
  boardStyle: number;
  yourColor: 'w' | 'b';
  onContinue: () => void;
}) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  function toggle(id: string) {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  return (
    <SafeAreaView style={styles.overlay}>
      <View style={overviewStyles.header}>
        <Text style={overviewStyles.headerTitle}>Cards</Text>
        {openingName ? <MoveText text={openingName} style={overviewStyles.headerSub} /> : null}
      </View>
      <ScrollView contentContainerStyle={overviewStyles.screenContent}>
        {cards.map((c) => {
          const isOpen = open.has(c.id);
          const isCurrent = c.id === currentId;
          const text = cardOverviewText(c);
          return (
            <View key={c.id} style={[cardListStyles.item, isCurrent && cardListStyles.itemCurrent]}>
              <Pressable onPress={() => toggle(c.id)} style={cardListStyles.row}>
                <MoveText
                  text={c.name || 'Untitled card'}
                  style={[cardListStyles.name, isCurrent && cardListStyles.nameCurrent]}
                  numberOfLines={2}
                />
                {isOpen ? (
                  <DownIcon size={20} color={isCurrent ? colors.text : colors.textDim} />
                ) : (
                  <PlayIcon size={20} color={isCurrent ? colors.text : colors.textDim} />
                )}
              </Pressable>
              {isOpen ? (
                <View style={cardListStyles.body}>
                  {text ? <MoveText text={text} style={overviewStyles.text} /> : <Text style={cardListStyles.empty}>No overview text.</Text>}
                  {c.boards.length > 1 ? <OverviewBoards boards={c.boards} mode={c.mode} boardStyle={boardStyle} yourColor={yourColor} /> : null}
                </View>
              ) : null}
            </View>
          );
        })}
      </ScrollView>
      <View style={overviewStyles.footer}>
        <Pressable onPress={onContinue} style={overviewStyles.continueBtn}>
          <Text style={overviewStyles.continueBtnText}>Continue</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

interface QueueItem {
  cardId: string;
  openingId: string;
  // Set for the beginner guide: the card is bundled with the app and studied
  // straight from memory instead of being loaded from storage — read-only, so
  // there's no Edit for it. It rides along on the item so a retry round
  // (which re-queues the same items) keeps working.
  guide?: { card: Card; openingName: string };
}

// Preview, Others cards: how long the front (then the back) stays up before
// it moves on by itself.
const OTHERS_PREVIEW_STEP_MS = 3000;

const CONFETTI_COLORS = [colors.accent, colors.evalWrong, '#F5B266', '#7EB8F2', '#f2f4f6'];
const CONFETTI = Array.from({ length: 18 }, (_, i) => ({
  x: (i * 37) % 100,
  y: 20 + ((i * 53) % 160),
  color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
  rotate: (i * 41) % 360,
  round: i % 2 === 0
}));

function shuffleArray<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function StudySessionOverlay({
  round1,
  shuffleCards,
  initialPreview,
  close
}: {
  round1: QueueItem[];
  shuffleCards: boolean;
  initialPreview: boolean;
  close: () => void;
}) {
  const [roundNumber, setRoundNumber] = useState(1);
  const [queue, setQueue] = useState<QueueItem[]>(round1);
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [card, setCard] = useState<Card | null>(null);
  // A full, passive pass over `round1` (every line/arrow/face shown
  // automatically) before round 1 itself starts — same queue and order,
  // just watched instead of solved. Never re-entered for a retry round.
  const [previewing, setPreviewing] = useState(initialPreview);
  const [previewPaused, setPreviewPaused] = useState(false);
  // Others-only preview state: which face is currently shown.
  const [previewShowBack, setPreviewShowBack] = useState(false);
  // Whichever board Reactions/Plan's own internal progression is currently
  // showing — written synchronously during the child's render (not via a
  // useEffect, which only fires after paint and left a real gap where a
  // fast Edit tap could still find this null) — so Edit can jump straight
  // into that exact board instead of the card's board list. Others mode
  // shows every board of the card at once (no single "current" one), so it
  // stays null there and Edit falls back to opening the card. A ref, not
  // state: it's read imperatively on Edit and never needs to itself trigger
  // a re-render.
  const currentBoardRef = useRef<ReactionBoard | null>(null);
  // Reactions only — which move ReactionStudy is actually showing right
  // now, so Edit can reopen the board editor at that exact point instead of
  // always at the mainline's end. Others/Plan have no such notion.
  const currentCursorRef = useRef<string | null>(null);
  const scrollRef = useRef<ScrollView>(null);
  const [openingName, setOpeningName] = useState('');
  const [yourColor, setYourColor] = useState<'w' | 'b'>('w');
  const [boardStyle, setBoardStyle] = useState(0);
  const [done, setDone] = useState(false);
  // Guide coach popups: how far through each card's steps the user is, and
  // which study moments ("branchIntro", "yourTurn") have happened. Kept for
  // the whole session so a retry round doesn't coach the same card again.
  const tutorial = useTutorial();
  const [coachProgress, setCoachProgress] = useState<Record<string, number>>({});
  const [coachEvents, setCoachEvents] = useState<Set<string>>(new Set());
  // The guide never replays mistakes in a round 2: it explains rounds (this
  // flag) and then closes back to the home screen.
  const [guideRoundsExplain, setGuideRoundsExplain] = useState(false);
  const targetBoard = useRef<View>(null);
  const targetHint = useRef<View>(null);
  const targetSolution = useRef<View>(null);
  const targetContinue = useRef<View>(null);
  const guideTargets: GuideTargets = {
    board: targetBoard,
    hint: targetHint,
    solution: targetSolution,
    continue: targetContinue
  };
  const [bannerText, setBannerText] = useState<string | null>(null); // a banner currently shown, or null for none
  // A multi-board card's overview (see Card.overviewText) — shown once
  // you're done with every one of its boards, right before actually moving
  // on. `after` is whatever moving on actually means here (advance,
  // advancePreview, ...); all of it (including `boards`/`mode`, for the
  // little end-position previews below the text) is captured at the moment
  // the card finished, and run once this is dismissed.
  const [pendingOverview, setPendingOverview] = useState<{
    text: string;
    boards: ReactionBoard[];
    mode: CardMode;
    after: () => void;
  } | null>(null);
  // An opening's optional Summary (see Opening.summary) — the first thing
  // shown when you start studying that opening, blurred until "Show". Once
  // per opening per session (`summaryShownRef`), so a retry round or a
  // second pass over the same opening never repeats it.
  const [pendingSummary, setPendingSummary] = useState<{ openingName: string; text: string } | null>(null);
  const [summaryRevealed, setSummaryRevealed] = useState(false);
  const summaryShownRef = useRef<Set<string>>(new Set());
  // The Cards list shown in front of every card of round 1 / the preview (not
  // retry rounds, not the guide): every card of the card's opening.
  const [pendingCardList, setPendingCardList] = useState<Card[] | null>(null);
  const wrongThisRoundRef = useRef<QueueItem[]>([]);
  // How many cards weren't right first time (known once round 1 is over), for
  // the summary at the end.
  const firstRoundWrong = useRef<number | null>(null);
  const bannerAnim = useRef(new Animated.Value(0)).current;
  const seenRoundRef = useRef(1);

  const item = queue[index];

  // Shared by "a new retry round started" and "preview just ended" — both
  // are moments the session's mode changes underneath you, clear and
  // impossible-to-miss beats a small label for either.
  function flashBanner(text: string) {
    setBannerText(text);
    bannerAnim.setValue(0);
    Animated.sequence([
      Animated.timing(bannerAnim, { toValue: 1, duration: 200, useNativeDriver: true }),
      Animated.delay(2800),
      Animated.timing(bannerAnim, { toValue: 0, duration: 300, useNativeDriver: true })
    ]).start(() => setBannerText(null));
  }

  // A new round means "retrying what you got wrong".
  useEffect(() => {
    if (roundNumber === seenRoundRef.current) return;
    seenRoundRef.current = roundNumber;
    if (roundNumber === 1) return;
    flashBanner(`Round ${roundNumber} — retrying your mistakes`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roundNumber]);

  useEffect(() => {
    if (!item) return;
    setFlipped(false);
    setPreviewPaused(false);
    setPreviewShowBack(false);
    currentBoardRef.current = null;
    currentCursorRef.current = null;
    // Each card starts from the top: the previous card's scroll offset would
    // otherwise linger and then re-clamp once this (shorter) card lays out,
    // moving everything after it had first been measured.
    scrollRef.current?.scrollTo({ y: 0, animated: false });
    (async () => {
      if (item.guide) {
        setCard(item.guide.card);
        setOpeningName(item.guide.openingName);
        setYourColor('w');
        setBoardStyle(await getBoardStyle());
        return;
      }
      const c = await getCard(item.cardId);
      if (!c) {
        advance(null);
        return;
      }
      const opening = await getOpening(item.openingId);
      const rep = opening ? await getRepertoire(opening.repertoireId) : undefined;
      const style = await getBoardStyle();
      // Everything is set together after the last await (batched), so the
      // card never flashes on screen for a frame before the summary takes over.
      const summary = opening?.summary?.trim();
      if (summary && !summaryShownRef.current.has(item.openingId)) {
        summaryShownRef.current.add(item.openingId);
        setSummaryRevealed(false);
        setPendingSummary({ openingName: opening?.name ?? '', text: summary });
      }
      if (roundNumber === 1) {
        const siblings = await getCards(item.openingId);
        setPendingCardList(siblings.length > 0 ? siblings : null);
      }
      setCard(c);
      setOpeningName(opening?.name ?? '');
      setYourColor(rep?.group === 'black' ? 'b' : 'w');
      setBoardStyle(style);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.cardId, item?.openingId, index, roundNumber]);

  // Gate in front of every "done with this card, move on" path (but not
  // Skip, which deliberately bypasses studying it at all) — a multi-board
  // card's overview pops up here, and `after` (the move-on that would
  // otherwise have happened right away) only runs once it's dismissed.
  function maybeShowOverview(after: () => void) {
    if (!card || card.boards.length <= 1) {
      after();
      return;
    }
    const text = (card.overviewText?.trim() || defaultOverviewText(card.mode, card.boards)).trim();
    if (!text) {
      after();
      return;
    }
    setPendingOverview({ text, boards: card.boards, mode: card.mode, after });
  }

  function dismissOverview() {
    const after = pendingOverview?.after;
    setPendingOverview(null);
    after?.();
  }

  // Preview never records a mistake or builds a retry queue — it just steps
  // through the same `round1` queue and order. Once it runs out, round 1
  // itself starts from the top of that same queue.
  function advancePreview() {
    const nextIndex = index + 1;
    if (nextIndex >= queue.length) {
      setPreviewing(false);
      setIndex(0);
      flashBanner('Your turn now — no more auto-play');
    } else {
      setIndex(nextIndex);
    }
  }

  // Preview, Others cards only — the front-to-back flip still happens by
  // itself (that's the card playing out), but moving on to the *next* card
  // waits for Continue (see the render below), same as Reactions/Plan.
  useEffect(() => {
    if (!previewing || card?.mode !== 'others' || previewPaused || previewShowBack) return;
    const t = setTimeout(() => setPreviewShowBack(true), OTHERS_PREVIEW_STEP_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewing, card?.mode, previewShowBack, previewPaused, index]);

  function advance(wrongItem: QueueItem | null) {
    if (wrongItem) wrongThisRoundRef.current.push(wrongItem);
    const nextIndex = index + 1;
    if (nextIndex >= queue.length) {
      if (roundNumber === 1 && firstRoundWrong.current === null) {
        firstRoundWrong.current = wrongThisRoundRef.current.length;
      }
      if (wrongThisRoundRef.current.length === 0) {
        setDone(true);
        return;
      }
      if (queue[0]?.guide) {
        setGuideRoundsExplain(true);
        return;
      }
      const nextQueue = shuffleCards ? shuffleArray(wrongThisRoundRef.current) : wrongThisRoundRef.current;
      wrongThisRoundRef.current = [];
      setRoundNumber((r) => r + 1);
      setQueue(nextQueue);
      setIndex(0);
    } else {
      setIndex(nextIndex);
    }
  }

  function handleRestart() {
    wrongThisRoundRef.current = [];
    firstRoundWrong.current = null;
    setRoundNumber(1);
    setQueue(shuffleCards ? shuffleArray(round1) : round1);
    setIndex(0);
    setDone(false);
  }

  async function handleEditCard() {
    if (!card || item?.guide) return;
    // Reactions/Plan show one board at a time — jump straight into whatever
    // board is actually on screen right now instead of the card's board
    // list, which would otherwise make you go find and open it yourself.
    // Others has no single "current" board (every board is shown at once),
    // so it always falls through to the card editor below.
    if ((card.mode === 'reactions' || card.mode === 'plan') && currentBoardRef.current) {
      const updated = await openReactionBoardEditor(
        currentBoardRef.current,
        card.mode,
        yourColor,
        boardStyle,
        card.mode === 'reactions' ? currentCursorRef.current : undefined
      );
      if (!updated) return;
      const updatedCard = { ...card, boards: card.boards.map((b) => (b.id === updated.id ? updated : b)) };
      await saveCard(updatedCard);
      setCard(updatedCard);
      currentBoardRef.current = updated;
      return;
    }
    const result = await openCardEditor(card.id);
    if (result.deleted) {
      const deleted = result.deletedCard;
      if (deleted) {
        showSnackbar({
          message: `Deleted "${deleted.name || 'card'}"`,
          actionLabel: 'Undo',
          onAction: () => {
            restoreCard(deleted);
          }
        });
      }
      advance(null);
    } else if (result.changed) {
      const refreshed = await getCard(card.id);
      if (refreshed) setCard(refreshed);
    }
  }

  // Leaving a session in progress asks first (the guide and the finished
  // screen just close).
  async function handleExit() {
    if (item?.guide || done) {
      close();
      return;
    }
    const left = queue.length - index;
    const ok = await confirmDialog(`Stop this session? ${left} card${left === 1 ? '' : 's'} left.`, {
      confirmLabel: 'Stop',
      cancelLabel: 'Keep studying'
    });
    if (ok) close();
  }

  function handleSkip() {
    if (!item) return;
    if (previewing) {
      advancePreview();
      return;
    }
    advance(item);
  }

  useOverlayBack(() => handleExit());

  if (done) {
    return (
      <SafeAreaView style={styles.overlay}>
        <View style={styles.doneScreen}>
          <View style={StyleSheet.absoluteFill} pointerEvents="none">
            {CONFETTI.map((c, i) => (
              <View
                key={i}
                style={{
                  position: 'absolute',
                  left: `${c.x}%`,
                  top: c.y,
                  width: 8,
                  height: 8,
                  borderRadius: c.round ? 4 : 2,
                  backgroundColor: c.color,
                  transform: [{ rotate: `${c.rotate}deg` }]
                }}
              />
            ))}
          </View>
          <View style={styles.doneCheck}>
            <Text style={{ fontSize: 40, color: colors.onPrimary }}>✓</Text>
          </View>
          <Text style={styles.doneTitle}>Done!</Text>
          {!queue[0]?.guide && (
            <Text style={styles.doneSummary}>
              {round1.length} card{round1.length === 1 ? '' : 's'} · {round1.length - (firstRoundWrong.current ?? 0)} right first time
              {(firstRoundWrong.current ?? 0) > 0 ? ` · ${firstRoundWrong.current} needed a retry` : ''}
              {roundNumber > 1 ? ` · ${roundNumber} rounds` : ''}
            </Text>
          )}
          <Text style={styles.doneSub}>
            {queue[0]?.guide ? GUIDE_DONE_TEXT : 'Great job — you completed the session.'}
          </Text>
          <View style={styles.doneActions}>
            <Pressable onPress={handleRestart} style={[styles.blockBtn, styles.primaryBtn]}>
              <Text style={[styles.blockBtnText, { color: colors.onPrimary }]}>Restart</Text>
            </Pressable>
            <Pressable onPress={close} style={[styles.blockBtn, styles.secondaryBtn]}>
              <Text style={[styles.blockBtnText, { color: colors.textPrimary }]}>Close</Text>
            </Pressable>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  // An opening's Summary takes over the whole screen before its first card:
  // blurred until Show (styled like Show solution), then Continue.
  if (pendingSummary) {
    return (
      <SafeAreaView style={styles.overlay}>
        <View style={overviewStyles.header}>
          <Text style={overviewStyles.headerTitle}>Summary</Text>
          {pendingSummary.openingName ? <MoveText text={pendingSummary.openingName} style={overviewStyles.headerSub} /> : null}
        </View>
        <ScrollView contentContainerStyle={overviewStyles.screenContent}>
          <MoveText text={pendingSummary.text} style={overviewStyles.text} blurred={!summaryRevealed} />
        </ScrollView>
        <View style={overviewStyles.footer}>
          {summaryRevealed ? (
            <Pressable onPress={() => setPendingSummary(null)} style={overviewStyles.continueBtn}>
              <Text style={overviewStyles.continueBtnText}>Continue</Text>
            </Pressable>
          ) : (
            <Pressable onPress={() => setSummaryRevealed(true)} style={overviewStyles.continueBtn}>
              <Text style={overviewStyles.continueBtnText}>Show</Text>
            </Pressable>
          )}
        </View>
      </SafeAreaView>
    );
  }

  // The Cards list comes after the opening's Summary (if any) and before the
  // card itself.
  if (pendingCardList && item) {
    return (
      <CardsListScreen
        openingName={openingName}
        cards={pendingCardList}
        currentId={item.cardId}
        boardStyle={boardStyle}
        yourColor={yourColor}
        onContinue={() => setPendingCardList(null)}
      />
    );
  }

  // A multi-board card's overview takes over the whole screen — a small
  // floating card couldn't fit the boards themselves at a readable size (see
  // OverviewBoards), and this is a deliberate full stop before moving on,
  // not a transient toast.
  if (pendingOverview) {
    return (
      <SafeAreaView style={styles.overlay}>
        <View style={overviewStyles.header}>
          <Text style={overviewStyles.headerTitle}>Overview</Text>
        </View>
        <ScrollView contentContainerStyle={overviewStyles.screenContent}>
          <MoveText text={pendingOverview.text} style={overviewStyles.text} />
          <OverviewBoards boards={pendingOverview.boards} mode={pendingOverview.mode} boardStyle={boardStyle} yourColor={yourColor} />
        </ScrollView>
        <View style={overviewStyles.footer}>
          <Pressable onPress={dismissOverview} style={overviewStyles.continueBtn}>
            <Text style={overviewStyles.continueBtnText}>Continue</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  if (!card) {
    return <SafeAreaView style={styles.overlay} />;
  }

  const total = queue.length;

  function advanceCoach() {
    // The study moment that started this step is used up, so the next time
    // it happens (e.g. your next turn) it can start a later step instead of
    // counting as already seen.
    const finished = visibleCoachStep;
    if (finished && finished.when !== 'next') {
      const key = `${item.cardId}:${finished.when}`;
      setCoachEvents((s) => {
        const n = new Set(s);
        n.delete(key);
        return n;
      });
    }
    setCoachProgress((p) => ({ ...p, [item.cardId]: (p[item.cardId] ?? 0) + 1 }));
  }

  // Study components report what just happened: moments that arm a waiting
  // step, or a Hint / Show solution press that finishes a step waiting on it.
  function handleGuideEvent(event: CoachEvent) {
    if (!item?.guide) return;
    if (event === 'branchIntro' || event === 'yourTurn' || event === 'allDone') {
      const key = `${item.cardId}:${event}`;
      setCoachEvents((s) => (s.has(key) ? s : new Set(s).add(key)));
      return;
    }
    if (visibleCoachStep?.advance === event) advanceCoach();
  }

  // The step of the guide's coach popups that's showing right now, if any: the
  // card's next unfinished step, once the study moment it waits for (if any)
  // has happened.
  const coachSteps = item?.guide ? GUIDE_COACH[item.cardId] : undefined;
  const coachStep = coachSteps ? coachSteps[coachProgress[item.cardId] ?? 0] : undefined;
  // The card on screen is the one that's actually up next. Right after a card
  // ends there's a render where `item` has already moved on but `card` still
  // holds the previous one; nothing card-specific (the study screen, its
  // popups) should be shown or acted on for that render.
  const cardReady = card.id === item?.cardId;
  const visibleCoachStep =
    cardReady && coachStep && (coachStep.when === 'next' || coachEvents.has(`${item.cardId}:${coachStep.when}`))
      ? coachStep
      : null;

  // What the coach is showing: the rounds explanation once the guide is over,
  // otherwise the card's current step.
  const coachStepShown = guideRoundsExplain ? GUIDE_ROUNDS_STEP : visibleCoachStep;
  const coachTargetRef =
    coachStepShown && coachStepShown.target !== 'screen' ? guideTargets[coachStepShown.target] : undefined;
  const roundsChoices: CoachChoice[] = [
    { label: 'Go to Home', onPress: close },
    {
      label: 'Make my first card',
      onPress: () => {
        close();
        tutorial.start();
      }
    }
  ];

  return (
    <SafeAreaView style={styles.overlay}>
      {bannerText && (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.roundBanner,
            { opacity: bannerAnim, transform: [{ translateY: bannerAnim.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }] }
          ]}
        >
          <Text style={styles.roundBannerText}>{bannerText}</Text>
        </Animated.View>
      )}
      <ScrollView ref={scrollRef} contentContainerStyle={styles.content}>
        <View style={styles.topBar}>
          <BackCircleButton onPress={handleExit} />
          <View style={styles.titleGroup}>
            <MoveText text={openingName} style={styles.openingLabel} numberOfLines={1} />
            <MoveText text={card?.name || 'Untitled card'} style={styles.title} numberOfLines={1} />
          </View>
          <View style={{ width: 38 }} />
        </View>

        <View style={styles.progressHeaderRow}>
          <View style={[styles.roundBadge, previewing ? styles.roundBadgePreview : roundNumber > 1 && styles.roundBadgeRetry]}>
            <Text style={[styles.roundLabel, previewing ? styles.roundLabelPreview : roundNumber > 1 && styles.roundLabelRetry]}>
              {previewing ? 'Preview' : `Round ${roundNumber}`}
            </Text>
          </View>
          <Text style={styles.progressCount}>
            {index + 1} / {total}
          </Text>
        </View>
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${((index + 1) / total) * 100}%` }]} />
        </View>

        {!cardReady ? (
          <View style={styles.studyCard} />
        ) : card.mode === 'reactions' ? (
          <View style={styles.studyCard}>
            <ReactionStudy
              key={`${roundNumber}-${index}`}
              card={card}
              yourColor={yourColor}
              boardStyle={boardStyle}
              onResult={previewing ? () => maybeShowOverview(advancePreview) : (correct) => maybeShowOverview(() => advance(correct ? null : item))}
              boardRef={currentBoardRef}
              cursorRef={currentCursorRef}
              paused={previewing ? previewPaused : Boolean(visibleCoachStep?.pause)}
              preview={previewing}
              onTogglePause={previewing ? () => setPreviewPaused((p) => !p) : undefined}
              guideTargets={item?.guide ? guideTargets : undefined}
              onGuideEvent={item?.guide ? handleGuideEvent : undefined}
            />
          </View>
        ) : card.mode === 'plan' ? (
          <View style={styles.studyCard}>
            <PlanStudy
              key={`${roundNumber}-${index}`}
              card={card}
              yourColor={yourColor}
              boardStyle={boardStyle}
              onResult={previewing ? () => maybeShowOverview(advancePreview) : (correct) => maybeShowOverview(() => advance(correct ? null : item))}
              boardRef={currentBoardRef}
              onEditBoard={item?.guide ? undefined : handleEditCard}
              preview={previewing}
              paused={previewPaused}
              onTogglePause={() => setPreviewPaused((p) => !p)}
              guideTargets={item?.guide ? guideTargets : undefined}
              onGuideEvent={item?.guide ? handleGuideEvent : undefined}
            />
          </View>
        ) : previewing ? (
          <View style={styles.studyCard}>
            <OthersBoardsView card={card} showBack={previewShowBack} yourColor={yourColor} boardStyle={boardStyle} />
            <View style={styles.navRow}>
              <Pressable
                onPress={() => setPreviewShowBack(false)}
                disabled={!previewShowBack}
                style={[styles.navBtn, !previewShowBack && styles.navBtnDisabled]}
              >
                <Text style={styles.navBtnText}>‹</Text>
              </Pressable>
              <Pressable onPress={() => setPreviewPaused((p) => !p)} style={styles.navBtn}>
                {previewPaused ? <PlayIcon size={18} color={colors.gold} /> : <PauseIcon size={18} color={colors.gold} />}
              </Pressable>
              <Pressable
                onPress={() => setPreviewShowBack(true)}
                disabled={previewShowBack}
                style={[styles.navBtn, previewShowBack && styles.navBtnDisabled]}
              >
                <Text style={styles.navBtnText}>›</Text>
              </Pressable>
            </View>
            {previewShowBack && (
              <Pressable onPress={() => maybeShowOverview(advancePreview)} style={styles.continueBtn}>
                <Text style={styles.continueText}>Continue</Text>
              </Pressable>
            )}
          </View>
        ) : (
          <>
            <Pressable onPress={() => setFlipped((f) => !f)} style={styles.studyCard}>
              <OthersBoardsView card={card} showBack={flipped} yourColor={yourColor} boardStyle={boardStyle} />
            </Pressable>
            <Text style={styles.hint}>Tap card to flip</Text>

          </>
        )}

      </ScrollView>

      <View style={styles.bottomBar}>
        {cardReady && card.mode === 'others' && !previewing && (
          <View style={styles.evalRow}>
            <Pressable
              disabled={!flipped}
              onPress={() => maybeShowOverview(() => advance(item))}
              style={[styles.evalBtn, { backgroundColor: colors.evalWrong, opacity: flipped ? 1 : 0.4 }]}
            >
              <Text style={styles.evalBtnText}>✕ Wrong</Text>
            </Pressable>
            <Pressable
              disabled={!flipped}
              onPress={() => maybeShowOverview(() => advance(null))}
              style={[styles.evalBtn, { backgroundColor: colors.evalRight, opacity: flipped ? 1 : 0.4 }]}
            >
              <Text style={styles.evalBtnText}>✓ Right</Text>
            </Pressable>
          </View>
        )}
        <View style={styles.footerRow}>
          {item?.guide ? <View style={{ width: 38 }} /> : <EditCircleButton onPress={handleEditCard} />}
          <Pressable onPress={handleSkip} style={styles.footerBtn}>
            <View style={styles.skipRow}>
              <SkipIcon size={18} color={colors.textDim} />
              <Text style={styles.skipLabel}>Skip</Text>
            </View>
            <Text style={styles.skipNote}>{previewing ? 'to next card' : 'counts as a slip'}</Text>
          </Pressable>
        </View>
      </View>

      <SnackbarLayer bottom={cardReady && card.mode === 'others' ? 130 : 72} />
      {item?.guide && (
        <GuideCoach
          step={coachStepShown}
          centered={!coachStepShown || coachStepShown.target === 'screen'}
          resolveTarget={() => coachTargetRef}
          watch={() => Object.values(guideTargets)}
          flipped={yourColor === 'b'}
          choices={guideRoundsExplain ? roundsChoices : undefined}
          onNext={advanceCoach}
        />
      )}
    </SafeAreaView>
  );
}

const overviewStyles = StyleSheet.create({
  header: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border
  },
  headerTitle: { color: colors.text, ...type.h2, textAlign: 'center' },
  headerSub: { color: colors.textDim, fontSize: 12.5, textAlign: 'center', marginTop: 2 },
  screenContent: { padding: 16, paddingBottom: 32, gap: 16 },
  text: { color: colors.text, fontSize: 15, lineHeight: 21 },
  footer: {
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: colors.border
  },
  continueBtn: {
    minHeight: touchTarget,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: radius.pill,
    backgroundColor: colors.primary
  },
  continueBtnText: { color: colors.onPrimary, fontSize: 15, fontWeight: '700' },
  boardsGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  boardTile: { width: '50%', alignItems: 'center', gap: 6, marginBottom: 12 },
  boardTileCaption: { color: colors.textDim, fontSize: 11, fontWeight: '600' }
});

const cardListStyles = StyleSheet.create({
  item: {
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.panel2,
    overflow: 'hidden'
  },
  itemCurrent: { borderColor: colors.accent, backgroundColor: colors.accentSubtle },
  row: {
    minHeight: touchTarget,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 8
  },
  name: { flex: 1, color: colors.textDim, fontSize: 15, fontWeight: '600' },
  nameCurrent: { color: colors.text, fontWeight: '700' },
  body: { paddingHorizontal: 14, paddingBottom: 14, gap: 12 },
  empty: { color: colors.textDim, fontSize: 13 }
});

// The home screen's "Study Your First Opening": the bundled Italian Game
// guide cards, in their fixed order (never shuffled).
// Asked right before a study session starts (both "Study this opening" and
// "Study this repertoire"): watch every line/arrow/face played out first, or
// go straight to studying? "No preview" first and in green — it's what
// studying has always meant here, so it stays the default-looking choice;
// preview is the new, opt-in one. `null` means the dialog was dismissed —
// callers treat that as "don't start the session at all", same as
// cancelling the card-type picker doesn't create a card either.
export async function askStudyPreview(): Promise<boolean | null> {
  return choiceDialog<boolean>('Preview the moves first, or start studying right away?', [
    { label: 'No preview', value: false, variant: 'primary' },
    { label: 'First preview', value: true, variant: 'secondary' }
  ]);
}

export async function startGuideSession(): Promise<void> {
  const round1: QueueItem[] = GUIDE_CARDS.map((c) => ({
    cardId: c.id,
    openingId: c.openingId,
    guide: { card: c, openingName: GUIDE_OPENING_NAME }
  }));
  await showOverlay<void>((close) => (
    <StudySessionOverlay round1={round1} shuffleCards={false} initialPreview={false} close={() => close(undefined)} />
  ));
}

export async function startStudySession(
  openingIds: string[],
  opts: { shuffleOpenings: boolean; preview: boolean }
): Promise<void> {
  const shuffleCards = await getSetting<boolean>('shuffle', false);

  let orderedOpenings = [...openingIds];
  if (opts.shuffleOpenings) {
    orderedOpenings = shuffleArray(orderedOpenings);
  }

  const round1: QueueItem[] = [];
  for (const openingId of orderedOpenings) {
    let cards = await getCards(openingId);
    if (shuffleCards) {
      cards = shuffleArray(cards);
    }
    for (const c of cards) {
      round1.push({ cardId: c.id, openingId });
    }
  }

  if (round1.length === 0) return;

  await showOverlay<void>((close) => (
    <StudySessionOverlay round1={round1} shuffleCards={shuffleCards} initialPreview={opts.preview} close={() => close(undefined)} />
  ));
}

const styles = StyleSheet.create({
  navRow: { flexDirection: 'row', gap: 10, marginTop: 12 },
  navBtn: { width: touchTarget, height: touchTarget, borderRadius: 10, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.panel2, alignItems: 'center', justifyContent: 'center' },
  navBtnDisabled: { opacity: 0.4 },
  navBtnText: { color: colors.text, fontSize: 18 },
  continueBtn: { marginTop: 12, minHeight: touchTarget, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 20, borderRadius: radius.pill, backgroundColor: colors.primary },
  continueText: { color: colors.onPrimary, fontSize: 14, fontWeight: '700' },
  overlay: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, paddingBottom: 32, flexGrow: 1 },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  topBarBtn: { color: colors.textDim, fontSize: 18 },
  titleGroup: { flex: 1, alignItems: 'center' },
  openingLabel: { color: colors.textDim, fontSize: 12.5, fontWeight: '600' },
  title: { color: colors.text, ...type.h2, textAlign: 'center' },
  progressHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  roundBadge: { paddingVertical: 3, paddingHorizontal: 10, borderRadius: radius.pill, backgroundColor: colors.panel2 },
  roundBadgeRetry: { backgroundColor: colors.gold },
  roundBadgePreview: { backgroundColor: colors.primary },
  roundLabel: { color: colors.textDim, fontSize: 13, fontWeight: '700' },
  roundLabelRetry: { color: colors.onGold },
  roundLabelPreview: { color: colors.onPrimary },
  roundBanner: {
    position: 'absolute',
    bottom: 24,
    left: 16,
    right: 16,
    zIndex: 10,
    backgroundColor: colors.gold,
    borderRadius: radius.pill,
    paddingVertical: 10,
    alignItems: 'center'
  },
  roundBannerText: { color: colors.onGold, fontSize: 14, fontWeight: '700' },
  progressCount: { color: colors.textDim, fontSize: 13 },
  progressTrack: { height: 6, backgroundColor: colors.panel2, borderRadius: 3, overflow: 'hidden', marginBottom: 16 },
  progressFill: { height: '100%', backgroundColor: colors.accent },
  studyCard: {
    backgroundColor: colors.panel,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 20,
    minHeight: 260,
    gap: 14,
    alignItems: 'center'
  },
  studyCardText: { color: colors.text, fontSize: 16, lineHeight: 24, alignSelf: 'stretch' },
  hint: { color: colors.textDim, fontSize: 12, textAlign: 'center', marginTop: 6 },
  evalRow: { flexDirection: 'row', gap: 12, marginBottom: 6 },
  evalBtn: { flex: 1, borderRadius: radius.pill, paddingVertical: 14, alignItems: 'center' },
  evalBtnText: { color: 'white', fontSize: 15, fontWeight: '700' },
  footerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 48
  },
  // Fixed below the scrolling card, so grading a card and Edit/Skip are always
  // in reach however tall the card is.
  bottomBar: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 4,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.bg
  },
  footerBtn: { minHeight: 48, alignItems: 'flex-end', justifyContent: 'center', paddingHorizontal: 4 },
  skipRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  skipLabel: { color: colors.textDim, fontSize: 14, fontWeight: '600' },
  skipNote: { color: colors.textDim, fontSize: 11, opacity: 0.8 },
  doneScreen: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, padding: 20 },
  doneCheck: {
    width: 90,
    height: 90,
    borderRadius: 45,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10
  },
  doneTitle: { color: colors.text, ...type.display },
  doneSummary: { color: colors.text, fontSize: 16, fontWeight: '600', textAlign: 'center' },
  doneSub: { color: colors.textDim, marginBottom: 20, textAlign: 'center' },
  doneActions: { gap: 10, width: '100%', maxWidth: 280 },
  blockBtn: { borderRadius: radius.pill, paddingVertical: 13, alignItems: 'center' },
  primaryBtn: { backgroundColor: colors.accent },
  secondaryBtn: { backgroundColor: colors.panel2, borderWidth: 1, borderColor: colors.border },
  blockBtnText: { color: 'white', fontSize: 15, fontWeight: '600' }
});
