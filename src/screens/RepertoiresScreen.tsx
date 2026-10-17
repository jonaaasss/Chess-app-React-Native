import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, Pressable, useWindowDimensions } from 'react-native';
import {
  addRepertoire,
  deleteRepertoire,
  getCards,
  getOpenings,
  getRepertoireStats,
  getVisibleRepertoires,
  renameRepertoire,
  restoreExampleRepertoire,
  restoreRepertoire
} from '../storage';
import { confirmDialog, promptDialog, showSnackbar } from '../overlay';
import type { GroupId, PieceCode, Repertoire } from '../types';
import { Screen, TopBar, BigButton, Breadcrumb, PieceBadge, rowStyles, RowMenu, type RowAction } from '../components/Common';
import { colors, spacing, type } from '../theme';
import { MoveText } from '../components/MoveText';
import { useTutorial, useTutorialTarget } from '../tutorial';

// Same pattern as OpeningsScreen's row: the "⋮" opens a small plain-text
// popover pinned right under it instead of a full-screen menu, and
// "Rename" edits the name in place instead of opening a dialog.
function RepertoireRow({
  title,
  subtitle,
  piece,
  isExample,
  targetId,
  onPress,
  onRename,
  onDelete,
  onRestore
}: {
  title: string;
  subtitle: string;
  piece: PieceCode;
  isExample?: boolean;
  targetId?: string;
  onPress: () => void;
  onRename: (newName: string) => void;
  onDelete: () => void;
  onRestore: () => void;
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

  // The example repertoire is fully editable, but it's shown/hidden as a
  // pair via the Home screen toggle rather than deleted here — a restore
  // action takes Delete's place instead.
  const actions: RowAction[] = [
    { key: 'rename', icon: 'edit', label: 'Rename', onPress: startEdit },
    isExample
      ? { key: 'restore', icon: 'restore', label: 'Restore original content', onPress: onRestore }
      : { key: 'delete', icon: 'trash', label: 'Delete', onPress: onDelete }
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

interface RepRow {
  rep: Repertoire;
  openings: number;
  cards: number;
}

export function RepertoiresScreen({
  group,
  onBack,
  onGoHome,
  onOpenRepertoire
}: {
  group: GroupId;
  onBack: () => void;
  onGoHome: () => void;
  onOpenRepertoire: (repertoireId: string) => void;
}) {
  const [rows, setRows] = useState<RepRow[]>([]);
  const tutorial = useTutorial();
  const { width } = useWindowDimensions();
  const emptyPieceSize = Math.min(width * 0.55, 240);

  const load = useCallback(async () => {
    const reps = await getVisibleRepertoires(group);
    const rowsData: RepRow[] = [];
    for (const rep of reps) {
      const stats = await getRepertoireStats(rep.id);
      rowsData.push({ rep, openings: stats.openings, cards: stats.cards });
    }
    setRows(rowsData);
  }, [group]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleAdd() {
    const name = await promptDialog('New repertoire', '', 'e.g. Blitz repertoire');
    if (name) {
      await addRepertoire(group, name);
      load();
    }
  }

  async function handleRenameRepertoire(rep: Repertoire, name: string) {
    await renameRepertoire(rep.id, name);
    load();
  }

  // No confirmation: the delete is undone from the message that follows. What
  // was in it is kept in memory until then.
  async function handleDeleteRepertoire(rep: Repertoire) {
    const openings = await getOpenings(rep.id);
    const cards = (await Promise.all(openings.map((o) => getCards(o.id)))).flat();
    await deleteRepertoire(rep.id);
    load();
    showSnackbar({
      message: `Deleted "${rep.name}" (${openings.length} opening${openings.length === 1 ? '' : 's'})`,
      actionLabel: 'Undo',
      onAction: async () => {
        await restoreRepertoire(rep, openings, cards);
        load();
      }
    });
  }

  async function handleRestoreExample(rep: Repertoire) {
    const ok = await confirmDialog(`Restore "${rep.name}" to its original content? Your changes to it will be lost.`);
    if (ok) {
      await restoreExampleRepertoire(rep.id);
      load();
    }
  }

  const groupPiece: PieceCode = group === 'white' ? 'wQ' : 'bQ';
  // The tutorial points at the user's own repertoire, never the example one.
  const ownFirstId = rows.find((r) => !r.rep.isExample)?.rep.id;

  return (
    <Screen surface="repertoires">
      <Breadcrumb segments={[{ label: 'Home', onPress: onGoHome }, { label: group === 'white' ? 'White' : 'Black' }]} piece={groupPiece} />
      <TopBar title={group === 'white' ? 'White' : 'Black'} onBack={onBack} />

      <BigButton title="+ Add repertoire" onPress={handleAdd} />
      <View style={{ height: spacing.lg }} />

      {rows.length === 0 ? (
        <View style={emptyStyles.wrap}>
          <PieceBadge code={group === 'white' ? 'wQ' : 'bQ'} size={emptyPieceSize} />
          <Text style={emptyStyles.text}>No repertoires yet. Add one to get started.</Text>
        </View>
      ) : (
        rows.map(({ rep, openings, cards }) => (
          <RepertoireRow
            key={rep.id}
            title={rep.name}
            subtitle={`${openings} opening${openings === 1 ? '' : 's'} · ${cards} card${cards === 1 ? '' : 's'}`}
            piece={groupPiece}
            isExample={rep.isExample}
            targetId={rep.id === ownFirstId ? 'repertoires.own' : undefined}
            onPress={() => {
              tutorial.event('openRepertoire');
              onOpenRepertoire(rep.id);
            }}
            onRename={(name) => handleRenameRepertoire(rep, name)}
            onDelete={() => handleDeleteRepertoire(rep)}
            onRestore={() => handleRestoreExample(rep)}
          />
        ))
      )}
    </Screen>
  );
}

const emptyStyles = {
  wrap: { flex: 1, alignItems: 'center' as const, justifyContent: 'center' as const, paddingVertical: spacing.xxl },
  text: { color: colors.textSecondary, ...type.body, textAlign: 'center' as const, marginTop: spacing.lg }
};
