import React, { useCallback, useEffect, useState } from 'react';
import { addRepertoire, deleteRepertoire, getRepertoireStats, getRepertoires, renameRepertoire } from '../storage';
import { confirmDialog, promptDialog, simpleMenu } from '../overlay';
import type { GroupId, Repertoire } from '../types';
import { Screen, TopBar, EmptyState, ListRow, BigButton } from '../components/Common';

interface RepRow {
  rep: Repertoire;
  openings: number;
  cards: number;
}

export function RepertoiresScreen({
  group,
  onBack,
  onOpenRepertoire
}: {
  group: GroupId;
  onBack: () => void;
  onOpenRepertoire: (repertoireId: string) => void;
}) {
  const [rows, setRows] = useState<RepRow[]>([]);

  const load = useCallback(async () => {
    const reps = await getRepertoires(group);
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

  async function handleMenu(rep: Repertoire) {
    const action = await simpleMenu(['Rename', 'Delete'], 'Edit Repertoire');
    if (action === 'Rename') {
      const name = await promptDialog('Rename repertoire', rep.name);
      if (name) {
        await renameRepertoire(rep.id, name);
        load();
      }
    } else if (action === 'Delete') {
      const ok = await confirmDialog(`Delete "${rep.name}" and all its openings/cards?`);
      if (ok) {
        await deleteRepertoire(rep.id);
        load();
      }
    }
  }

  async function handleAdd() {
    const name = await promptDialog('New repertoire', '', 'e.g. Blitz repertoire');
    if (name) {
      await addRepertoire(group, name);
      load();
    }
  }

  return (
    <Screen>
      <TopBar title={group === 'white' ? 'White' : 'Black'} onBack={onBack} onAdd={handleAdd} />

      {rows.length === 0 && <EmptyState text="No repertoires yet. Add one to get started." />}

      {rows.map(({ rep, openings, cards }) => (
        <ListRow
          key={rep.id}
          title={rep.name}
          subtitle={`${openings} opening${openings === 1 ? '' : 's'} · ${cards} card${cards === 1 ? '' : 's'}`}
          onPress={() => onOpenRepertoire(rep.id)}
          onMenu={() => handleMenu(rep)}
        />
      ))}

      <BigButton title="+ Add repertoire" onPress={handleAdd} />
    </Screen>
  );
}
