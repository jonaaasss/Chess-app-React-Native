import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  useWindowDimensions
} from 'react-native';
import {
  addCard,
  deleteCard,
  getCards,
  getOpening,
  getRepertoire,
  renameCard,
  renameOpening
} from '../storage';
import { confirmDialog, promptDialog, anchoredMenu } from '../overlay';
import type { Card, Opening, PieceCode, Repertoire } from '../types';
import { Screen, TopBar, Breadcrumb, BigButton, PieceBadge } from '../components/Common';
import { colors, radius, spacing, type } from '../theme';
import { openCardEditor } from './CardEditorOverlay';
import { startStudySession } from './StudySessionOverlay';

function cardPreviewText(card: Card): string {
  const firstBoard = [...card.boards].sort((a, b) => a.order - b.order)[0];
  // Plan's single description lives on the back (see descriptionFace in
  // CardEditorOverlay) — everything else uses the front.
  const face = card.mode === 'plan' ? firstBoard?.back : firstBoard?.front;
  const t = face?.text.trim();
  if (t) return t.split('\n')[0].slice(0, 60);
  return '(board only)';
}

// Same "⋮" treatment as the opening/repertoire rows: a plain-text popover
// pinned under the button, and "Rename" edits the name in place.
function CardRow({
  card,
  idx,
  piece,
  onOpen,
  onRename,
  onDelete
}: {
  card: Card;
  idx: number;
  piece: PieceCode;
  onOpen: () => void;
  onRename: (newName: string) => void;
  onDelete: () => void;
}) {
  const menuRef = useRef<View>(null);
  const inputRef = useRef<TextInput>(null);
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(card.name);
  const label = card.name || cardPreviewText(card);

  useEffect(() => {
    if (!editing) return;
    const t = setTimeout(() => inputRef.current?.focus(), 50);
    return () => clearTimeout(t);
  }, [editing]);

  function startEdit() {
    setValue(card.name);
    setEditing(true);
  }

  function commitEdit() {
    setEditing(false);
    const trimmed = value.trim();
    if (trimmed && trimmed !== card.name) onRename(trimmed);
  }

  function openMenu() {
    menuRef.current?.measureInWindow(async (x, y, width, height) => {
      const action = await anchoredMenu(['Rename', 'Delete'], { x, y, width, height });
      if (action === 'Rename') startEdit();
      else if (action === 'Delete') onDelete();
    });
  }

  return (
    <View style={styles.row}>
      {editing ? (
        <View style={styles.main}>
          <PieceBadge code={piece} size={52} />
          <TextInput
            ref={inputRef}
            style={[styles.mainText, styles.mainInput]}
            value={value}
            onChangeText={setValue}
            onSubmitEditing={commitEdit}
            onBlur={commitEdit}
            returnKeyType="done"
          />
        </View>
      ) : (
        <Pressable onPress={onOpen} style={styles.main}>
          <PieceBadge code={piece} size={52} />
          <Text style={styles.mainText} numberOfLines={1}>
            {idx + 1}. {label}
          </Text>
        </Pressable>
      )}
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
    const name = await promptDialog('New card', '', 'e.g. Italian — main line');
    if (!name) return;
    const card = await addCard(openingId, name);
    await openCardEditor(card.id);
    load();
  }

  async function handleOpenCard(card: Card) {
    const result = await openCardEditor(card.id);
    if (result.changed) load();
  }

  async function handleRenameCard(card: Card, name: string) {
    await renameCard(card.id, name);
    load();
  }

  async function handleDeleteCard(card: Card) {
    const ok = await confirmDialog('Delete this card?');
    if (ok) {
      await deleteCard(card.id);
      load();
    }
  }

  if (!opening || !rep) return <Screen>{null}</Screen>;

  const cardPiece: PieceCode = rep.group === 'white' ? 'wN' : 'bN';

  return (
    <Screen>
      <Breadcrumb text={`${rep.group === 'white' ? 'White' : 'Black'} › ${rep.name} › ${opening.name}`} piece={cardPiece} />
      <TopBar title={opening.name} onBack={onBack} onRename={handleRenameOpening} />

      <BigButton title="+ Add card" onPress={handleAddCard} />
      <View style={{ height: spacing.lg }} />

      {cards.length === 0 ? (
        <View style={emptyStyles.wrap}>
          <PieceBadge code={cardPiece} size={emptyPieceSize} />
          <Text style={emptyStyles.text}>No cards yet. Add one to get started.</Text>
        </View>
      ) : (
        <>
          {cards.map((card, idx) => (
            <CardRow
              key={card.id}
              card={card}
              idx={idx}
              piece={cardPiece}
              onOpen={() => handleOpenCard(card)}
              onRename={(name) => handleRenameCard(card, name)}
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
  main: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 14, paddingLeft: spacing.lg, minHeight: 44 },
  mainText: { color: colors.text, fontSize: 15, fontWeight: '500', flex: 1 },
  mainInput: { padding: 0, borderBottomWidth: 1, borderBottomColor: colors.accent },
  menuBtn: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }
});
