import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, Pressable, useWindowDimensions } from 'react-native';
import {
  addOpening,
  deleteOpening,
  getCards,
  getOpenings,
  getRepertoire,
  renameOpening,
  renameRepertoire
} from '../storage';
import { confirmDialog, promptDialog, anchoredMenu } from '../overlay';
import type { Opening, PieceCode, Repertoire } from '../types';
import { Screen, TopBar, Breadcrumb, BigButton, PieceBadge, rowStyles } from '../components/Common';
import { useTutorial, useTutorialTarget } from '../tutorial';
import { colors, spacing, type } from '../theme';
import { startStudySession } from './StudySessionOverlay';

// Used only on this screen: the opening row's "⋮" opens a small plain-text
// popover pinned right under the button (no card/backdrop) instead of the
// full-screen Rename/Delete menu used elsewhere, and choosing "Rename"
// edits the name in place (a cursor appears right in the row) instead of
// opening a text-input dialog — the same pattern as the repertoire title.
function OpeningRow({
  title,
  subtitle,
  piece,
  targetId,
  onPress,
  onRename,
  onDelete
}: {
  title: string;
  subtitle: string;
  piece: PieceCode;
  targetId?: string;
  onPress: () => void;
  onRename: (newName: string) => void;
  onDelete: () => void;
}) {
  const menuRef = useRef<View>(null);
  const rowRef = useTutorialTarget(targetId);
  const inputRef = useRef<TextInput>(null);
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(title);

  useEffect(() => {
    if (!editing) return;
    const t = setTimeout(() => inputRef.current?.focus(), 50);
    return () => clearTimeout(t);
  }, [editing]);

  function startEdit() {
    setValue(title);
    setEditing(true);
  }

  function commitEdit() {
    setEditing(false);
    const trimmed = value.trim();
    if (trimmed && trimmed !== title) onRename(trimmed);
  }

  function openMenu() {
    menuRef.current?.measureInWindow(async (x, y, width, height) => {
      const action = await anchoredMenu(['Rename', 'Delete'], { x, y, width, height });
      if (action === 'Rename') startEdit();
      else if (action === 'Delete') onDelete();
    });
  }

  return (
    <View ref={rowRef} collapsable={false} style={rowStyles.row}>
      {editing ? (
        <View style={rowStyles.main}>
          <PieceBadge code={piece} size={52} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <TextInput
              ref={inputRef}
              style={[rowStyles.title, rowTitleInputStyle]}
              value={value}
              onChangeText={setValue}
              onSubmitEditing={commitEdit}
              onBlur={commitEdit}
              returnKeyType="done"
            />
            <Text style={rowStyles.subtitle} numberOfLines={1}>
              {subtitle}
            </Text>
          </View>
        </View>
      ) : (
        <Pressable onPress={onPress} style={({ pressed }) => [rowStyles.main, pressed && { opacity: 0.7 }]}>
          <PieceBadge code={piece} size={52} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={rowStyles.title} numberOfLines={1}>
              {title}
            </Text>
            <Text style={rowStyles.subtitle} numberOfLines={1}>
              {subtitle}
            </Text>
          </View>
        </Pressable>
      )}
      <Pressable
        ref={menuRef}
        onPress={openMenu}
        hitSlop={4}
        style={({ pressed }) => [rowStyles.menuBtn, pressed && { opacity: 0.7 }]}
      >
        <Text style={{ color: colors.textSecondary, fontSize: 18 }}>⋮</Text>
      </Pressable>
    </View>
  );
}

const rowTitleInputStyle = { padding: 0, borderBottomWidth: 1, borderBottomColor: colors.accent };

interface OpeningRowData {
  opening: Opening;
  cards: number;
}

export function OpeningsScreen({
  repertoireId,
  onBack,
  onOpenOpening
}: {
  repertoireId: string;
  onBack: () => void;
  onOpenOpening: (openingId: string) => void;
}) {
  const [rep, setRep] = useState<Repertoire | null>(null);
  const [rows, setRows] = useState<OpeningRowData[]>([]);
  const tutorial = useTutorial();
  const { width } = useWindowDimensions();
  const emptyPieceSize = Math.min(width * 0.55, 240);

  const load = useCallback(async () => {
    const r = await getRepertoire(repertoireId);
    if (!r) {
      onBack();
      return;
    }
    setRep(r);
    const openings = await getOpenings(repertoireId);
    const rowsData: OpeningRowData[] = [];
    for (const opening of openings) {
      const cards = await getCards(opening.id);
      rowsData.push({ opening, cards: cards.length });
    }
    setRows(rowsData);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repertoireId]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleRenameRepertoire(name: string) {
    if (!rep) return;
    await renameRepertoire(rep.id, name);
    load();
  }

  // Studying a single opening is already one tap away (open it, then
  // "Study this opening"), so this button just studies the whole
  // repertoire directly instead of asking to choose between the two.
  async function handleStudy() {
    const openings = await getOpenings(repertoireId);
    if (openings.length === 0) return;
    await startStudySession(openings.map((o) => o.id), { shuffleOpenings: true });
    load();
  }

  async function handleAddOpening() {
    // While the tutorial is on this button, the name comes pre-filled.
    const prefill = tutorial.step?.id === 'openings.add' ? tutorial.step.promptPrefill : undefined;
    tutorial.event('addPressed');
    const name = await promptDialog('New opening', prefill ?? '', 'e.g. Italian');
    if (name) {
      const created = await addOpening(repertoireId, name);
      tutorial.remember({ openingId: created.id });
      load();
    }
  }

  async function handleRenameOpening(opening: Opening, name: string) {
    await renameOpening(opening.id, name);
    load();
  }

  async function handleDeleteOpening(opening: Opening) {
    const ok = await confirmDialog(`Delete "${opening.name}" and all its cards?`);
    if (ok) {
      await deleteOpening(opening.id);
      load();
    }
  }

  if (!rep) return <Screen>{null}</Screen>;

  const openingPiece: PieceCode = rep.group === 'white' ? 'wR' : 'bR';

  return (
    <Screen surface="openings">
      <Breadcrumb text={`${rep.group === 'white' ? 'White' : 'Black'} › ${rep.name}`} piece={openingPiece} />
      <TopBar title={rep.name} onBack={onBack} onRename={handleRenameRepertoire} />

      <BigButton title="+ Add opening" onPress={handleAddOpening} targetId="openings.add" />
      <View style={{ height: spacing.lg }} />

      {rows.length === 0 ? (
        // A big, group-colored rook instead of a plain line of text — it
        // fills the same space a short list would otherwise leave empty,
        // and doubles as a reminder of which side ("White"/"Black") this
        // repertoire belongs to.
        <View style={emptyStyles.wrap}>
          <PieceBadge code={rep.group === 'white' ? 'wR' : 'bR'} size={emptyPieceSize} />
          <Text style={emptyStyles.text}>No openings yet. Add one to get started.</Text>
        </View>
      ) : (
        <>
          {rows.map(({ opening, cards }) => (
            <OpeningRow
              key={opening.id}
              title={opening.name}
              subtitle={`${cards} card${cards === 1 ? '' : 's'}`}
              piece={openingPiece}
              targetId={opening.id === tutorial.memory.openingId ? 'openings.new' : undefined}
              onPress={() => {
                tutorial.event('openOpening');
                onOpenOpening(opening.id);
              }}
              onRename={(name) => handleRenameOpening(opening, name)}
              onDelete={() => handleDeleteOpening(opening)}
            />
          ))}

          {/* Pushes the Study CTA to the bottom of the screen when there's
              only a little content, instead of leaving it stranded under a
              short list with empty space below — a bottom-anchored primary
              action is a standard mobile pattern and reads as intentional,
              not unfinished. */}
          <View style={{ flex: 1, minHeight: 24 }} />
        </>
      )}

      {rows.some((r) => r.cards > 0) && (
        <BigButton title="▶ Study this repertoire" onPress={handleStudy} variant="gold" />
      )}
    </Screen>
  );
}

const emptyStyles = {
  wrap: { flex: 1, alignItems: 'center' as const, justifyContent: 'center' as const, paddingVertical: spacing.xxl },
  text: { color: colors.textSecondary, ...type.body, textAlign: 'center' as const, marginTop: spacing.lg }
};
