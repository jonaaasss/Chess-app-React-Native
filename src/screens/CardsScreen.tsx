import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, PanResponder, PanResponderInstance, StyleSheet, LayoutChangeEvent } from 'react-native';
import {
  addCard,
  deleteCard,
  deleteOpening,
  getCards,
  getOpening,
  getRepertoire,
  renameOpening,
  reorderCards
} from '../storage';
import { confirmDialog, promptDialog, simpleMenu } from '../overlay';
import type { Card, Opening, Repertoire } from '../types';
import { Screen, TopBar, Breadcrumb, EmptyState, BigButton } from '../components/Common';
import { colors, radius } from '../theme';
import { openCardEditor } from './CardEditorOverlay';
import { startStudySession } from './StudySessionOverlay';

function cardPreviewText(card: Card): string {
  const t = card.front.text.trim();
  if (t) return t.split('\n')[0].slice(0, 60);
  if (card.front.board) return '(board only)';
  return '(empty card)';
}

const DEFAULT_ROW_HEIGHT = 60;

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

  async function handleEditOpening() {
    if (!opening) return;
    const action = await simpleMenu(['Rename opening', 'Delete opening'], 'Edit Opening');
    if (action === 'Rename opening') {
      const name = await promptDialog('Rename opening', opening.name);
      if (name) {
        await renameOpening(opening.id, name);
        load();
      }
    } else if (action === 'Delete opening') {
      const ok = await confirmDialog(`Delete "${opening.name}" and all its cards?`);
      if (ok) {
        await deleteOpening(opening.id);
        onBack();
      }
    }
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

  async function handleMenu(card: Card) {
    const action = await simpleMenu(['Delete']);
    if (action === 'Delete') {
      const ok = await confirmDialog('Delete this card?');
      if (ok) {
        await deleteCard(card.id);
        load();
      }
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
      <Breadcrumb text={`${rep.group === 'white' ? 'White' : 'Black'} › ${rep.name}`} />
      <TopBar title={opening.name} onBack={onBack} onEdit={handleEditOpening} />

      <BigButton title="▶ Study this opening" onPress={handleStudy} variant="gold" />

      {cards.length === 0 && <EmptyState text="No cards yet. Add one to get started." />}

      {cards.map((card, idx) => {
        const responder = makeResponder(card.id);
        return (
          <View
            key={card.id}
            onLayout={idx === 0 ? handleRowLayout : undefined}
            style={[styles.row, draggingId === card.id && styles.rowDragging]}
          >
            <View {...responder.panHandlers} style={styles.dragHandle}>
              <Text style={{ color: colors.textDim, fontSize: 18 }}>≡</Text>
            </View>
            <Pressable onPress={() => handleOpenCard(card)} style={styles.main}>
              <Text style={styles.mainText} numberOfLines={1}>
                {idx + 1}. {cardPreviewText(card)}
              </Text>
            </Pressable>
            <Pressable onPress={() => handleMenu(card)} style={styles.menuBtn}>
              <Text style={{ color: colors.textDim, fontSize: 18 }}>⋮</Text>
            </Pressable>
          </View>
        );
      })}

      <BigButton title="+ Add card" onPress={handleAddCard} />
    </Screen>
  );
}

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
