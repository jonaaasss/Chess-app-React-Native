import React, { useCallback, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import {
  getExampleRepertoireHidden,
  getGroupStats,
  getSetting,
  getShowFirstOpeningGuide,
  getUserDataSummary,
  setExampleRepertoireHidden,
  setSetting,
  setShowFirstOpeningGuide
} from '../storage';
import { useAccount } from '../account';
import type { GroupId, PieceCode } from '../types';
import { colors, radius, spacing, touchTarget, type } from '../theme';
import { BigButton, Screen, SettingsCircleButton } from '../components/Common';
import { PieceGlyph } from '../components/ChessBoard';
import { startGuideSession } from './StudySessionOverlay';
import { useTutorial, useTutorialTarget } from '../tutorial';

const BADGE_SIZE = 68;

const GROUPS: { id: GroupId; label: string; piece: PieceCode }[] = [
  { id: 'white', label: 'White', piece: 'wK' },
  { id: 'black', label: 'Black', piece: 'bK' }
];

export function HomeScreen({
  onOpenGroup,
  onOpenSettings
}: {
  onOpenGroup: (group: GroupId) => void;
  onOpenSettings: () => void;
}) {
  const tutorial = useTutorial();
  const { user, ready: accountReady } = useAccount();
  // A nudge to sign in and back up, once there's something worth backing up.
  const [ownCards, setOwnCards] = useState(0);
  const [reminderDismissed, setReminderDismissed] = useState(true);
  const whiteTileRef = useTutorialTarget('home.white');
  const [exampleHidden, setExampleHiddenState] = useState(false);
  const [showGuide, setShowGuide] = useState(true);
  const [stats, setStats] = useState<Record<GroupId, { repertoires: number; openings: number; cards: number }>>({
    white: { repertoires: 0, openings: 0, cards: 0 },
    black: { repertoires: 0, openings: 0, cards: 0 }
  });

  const load = useCallback(async () => {
    setExampleHiddenState(await getExampleRepertoireHidden());
    // Reloaded on focus too, so turning the button back on in Settings shows
    // it as soon as you return here.
    setShowGuide(await getShowFirstOpeningGuide());
    const white = await getGroupStats('white');
    const black = await getGroupStats('black');
    setStats({ white, black });
    setOwnCards((await getUserDataSummary()).cards);
    setReminderDismissed(await getSetting<boolean>('backupReminderDismissed', false));
  }, []);

  // The native stack keeps this screen mounted while a repertoire/opening/
  // card gets added deeper in the stack, so a mount-only load would leave
  // these counts stale after navigating back — reload on every focus.
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  async function toggleExampleHidden() {
    const next = !exampleHidden;
    setExampleHiddenState(next);
    await setExampleRepertoireHidden(next);
    // The example counts toward each side's totals when shown, so the
    // tile subtitles need to reflect the new state right away.
    const white = await getGroupStats('white');
    const black = await getGroupStats('black');
    setStats({ white, black });
  }

  async function dismissReminder() {
    setReminderDismissed(true);
    await setSetting('backupReminderDismissed', true);
  }

  async function hideGuide() {
    setShowGuide(false);
    await setShowFirstOpeningGuide(false);
  }

  return (
    <Screen surface="home">
      <View style={styles.topRow}>
        <SettingsCircleButton onPress={onOpenSettings} />
      </View>

      <Text style={styles.sectionLabel}>Choose a side</Text>
      {GROUPS.map((g) => {
        const s = stats[g.id];
        return (
          <Pressable
            key={g.id}
            ref={g.id === 'white' ? whiteTileRef : undefined}
            collapsable={false}
            onPress={() => {
              tutorial.event('openGroup');
              onOpenGroup(g.id);
            }}
            style={({ pressed }) => [styles.tile, pressed && styles.tilePressed]}
          >
            <View style={styles.badge}>
              <PieceGlyph code={g.piece} cell={BADGE_SIZE * 0.92} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.tileTitle}>{g.label}</Text>
              <Text style={styles.tileSub}>
                {s.repertoires} repertoire{s.repertoires === 1 ? '' : 's'} · {s.openings} opening
                {s.openings === 1 ? '' : 's'} · {s.cards} card{s.cards === 1 ? '' : 's'}
                {exampleHidden ? '' : ' · incl. example'}
              </Text>
            </View>
            <View style={styles.chevronCircle}>
              <Text style={styles.tileChevron}>›</Text>
            </View>
          </Pressable>
        );
      })}

      {accountReady && !user && ownCards >= 3 && !reminderDismissed && (
        <View style={styles.reminder}>
          <Text style={styles.reminderText}>Your cards are only on this phone. Sign in to back them up.</Text>
          <View style={styles.reminderActions}>
            <Pressable onPress={onOpenSettings} style={styles.reminderBtn}>
              <Text style={styles.reminderBtnText}>Back up my cards</Text>
            </Pressable>
            <Pressable onPress={dismissReminder} style={styles.reminderDismiss}>
              <Text style={styles.reminderDismissText}>Not now</Text>
            </Pressable>
          </View>
        </View>
      )}

      <Pressable onPress={toggleExampleHidden} style={styles.exampleBtn}>
        <Text style={styles.exampleBtnText}>{exampleHidden ? 'Show Example Repertoire' : 'Hide Example Repertoire'}</Text>
      </Pressable>

      {showGuide && (
        <>
          {/* Pushes the guide CTA to the bottom of the screen, matching the
              Study CTA on the cards screen. */}
          <View style={{ flex: 1, minHeight: spacing.lg }} />
          <BigButton title="▶ Study Your First Opening" onPress={startGuideSession} variant="gold" />
          <BigButton title="▶ Make Your First Card" onPress={() => tutorial.start()} variant="gold" />
          <Pressable onPress={hideGuide} style={styles.exampleBtn}>
            <Text style={styles.exampleBtnText}>Hide these buttons (turn them back on in Settings)</Text>
          </Pressable>
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  topRow: { flexDirection: 'row', justifyContent: 'flex-end', marginBottom: 8 },
  sectionLabel: {
    color: colors.textDim,
    ...type.micro,
    textTransform: 'uppercase',
    marginBottom: spacing.md
  },
  tile: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl + 4,
    borderWidth: 1.5,
    borderColor: colors.border,
    padding: spacing.xl,
    minHeight: 108,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    marginBottom: spacing.lg
  },
  tilePressed: { opacity: 0.9, transform: [{ scale: 0.99 }] },
  badge: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: colors.pieceBadgeBg,
    alignItems: 'center',
    justifyContent: 'center'
  },
  tileTitle: { color: colors.text, ...type.h1, fontSize: 22 },
  tileSub: { color: colors.textDim, ...type.caption, marginTop: 5 },
  chevronCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center'
  },
  tileChevron: { color: colors.text, fontSize: 18 },
  reminder: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    marginBottom: spacing.md
  },
  reminderText: { color: colors.text, ...type.caption },
  reminderActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.sm },
  reminderBtn: {
    minHeight: touchTarget,
    borderRadius: radius.pill,
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
    justifyContent: 'center'
  },
  reminderBtnText: { color: colors.onPrimary, fontSize: 14, fontWeight: '700' },
  reminderDismiss: { minHeight: touchTarget, paddingHorizontal: spacing.md, justifyContent: 'center' },
  reminderDismissText: { color: colors.textDim, fontSize: 14, fontWeight: '600' },
  exampleBtn: { alignItems: 'center', justifyContent: 'center', minHeight: touchTarget, marginTop: spacing.md },
  exampleBtnText: { color: colors.textDim, ...type.caption, textDecorationLine: 'underline' }
});
