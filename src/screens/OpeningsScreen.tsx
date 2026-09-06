import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, Text, StyleSheet } from 'react-native';
import {
  addOpening,
  deleteOpening,
  deleteRepertoire,
  getCards,
  getOpenings,
  getRepertoire,
  renameOpening,
  renameRepertoire
} from '../storage';
import { confirmDialog, promptDialog, simpleMenu } from '../overlay';
import type { Opening, Repertoire } from '../types';
import { Screen, TopBar, Breadcrumb, EmptyState, ListRow, BigButton } from '../components/Common';
import { colors } from '../theme';
import { startStudySession } from './StudySessionOverlay';

interface OpeningRow {
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
  const [rows, setRows] = useState<OpeningRow[]>([]);

  const load = useCallback(async () => {
    const r = await getRepertoire(repertoireId);
    if (!r) {
      onBack();
      return;
    }
    setRep(r);
    const openings = await getOpenings(repertoireId);
    const rowsData: OpeningRow[] = [];
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

  async function handleEditRepertoire() {
    if (!rep) return;
    const action = await simpleMenu(['Rename repertoire', 'Delete repertoire']);
    if (action === 'Rename repertoire') {
      const name = await promptDialog('Rename repertoire', rep.name);
      if (name) {
        await renameRepertoire(rep.id, name);
        load();
      }
    } else if (action === 'Delete repertoire') {
      const ok = await confirmDialog(`Delete "${rep.name}" and all its openings/cards?`);
      if (ok) {
        await deleteRepertoire(rep.id);
        onBack();
      }
    }
  }

  async function handleStudy() {
    const openings = await getOpenings(repertoireId);
    if (openings.length === 0) return;
    const choice = await simpleMenu(['Full repertoire (random order)', 'Choose one opening']);
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

  async function handleMenu(opening: Opening) {
    const action = await simpleMenu(['Rename', 'Delete']);
    if (action === 'Rename') {
      const name = await promptDialog('Rename opening', opening.name);
      if (name) {
        await renameOpening(opening.id, name);
        load();
      }
    } else if (action === 'Delete') {
      const ok = await confirmDialog(`Delete "${opening.name}" and all its cards?`);
      if (ok) {
        await deleteOpening(opening.id);
        load();
      }
    }
  }

  if (!rep) return <Screen>{null}</Screen>;

  return (
    <Screen>
      <Breadcrumb text={rep.group === 'white' ? 'White' : 'Black'} />
      <TopBar title={rep.name} onBack={onBack} onEdit={handleEditRepertoire} />

      <Pressable onPress={handleAddOpening} style={styles.addOpeningBtn}>
        <Text style={styles.addOpeningText}>+ Add opening</Text>
      </Pressable>

      {rows.length === 0 && <EmptyState text="No openings yet. Add one to get started." />}

      {rows.map(({ opening, cards }) => (
        <ListRow
          key={opening.id}
          title={opening.name}
          subtitle={`${cards} card${cards === 1 ? '' : 's'}`}
          onPress={() => onOpenOpening(opening.id)}
          onMenu={() => handleMenu(opening)}
        />
      ))}

      <BigButton title="▶ Study this repertoire" onPress={handleStudy} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  addOpeningBtn: {
    borderWidth: 1.5,
    borderColor: colors.border,
    borderStyle: 'dashed',
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    marginBottom: 18
  },
  addOpeningText: { color: colors.textDim, fontWeight: '600', fontSize: 14.5 }
});
