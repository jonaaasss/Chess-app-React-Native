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
import { confirmDialog, promptDialog, simpleMenu, anchoredMenu } from '../overlay';
import type { Opening, Repertoire } from '../types';
import { Screen, TopBar, Breadcrumb, BigButton, rowStyles } from '../components/Common';
import { PieceGlyph } from '../components/ChessBoard';
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
  onPress,
  onRename,
  onDelete
}: {
  title: string;
  subtitle: string;
  onPress: () => void;
  onRename: (newName: string) => void;
  onDelete: () => void;
}) {
  const menuRef = useRef<View>(null);
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
    <View style={rowStyles.row}>
      {editing ? (
        <View style={rowStyles.main}>
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

  async function handleStudy() {
    const openings = await getOpenings(repertoireId);
    if (openings.length === 0) return;
    const choice = await simpleMenu(['Full repertoire (random order)', 'Choose one opening'], 'Study this repertoire');
    if (choice === 'Full repertoire (random order)') {
      await startStudySession(openings.map((o) => o.id), { shuffleOpenings: true });
      load();
    } else if (choice === 'Choose one opening') {
      const name = await simpleMenu(openings.map((o) => o.name));
      const picked = openings.find((o) => o.name === name);
      if (picked) {
        await startStudySession([picked.id], { shuffleOpenings: false });
        load();
      }
    }
  }

  async function handleAddOpening() {
    const name = await promptDialog('New opening', '', 'e.g. Italian');
    if (name) {
      await addOpening(repertoireId, name);
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

  return (
    <Screen>
      <Breadcrumb text={`${rep.group === 'white' ? 'White' : 'Black'} › ${rep.name}`} />
      <TopBar title={rep.name} onBack={onBack} onRename={handleRenameRepertoire} />

      <BigButton title="+ Add opening" onPress={handleAddOpening} />
      <View style={{ height: spacing.lg }} />

      {rows.length === 0 ? (
        // A big, group-colored rook instead of a plain line of text — it
        // fills the same space a short list would otherwise leave empty,
        // and doubles as a reminder of which side ("White"/"Black") this
        // repertoire belongs to.
        <View style={emptyStyles.wrap}>
          <PieceGlyph code={rep.group === 'white' ? 'wR' : 'bR'} cell={emptyPieceSize} />
          <Text style={emptyStyles.text}>No openings yet. Add one to get started.</Text>
        </View>
      ) : (
        <>
          {rows.map(({ opening, cards }) => (
            <OpeningRow
              key={opening.id}
              title={opening.name}
              subtitle={`${cards} card${cards === 1 ? '' : 's'}`}
              onPress={() => onOpenOpening(opening.id)}
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
