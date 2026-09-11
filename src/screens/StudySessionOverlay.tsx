import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getCard, getCards, getOpening, getRepertoire, getSetting } from '../storage';
import { showOverlay } from '../overlay';
import type { Card } from '../types';
import { colors, radius, type } from '../theme';
import { ChessBoardView } from '../components/ChessBoard';
import { BackCircleButton, EditCircleButton } from '../components/Common';
import { openCardEditor } from './CardEditorOverlay';
import { ReactionStudy } from './ReactionStudy';

// "Others" cards: front and back show the same set of boards (they're
// kept in sync by the editor). Reactions cards use ReactionStudy instead.
function OthersBoardsView({ card }: { card: Card }) {
  if (card.boards.length === 0) return null;
  const sorted = [...card.boards].sort((a, b) => a.order - b.order);
  return (
    <View style={{ gap: 16, alignItems: 'center' }}>
      {sorted.map((b) => (
        <ChessBoardView
          key={b.id}
          board={{ pieces: b.pieces, style: b.style, arrows: b.arrows, circles: b.circles }}
          size={230}
        />
      ))}
    </View>
  );
}

interface QueueItem {
  cardId: string;
  openingId: string;
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
  const [openingName, setOpeningName] = useState('');
  const [yourColor, setYourColor] = useState<'w' | 'b'>('w');
  const [done, setDone] = useState(false);
  const wrongThisRoundRef = useRef<QueueItem[]>([]);

  const item = queue[index];

  useEffect(() => {
    if (!item) return;
    setFlipped(false);
    (async () => {
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
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.cardId, item?.openingId, index, roundNumber]);

  function advance(wrongItem: QueueItem | null) {
    if (wrongItem) wrongThisRoundRef.current.push(wrongItem);
    const nextIndex = index + 1;
    if (nextIndex >= queue.length) {
      if (wrongThisRoundRef.current.length === 0) {
        setDone(true);
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
    setRoundNumber(1);
    setQueue(shuffleCards ? shuffleArray(round1) : round1);
    setIndex(0);
    setDone(false);
  }

  async function handleEditCard() {
    if (!card) return;
    const result = await openCardEditor(card.id);
    if (result.deleted) {
      advance(null);
    } else if (result.changed) {
      const refreshed = await getCard(card.id);
      if (refreshed) setCard(refreshed);
    }
  }

  function handleSkip() {
    if (!item) return;
    advance(item);
  }

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
          <Text style={styles.doneSub}>Great job — you completed the session.</Text>
          <View style={styles.doneActions}>
            <Pressable onPress={handleRestart} style={[styles.blockBtn, styles.primaryBtn]}>
              <Text style={[styles.blockBtnText, { color: colors.onPrimary }]}>Restart</Text>
            </Pressable>
            <Pressable onPress={close} style={[styles.blockBtn, styles.secondaryBtn]}>
              <Text style={[styles.blockBtnText, { color: colors.textPrimary }]}>Back to home</Text>
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
  const face = flipped ? card.back : card.front;

  return (
    <SafeAreaView style={styles.overlay}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.topBar}>
          <BackCircleButton onPress={close} />
          <Text style={styles.title} numberOfLines={1}>
            {openingName}
          </Text>
          <View style={{ width: 38 }} />
        </View>

        <View style={styles.progressHeaderRow}>
          <Text style={styles.roundLabel}>Round {roundNumber}</Text>
          <Text style={styles.progressCount}>
            {index + 1} / {total}
          </Text>
        </View>
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${((index + 1) / total) * 100}%` }]} />
        </View>

        {card.mode === 'reactions' ? (
          <View style={styles.studyCard}>
            {card.front.text ? <Text style={styles.studyCardText}>{card.front.text}</Text> : null}
            <ReactionStudy
              key={`${roundNumber}-${index}`}
              card={card}
              yourColor={yourColor}
              onResult={(correct) => advance(correct ? null : item)}
            />
          </View>
        ) : (
          <>
            <Pressable onPress={() => setFlipped((f) => !f)} style={styles.studyCard}>
              {face.text ? <Text style={styles.studyCardText}>{face.text}</Text> : null}
              {card.boards.length > 0 ? (
                <OthersBoardsView card={card} />
              ) : (
                face.board && <ChessBoardView board={face.board} size={260} />
              )}
            </Pressable>
            <Text style={styles.hint}>Tap card to flip</Text>

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
          </>
        )}

        <View style={styles.footerRow}>
          <EditCircleButton onPress={handleEditCard} />
          <Text style={styles.footerCount}>
            {index + 1} / {total}
          </Text>
          <Pressable onPress={handleSkip} style={styles.footerBtn}>
            <Text style={styles.footerIcon}>▶</Text>
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
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
  progressHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  roundLabel: { color: colors.textDim, fontSize: 13, fontWeight: '600' },
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
  evalRow: { flexDirection: 'row', gap: 12, marginTop: 16 },
  evalBtn: { flex: 1, borderRadius: radius.pill, paddingVertical: 14, alignItems: 'center' },
  evalBtnText: { color: 'white', fontSize: 15, fontWeight: '700' },
  footerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 18,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: colors.border
  },
  footerBtn: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  footerIcon: { color: colors.textDim, fontSize: 18 },
  footerCount: { color: colors.textDim, fontSize: 13 },
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
  doneSub: { color: colors.textDim, marginBottom: 20, textAlign: 'center' },
  doneActions: { gap: 10, width: '100%', maxWidth: 280 },
  blockBtn: { borderRadius: radius.pill, paddingVertical: 13, alignItems: 'center' },
  primaryBtn: { backgroundColor: colors.accent },
  secondaryBtn: { backgroundColor: colors.panel2, borderWidth: 1, borderColor: colors.border },
  blockBtnText: { color: 'white', fontSize: 15, fontWeight: '600' }
});
