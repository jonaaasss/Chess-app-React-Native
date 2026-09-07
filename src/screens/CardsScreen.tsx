import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  PanResponder,
  PanResponderInstance,
  StyleSheet,
  LayoutChangeEvent,
  useWindowDimensions
} from 'react-native';
import {
  addCard,
  deleteCard,
  getCards,
  getOpening,
  getRepertoire,
  renameOpening,
  reorderCards
} from '../storage';
import { confirmDialog, anchoredMenu } from '../overlay';
import type { Card, Opening, Repertoire } from '../types';
import { Screen, TopBar, Breadcrumb, BigButton } from '../components/Common';
import { PieceGlyph } from '../components/ChessBoard';
import { colors, radius, spacing, type } from '../theme';
import { openCardEditor } from './CardEditorOverlay';
import { startStudySession } from './StudySessionOverlay';

function cardPreviewText(card: Card): string {
  const t = card.front.text.trim();
  if (t) return t.split('\n')[0].slice(0, 60);
  if (card.front.board) return '(board only)';
  return '(empty card)';
}

const DEFAULT_ROW_HEIGHT = 60;

// Same "⋮" treatment as the opening/repertoire rows: a small plain-text
// popover pinned right under the button instead of a full-screen menu.
function CardRow({
  card,
  idx,
  isDragging,
  responder,
  onLayout,
  onOpen,
  onDelete
}: {
  card: Card;
  idx: number;
  isDragging: boolean;
  responder: PanResponderInstance;
  onLayout?: (e: LayoutChangeEvent) => void;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const menuRef = useRef<View>(null);

  function openMenu() {
    menuRef.current?.measureInWindow(async (x, y, width, height) => {
      const action = await anchoredMenu(['Delete'], { x, y, width, height });
      if (action === 'Delete') onDelete();
    });
  }

  return (
    <View onLayout={onLayout} style={[styles.row, isDragging && styles.rowDragging]}>
      <View {...responder.panHandlers} style={styles.dragHandle}>
        <Text style={{ color: colors.textDim, fontSize: 18 }}>≡</Text>
      </View>
      <Pressable onPress={onOpen} style={styles.main}>
        <Text style={styles.mainText} numberOfLines={1}>
          {idx + 1}. {cardPreviewText(card)}
        </Text>
      </Pressable>
      <Pressable ref={menuRef} onPress={openMenu} style={styles.menuBtn}>
        <Text style={{ color: colors.textDim, fontSize: 18 }}>⋮</Text>
      </Pressable>
    </View>
  );
}

export function CardsScreen({
  openingId,
  onBack
}: {
  openingId: string;
  onBack: () => void;
}) {
  const [opening, setOpening] = useState<Opening | null>(null);
  const [rep, setRep] = useState<Repertoire | null>(null);
  const [cards, setCards] = useState<Card[]>([]);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const rowHeightRef = useRef(DEFAULT_ROW_HEIGHT);
  const snapshotRef = useRef<Card[]>([]);
  const { width } = useWindowDimensions();
  const emptyPieceSize = Math.min(width * 0.55, 240);

  const load = useCallback(async () => {
    const o = await getOpening(openingId);
    if (!o) {
      onBack();
      return;
    }
    setOpening(o);
    const r = await getRepertoire(o.repertoireId);
    if (!r) {
      onBack();
      return;
    }
    setRep(r);
    const cs = await getCards(openingId);
    setCards(cs);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openingId]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleRenameOpening(name: string) {
    if (!opening) return;
    await renameOpening(opening.id, name);
    load();
  }

  async function handleStudy() {
    if (cards.length === 0) return;
    await startStudySession([openingId], { shuffleOpenings: false });
    load();
  }

  async function handleAddCard() {
    const card = await addCard(openingId);
    await openCardEditor(card.id);
    load();
  }

  async function handleOpenCard(card: Card) {
    const result = await openCardEditor(card.id);
    if (result.changed) load();
  }

  async function handleDeleteCard(card: Card) {
    const ok = await confirmDialog('Delete this card?');
    if (ok) {
      await deleteCard(card.id);
      load();
    }
  }

  function makeResponder(cardId: string): PanResponderInstance {
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, gesture) => Math.abs(gesture.dy) > 4,
      onPanResponderGrant: () => {
        snapshotRef.current = cards;
        setDraggingId(cardId);
      },
      onPanResponderMove: (_, gesture) => {
        const base = [...snapshotRef.current];
        const idx = base.findIndex((c) => c.id === cardId);
        if (idx === -1) return;
        const [item] = base.splice(idx, 1);
        const deltaIndex = Math.round(gesture.dy / rowHeightRef.current);
        const targetIdx = Math.max(0, Math.min(base.length, idx + deltaIndex));
        base.splice(targetIdx, 0, item);
        setCards(base);
      },
      onPanResponderRelease: () => {
        setDraggingId(null);
        setCards((current) => {
          reorderCards(openingId, current.map((c) => c.id));
          return current;
        });
      },
      onPanResponderTerminate: () => {
        setDraggingId(null);
        setCards(snapshotRef.current);
      }
    });
  }

  function handleRowLayout(e: LayoutChangeEvent) {
    if (e.nativeEvent.layout.height > 0) {
      rowHeightRef.current = e.nativeEvent.layout.height + 10;
    }
  }

  if (!opening || !rep) return <Screen>{null}</Screen>;

  return (
    <Screen>
      <Breadcrumb text={`${rep.group === 'white' ? 'White' : 'Black'} › ${rep.name} › ${opening.name}`} />
      <TopBar title={opening.name} onBack={onBack} onRename={handleRenameOpening} />

      <BigButton title="+ Add card" onPress={handleAddCard} />
      <View style={{ height: spacing.lg }} />

      {cards.length === 0 ? (
        <View style={emptyStyles.wrap}>
          <PieceGlyph code={rep.group === 'white' ? 'wN' : 'bN'} cell={emptyPieceSize} />
          <Text style={emptyStyles.text}>No cards yet. Add one to get started.</Text>
        </View>
      ) : (
        <>
          {cards.map((card, idx) => (
            <CardRow
              key={card.id}
              card={card}
              idx={idx}
              isDragging={draggingId === card.id}
              responder={makeResponder(card.id)}
              onLayout={idx === 0 ? handleRowLayout : undefined}
              onOpen={() => handleOpenCard(card)}
              onDelete={() => handleDeleteCard(card)}
            />
          ))}

          {/* Pushes the Study CTA to the bottom of the screen, matching the
              repertoire/openings screens' layout. */}
          <View style={{ flex: 1, minHeight: 24 }} />
        </>
      )}

      {cards.length > 0 && <BigButton title="▶ Study this opening" onPress={handleStudy} variant="gold" />}
    </Screen>
  );
}

const emptyStyles = {
  wrap: { flex: 1, alignItems: 'center' as const, justifyContent: 'center' as const, paddingVertical: spacing.xxl },
  text: { color: colors.textSecondary, ...type.body, textAlign: 'center' as const, marginTop: spacing.lg }
};

const styles = StyleSheet.create({
  row: {
    backgroundColor: colors.panel,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 10,
    flexDirection: 'row',
    alignItems: 'center'
  },
  rowDragging: { opacity: 0.85, borderColor: colors.accent },
  dragHandle: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  main: { flex: 1, paddingVertical: 14, justifyContent: 'center', minHeight: 44 },
  mainText: { color: colors.text, fontSize: 15, fontWeight: '500' },
  menuBtn: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }
});
