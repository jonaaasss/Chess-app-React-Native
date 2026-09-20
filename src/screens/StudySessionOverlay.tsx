import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView, Animated } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';
import { getBoardStyle, getCard, getCards, getOpening, getRepertoire, getSetting, restoreCard, saveCard } from '../storage';
import { confirmDialog, showOverlay, showSnackbar, SnackbarLayer, useOverlayBack } from '../overlay';
import type { Card, ReactionBoard } from '../types';
import { colors, radius, type } from '../theme';
import { ChessBoardView } from '../components/ChessBoard';
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
        return (
          <View key={b.id} style={{ alignItems: 'center', gap: 10 }}>
            {face.text ? <Text style={styles.studyCardText}>{face.text}</Text> : null}
            <ChessBoardView
              board={{ pieces: face.pieces, style: boardStyle, arrows: face.arrows, circles: face.circles }}
              size={230}
              flipped={yourColor === 'b'}
            />
          </View>
        );
      })}
    </View>
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
  close
}: {
  round1: QueueItem[];
  shuffleCards: boolean;
  close: () => void;
}) {
  const [roundNumber, setRoundNumber] = useState(1);
  const [queue, setQueue] = useState<QueueItem[]>(round1);
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [card, setCard] = useState<Card | null>(null);
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
  const [roundBanner, setRoundBanner] = useState(0); // the round number a banner is currently announcing, 0 = none
  const wrongThisRoundRef = useRef<QueueItem[]>([]);
  // How many cards weren't right first time (known once round 1 is over), for
  // the summary at the end.
  const firstRoundWrong = useRef<number | null>(null);
  const bannerAnim = useRef(new Animated.Value(0)).current;
  const seenRoundRef = useRef(1);

  const item = queue[index];

  // A new round means "retrying what you got wrong" — flash a clear,
  // impossible-to-miss banner when it starts, not just a small label.
  useEffect(() => {
    if (roundNumber === seenRoundRef.current) return;
    seenRoundRef.current = roundNumber;
    if (roundNumber === 1) return;
    setRoundBanner(roundNumber);
    bannerAnim.setValue(0);
    Animated.sequence([
      Animated.timing(bannerAnim, { toValue: 1, duration: 200, useNativeDriver: true }),
      Animated.delay(1400),
      Animated.timing(bannerAnim, { toValue: 0, duration: 300, useNativeDriver: true })
    ]).start(() => setRoundBanner(0));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roundNumber]);

  useEffect(() => {
    if (!item) return;
    setFlipped(false);
    currentBoardRef.current = null;
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
      setCard(c);
      const opening = await getOpening(item.openingId);
      setOpeningName(opening?.name ?? '');
      const rep = opening ? await getRepertoire(opening.repertoireId) : undefined;
      setYourColor(rep?.group === 'black' ? 'b' : 'w');
      setBoardStyle(await getBoardStyle());
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.cardId, item?.openingId, index, roundNumber]);

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
      const updated = await openReactionBoardEditor(currentBoardRef.current, card.mode, yourColor, boardStyle);
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
      {roundBanner > 0 && (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.roundBanner,
            { opacity: bannerAnim, transform: [{ translateY: bannerAnim.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }] }
          ]}
        >
          <Text style={styles.roundBannerText}>Round {roundBanner} — retrying your mistakes</Text>
        </Animated.View>
      )}
      <ScrollView ref={scrollRef} contentContainerStyle={styles.content}>
        <View style={styles.topBar}>
          <BackCircleButton onPress={handleExit} />
          <Text style={styles.title} numberOfLines={1}>
            {openingName}
          </Text>
          <View style={{ width: 38 }} />
        </View>

        <View style={styles.progressHeaderRow}>
          <View style={[styles.roundBadge, roundNumber > 1 && styles.roundBadgeRetry]}>
            <Text style={[styles.roundLabel, roundNumber > 1 && styles.roundLabelRetry]}>Round {roundNumber}</Text>
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
              onResult={(correct) => advance(correct ? null : item)}
              boardRef={currentBoardRef}
              paused={Boolean(visibleCoachStep?.pause)}
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
              onResult={(correct) => advance(correct ? null : item)}
              boardRef={currentBoardRef}
              onEditBoard={item?.guide ? undefined : handleEditCard}
              guideTargets={item?.guide ? guideTargets : undefined}
              onGuideEvent={item?.guide ? handleGuideEvent : undefined}
            />
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
        {cardReady && card.mode === 'others' && (
          <View style={styles.evalRow}>
            <Pressable
              disabled={!flipped}
              onPress={() => advance(item)}
              style={[styles.evalBtn, { backgroundColor: colors.evalWrong, opacity: flipped ? 1 : 0.4 }]}
            >
              <Text style={styles.evalBtnText}>✕ Wrong</Text>
            </Pressable>
            <Pressable
              disabled={!flipped}
              onPress={() => advance(null)}
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
            <Text style={styles.skipNote}>counts as a slip</Text>
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

// The home screen's "Study Your First Opening": the bundled Italian Game
// guide cards, in their fixed order (never shuffled).
export async function startGuideSession(): Promise<void> {
  const round1: QueueItem[] = GUIDE_CARDS.map((c) => ({
    cardId: c.id,
    openingId: c.openingId,
    guide: { card: c, openingName: GUIDE_OPENING_NAME }
  }));
  await showOverlay<void>((close) => (
    <StudySessionOverlay round1={round1} shuffleCards={false} close={() => close(undefined)} />
  ));
}

export async function startStudySession(
  openingIds: string[],
  opts: { shuffleOpenings: boolean }
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
    <StudySessionOverlay round1={round1} shuffleCards={shuffleCards} close={() => close(undefined)} />
  ));
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, paddingBottom: 32, flexGrow: 1 },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  topBarBtn: { color: colors.textDim, fontSize: 18 },
  title: { color: colors.text, ...type.h2, flex: 1, textAlign: 'center' },
  progressHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  roundBadge: { paddingVertical: 3, paddingHorizontal: 10, borderRadius: radius.pill, backgroundColor: colors.panel2 },
  roundBadgeRetry: { backgroundColor: colors.gold },
  roundLabel: { color: colors.textDim, fontSize: 13, fontWeight: '700' },
  roundLabelRetry: { color: colors.onGold },
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
