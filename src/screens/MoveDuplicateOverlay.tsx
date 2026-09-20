import React, { useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getOpening, getOpenings, getRepertoire, getRepertoires, moveOrDuplicateCard } from '../storage';
import { simpleMenu, showOverlay, showSnackbar, useOverlayBack } from '../overlay';
import type { Card, GroupId, Opening, Repertoire } from '../types';
import { colors, radius, type } from '../theme';
import { BackCircleButton } from '../components/Common';

type Mode = 'move' | 'duplicate';
type Result = 'moved' | 'duplicated' | 'cancelled';

function DropdownField({
  label,
  value,
  icon,
  disabled,
  onPress
}: {
  label: string;
  value: string;
  icon?: string;
  disabled?: boolean;
  onPress?: () => void;
}) {
  return (
    <View style={{ marginBottom: 16 }}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <Pressable
        onPress={disabled ? undefined : onPress}
        style={[styles.dropdown, disabled && styles.dropdownDisabled]}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
          {icon && <Text style={{ fontSize: 15 }}>{icon}</Text>}
          <Text style={styles.dropdownText} numberOfLines={1}>
            {value}
          </Text>
        </View>
        {!disabled && <Text style={styles.dropdownChevron}>⌄</Text>}
      </Pressable>
    </View>
  );
}

function RadioRow({
  title,
  caption,
  selected,
  onPress
}: {
  title: string;
  caption: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={styles.radioRow}>
      <View style={[styles.radioCircle, selected && styles.radioCircleActive]}>
        {selected && <View style={styles.radioDot} />}
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.radioTitle}>{title}</Text>
        <Text style={styles.radioCaption}>{caption}</Text>
      </View>
    </Pressable>
  );
}

function MoveDuplicateOverlay({ card, close }: { card: Card; close: (result: Result) => void }) {
  const [currentRepertoire, setCurrentRepertoire] = useState<Repertoire | null>(null);
  const [selectedGroup, setSelectedGroup] = useState<GroupId | null>(null);
  const [repertoires, setRepertoires] = useState<Repertoire[]>([]);
  const [selectedRepertoire, setSelectedRepertoire] = useState<Repertoire | null>(null);
  const [openings, setOpenings] = useState<Opening[]>([]);
  const [selectedOpening, setSelectedOpening] = useState<Opening | null>(null);
  const [mode, setMode] = useState<Mode>('duplicate');
  useOverlayBack(() => close('cancelled'));

  useEffect(() => {
    (async () => {
      const opening = await getOpening(card.openingId);
      if (!opening) {
        close('cancelled');
        return;
      }
      const rep = await getRepertoire(opening.repertoireId);
      if (!rep) {
        close('cancelled');
        return;
      }
      setCurrentRepertoire(rep);
      setSelectedGroup(rep.group);
      setSelectedRepertoire(rep);
      // The example repertoire isn't a valid move/duplicate destination —
      // dumping a personal card into the demo content would defeat the
      // point of being able to restore it to its original state.
      const reps = (await getRepertoires(rep.group)).filter((r) => !r.isExample);
      setRepertoires(reps);
      const ops = await getOpenings(rep.id);
      setOpenings(ops);
      setSelectedOpening(ops.find((o) => o.id === card.openingId) ?? ops[0] ?? null);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card.id]);

  async function handlePickGroup() {
    const label = await simpleMenu(['White', 'Black']);
    if (!label) return;
    const group: GroupId = label === 'White' ? 'white' : 'black';
    if (group === selectedGroup) return;
    setSelectedGroup(group);
    const reps = (await getRepertoires(group)).filter((r) => !r.isExample);
    setRepertoires(reps);
    const rep = reps[0] ?? null;
    setSelectedRepertoire(rep);
    const ops = rep ? await getOpenings(rep.id) : [];
    setOpenings(ops);
    setSelectedOpening(ops[0] ?? null);
  }

  async function handlePickRepertoire() {
    const name = await simpleMenu(repertoires.map((r) => r.name));
    if (!name) return;
    const rep = repertoires.find((r) => r.name === name);
    if (!rep) return;
    setSelectedRepertoire(rep);
    const ops = await getOpenings(rep.id);
    setOpenings(ops);
    setSelectedOpening(ops[0] ?? null);
  }

  async function handlePickOpening() {
    const name = await simpleMenu(openings.map((o) => o.name));
    if (!name) return;
    const opening = openings.find((o) => o.name === name);
    if (opening) setSelectedOpening(opening);
  }

  async function handleConfirm() {
    if (!selectedOpening) {
      close('cancelled');
      return;
    }
    if (mode === 'move' && selectedOpening.id === card.openingId) {
      close('cancelled');
      return;
    }
    await moveOrDuplicateCard(card.id, selectedOpening.id, mode);
    showSnackbar({
      message: `${mode === 'move' ? 'Moved' : 'Duplicated'} to "${selectedOpening.name}"`
    });
    close(mode === 'move' ? 'moved' : 'duplicated');
  }

  if (!currentRepertoire || !selectedGroup) {
    return <SafeAreaView style={styles.overlay} />;
  }

  return (
    <SafeAreaView style={styles.overlay}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.topBar}>
          <BackCircleButton onPress={() => close('cancelled')} />
          <Text style={styles.title}>Move or duplicate</Text>
        </View>

        <Text style={styles.sectionLabel}>Choose destination</Text>

        <DropdownField
          label="Side"
          value={selectedGroup === 'white' ? 'White' : 'Black'}
          icon={selectedGroup === 'white' ? '♔' : '♚'}
          onPress={handlePickGroup}
        />
        <DropdownField
          label="Repertoire"
          value={selectedRepertoire?.name ?? 'No repertoires in this group'}
          onPress={handlePickRepertoire}
        />
        <DropdownField label="Opening" value={selectedOpening?.name ?? '—'} onPress={handlePickOpening} />

        <RadioRow
          title="Duplicate card"
          caption="Keep in current opening"
          selected={mode === 'duplicate'}
          onPress={() => setMode('duplicate')}
        />
        <RadioRow
          title="Move card"
          caption="Remove from current opening"
          selected={mode === 'move'}
          onPress={() => setMode('move')}
        />

        <Pressable onPress={handleConfirm} style={styles.confirmBtn}>
          <Text style={styles.confirmBtnText}>{mode === 'move' ? 'Move card' : 'Duplicate card'}</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

export function openMoveDuplicateDialog(card: Card): Promise<Result> {
  return showOverlay<Result>((close) => <MoveDuplicateOverlay card={card} close={close} />);
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, paddingBottom: 32 },
  topBar: { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 20 },
  backArrow: { color: colors.textDim, fontSize: 22 },
  title: { color: colors.text, ...type.h1 },
  sectionLabel: { color: colors.textDim, fontSize: 12.5, marginBottom: 14, textTransform: 'uppercase', letterSpacing: 0.5 },
  fieldLabel: { color: colors.textDim, fontSize: 12.5, marginBottom: 6 },
  dropdown: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.panel2,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 13
  },
  dropdownDisabled: { opacity: 0.55 },
  dropdownText: { color: colors.text, fontSize: 15, fontWeight: '500' },
  dropdownChevron: { color: colors.textDim, fontSize: 16 },
  radioRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.panel,
    borderRadius: radius.lg,
    padding: 14,
    marginBottom: 10
  },
  radioCircle: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center'
  },
  radioCircleActive: { borderColor: colors.accent },
  radioDot: { width: 11, height: 11, borderRadius: 6, backgroundColor: colors.accent },
  radioTitle: { color: colors.text, fontSize: 15, fontWeight: '600' },
  radioCaption: { color: colors.textDim, fontSize: 12.5, marginTop: 2 },
  confirmBtn: {
    backgroundColor: colors.accent,
    borderRadius: radius.pill,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 18
  },
  confirmBtnText: { color: colors.onPrimary, fontSize: 15.5, fontWeight: '700' }
});
