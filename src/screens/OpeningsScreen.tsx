import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, Pressable, useWindowDimensions } from 'react-native';
import {
  addOpening,
  deleteOpening,
  getBoardStyle,
  getCards,
  getOpenings,
  getRepertoire,
  renameOpening,
  renameRepertoire,
  restoreOpening
} from '../storage';
import { confirmDialog, promptDialog, showSnackbar, simpleMenu, alertDialog } from '../overlay';
import type { GroupId, Opening, PieceCode, Repertoire } from '../types';
import { Screen, TopBar, Breadcrumb, BigButton, PieceBadge, rowStyles, RowMenu, type RowAction } from '../components/Common';
import { useTutorial, useTutorialTarget } from '../tutorial';
import { colors, spacing, type } from '../theme';
import { MoveText } from '../components/MoveText';
import { askStudyOptions, startStudySession } from './StudySessionOverlay';
import { openOpeningStartPositionPicker } from './OpeningStartPositionOverlay';
import { openImportPgnDialog } from './ImportPgnOverlay';
import { openAiImportDialog } from './AiImportOverlay';
import { importOpening } from '../importOpening';

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
  const rowRef = useTutorialTarget(targetId);
  const inputRef = useRef<TextInput>(null);
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(title);
  // The renamed title stays on screen until the list reloads with it, so the
  // old name doesn't flash back in between.
  const [pendingTitle, setPendingTitle] = useState<string | null>(null);
  useEffect(() => setPendingTitle(null), [title]);
  const shownTitle = pendingTitle ?? title;

  useEffect(() => {
    if (!editing) return;
    const t = setTimeout(() => inputRef.current?.focus(), 50);
    return () => clearTimeout(t);
  }, [editing]);

  function startEdit() {
    setValue(shownTitle);
    setEditing(true);
  }

  function commitEdit() {
    setEditing(false);
    const trimmed = value.trim();
    if (trimmed && trimmed !== shownTitle) {
      setPendingTitle(trimmed);
      onRename(trimmed);
    }
  }

  const actions: RowAction[] = [
    { key: 'rename', icon: 'edit', label: 'Rename', onPress: startEdit },
    { key: 'delete', icon: 'trash', label: 'Delete', onPress: onDelete }
  ];

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
            <MoveText text={shownTitle} style={rowStyles.title} numberOfLines={1} />
            <Text style={rowStyles.subtitle} numberOfLines={1}>
              {subtitle}
            </Text>
          </View>
        </Pressable>
      )}
      <RowMenu actions={actions} />
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
  onGoHome,
  onOpenGroup,
  onOpenOpening
}: {
  repertoireId: string;
  onBack: () => void;
  onGoHome: () => void;
  onOpenGroup: (group: GroupId) => void;
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
    const options = await askStudyOptions();
    if (!options) return;
    await startStudySession(openings.map((o) => o.id), { shuffleOpenings: true, ...options });
    load();
  }

  async function handleAddOpening() {
    // While the tutorial is on this button, the name comes pre-filled.
    const inTutorial = tutorial.step?.id === 'openings.add';
    const prefill = tutorial.step?.id === 'openings.add' ? tutorial.step.promptPrefill : undefined;
    tutorial.event('addPressed');
    const name = await promptDialog('New opening', prefill ?? '', 'e.g. Italian');
    if (name && rep) {
      // The tutorial only knows the "make your own cards" path, so it skips this choice.
      const how = inTutorial ? 'Make your own cards' : await simpleMenu(['Make your own cards', 'Import PGN', 'Import PGN with AI'], 'How do you want to start?');
      if (how === null) return;
      if (how === 'Import PGN' || how === 'Import PGN with AI') {
        await handleImportOpening(name, how === 'Import PGN with AI');
        return;
      }
      // Never persisted until the starting position is confirmed too —
      // cancelling that screen means no opening gets created at all, same
      // as picking a mode is what actually commits a brand-new card.
      const boardStyle = await getBoardStyle();
      const picked = await openOpeningStartPositionPicker(name, rep.group === 'black' ? 'b' : 'w', boardStyle);
      if (picked === null) return;
      const created = await addOpening(repertoireId, name, picked.setupMoves.length > 0 ? picked : undefined);
      tutorial.remember({ openingId: created.id });
      await load();
      // Straight into the new (still empty) opening — except mid-tutorial,
      // which needs to stay here a moment longer to spotlight the new row
      // (see `targetId` below) before it leads you in itself.
      if (!tutorial.step) onOpenOpening(created.id);
    }
  }

  // Nothing is created until the pasted text has passed every check and you
  // have confirmed the card count; a failure while saving removes the
  // half-made opening again (see importOpening).
  async function handleImportOpening(name: string, withAi: boolean) {
    const imported = withAi ? await openAiImportDialog(rep?.group === 'black' ? 'Black' : 'White') : await openImportPgnDialog();
    if (imported === null) return;
    const cardCount = imported.value.cards.length;
    const ok = await confirmDialog(
      `Create "${name}" with ${cardCount} card${cardCount === 1 ? '' : 's'} (${imported.boardCount} board${imported.boardCount === 1 ? '' : 's'})?`,
      { confirmLabel: 'Create', cancelLabel: 'Cancel' }
    );
    if (!ok) return;
    try {
      const created = await importOpening(repertoireId, name, imported.value);
      await load();
      onOpenOpening(created.id);
    } catch {
      await alertDialog('The import failed and nothing was saved. Please try again.');
    }
  }

  async function handleRenameOpening(opening: Opening, name: string) {
    await renameOpening(opening.id, name);
    load();
  }

  // No confirmation: the delete is undone from the message that follows.
  async function handleDeleteOpening(opening: Opening) {
    const cards = await getCards(opening.id);
    await deleteOpening(opening.id);
    load();
    showSnackbar({
      message: `Deleted "${opening.name}" (${cards.length} card${cards.length === 1 ? '' : 's'})`,
      actionLabel: 'Undo',
      onAction: async () => {
        const restored = await restoreOpening(opening, cards);
        if (!restored) showSnackbar({ message: "Can't undo: the repertoire is gone too." });
        load();
      }
    });
  }

  if (!rep) return <Screen>{null}</Screen>;

  const openingPiece: PieceCode = rep.group === 'white' ? 'wR' : 'bR';

  return (
    <Screen surface="openings">
      <Breadcrumb
        segments={[
          { label: 'Home', onPress: onGoHome },
          { label: rep.group === 'white' ? 'White' : 'Black', onPress: () => onOpenGroup(rep.group) },
          { label: rep.name }
        ]}
        piece={openingPiece}
      />
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
