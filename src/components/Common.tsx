import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';
import { colors, radius, spacing, type, touchTarget } from '../theme';
import { PieceGlyph } from './ChessBoard';
import type { PieceCode } from '../types';
import { useFocusEffect } from '@react-navigation/native';
import { TutorialLayer, useTutorial, useTutorialTarget } from '../tutorial';
import type { TutorialSurface } from '../tutorialContent';

// A drawn icon instead of a Unicode "←" glyph — text glyphs don't sit
// centered within their own em-box consistently (the same lesson learned
// from the home-screen king icons), so a custom SVG guarantees the arrow is
// pixel-centered and lets us control its weight directly.
function BackArrowIcon({ size, color }: { size: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z" fill={color} />
    </Svg>
  );
}

// Drawn pencil, tip fixed at lower-left / cap at upper-right (matching the
// standard "edit" pencil orientation) — same reasoning as the back arrow.
function EditPencilIcon({ size, color }: { size: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path
        d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34a.9959.9959 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"
        fill={color}
      />
    </Svg>
  );
}

// Standard Material "settings" gear glyph.
function GearIcon({ size, color }: { size: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path
        d="M19.14,12.94c0.04,-0.3 0.06,-0.61 0.06,-0.94c0,-0.32 -0.02,-0.64 -0.07,-0.94l2.03,-1.58c0.18,-0.14 0.23,-0.41 0.12,-0.61l-1.92,-3.32c-0.12,-0.22 -0.37,-0.29 -0.59,-0.22l-2.39,0.96c-0.5,-0.38 -1.03,-0.7 -1.62,-0.94L14.4,2.81c-0.04,-0.24 -0.24,-0.41 -0.48,-0.41h-3.84c-0.24,0 -0.43,0.17 -0.47,0.41L9.25,5.35C8.66,5.59 8.12,5.92 7.63,6.29L5.24,5.33c-0.22,-0.08 -0.47,0 -0.59,0.22L2.74,8.87C2.62,9.08 2.66,9.34 2.86,9.48l2.03,1.58C4.84,11.36 4.8,11.69 4.8,12s0.02,0.64 0.07,0.94l-2.03,1.58c-0.18,0.14 -0.23,0.41 -0.12,0.61l1.92,3.32c0.12,0.22 0.37,0.29 0.59,0.22l2.39,-0.96c0.5,0.38 1.03,0.7 1.62,0.94l0.36,2.54c0.05,0.24 0.24,0.41 0.48,0.41h3.84c0.24,0 0.44,-0.17 0.47,-0.41l0.36,-2.54c0.59,-0.24 1.13,-0.56 1.62,-0.94l2.39,0.96c0.22,0.08 0.47,0 0.59,-0.22l1.92,-3.32c0.12,-0.22 0.07,-0.47 -0.12,-0.61L19.14,12.94zM12,15.6c-1.98,0 -3.6,-1.62 -3.6,-3.6s1.62,-3.6 3.6,-3.6s3.6,1.62 3.6,3.6S13.98,15.6 12,15.6z"
        fill={color}
      />
    </Svg>
  );
}

// Shared circular back button — used by TopBar, and by the full-screen
// overlays (Study session, Move/Duplicate) that draw their own header
// instead of using TopBar, so every back arrow in the app looks the same.
export function BackCircleButton({ onPress }: { onPress: () => void }) {
  return (
    <IconButton
      onPress={onPress}
      icon={
        <View style={styles.backCircle}>
          <BackArrowIcon size={20} color={colors.textPrimary} />
        </View>
      }
    />
  );
}

// Same treatment for the edit pencil — used by TopBar's onEdit/onRename, and
// anywhere else (e.g. the Study session footer) that needs the identical
// circular pencil button rather than a plain glyph.
export function EditCircleButton({ onPress }: { onPress: () => void }) {
  return (
    <IconButton
      onPress={onPress}
      icon={
        <View style={styles.backCircle}>
          <EditPencilIcon size={21} color={colors.textPrimary} />
        </View>
      }
    />
  );
}

// Same treatment for the settings gear — used on the Home screen to reach
// the Settings screen.
export function SettingsCircleButton({ onPress }: { onPress: () => void }) {
  return (
    <IconButton
      onPress={onPress}
      icon={
        <View style={styles.backCircle}>
          <GearIcon size={20} color={colors.textPrimary} />
        </View>
      }
    />
  );
}

// `surface` opts a screen into the make-your-own-cards tutorial: it reports
// itself whenever it comes into view and hosts the tutorial's popup layer.
export function Screen({
  children,
  scroll = true,
  surface
}: {
  children: React.ReactNode;
  scroll?: boolean;
  surface?: TutorialSurface;
}) {
  const Container = scroll ? ScrollView : View;
  const { reportSurface } = useTutorial();
  useFocusEffect(
    useCallback(() => {
      if (surface) reportSurface(surface);
    }, [surface, reportSurface])
  );
  return (
    <SafeAreaView style={styles.safe}>
      <Container style={styles.screen} contentContainerStyle={scroll ? styles.screenContent : undefined}>
        {children}
      </Container>
      {surface && <TutorialLayer surface={surface} />}
    </SafeAreaView>
  );
}

// Every icon-only control renders at least 44x44 (Apple HIG / Material
// minimum touch target), even when the glyph itself is visually smaller —
// hitSlop compensates so tiny glyphs never shrink the tappable area.
export function IconButton({
  label,
  onPress,
  size = 20,
  rotateDeg,
  icon
}: {
  label?: string;
  onPress: () => void;
  size?: number;
  rotateDeg?: number;
  icon?: React.ReactNode;
}) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      style={({ pressed }) => [styles.iconBtn, pressed && styles.pressedDim]}
    >
      {icon ?? (
        <Text
          style={{
            color: colors.textSecondary,
            fontSize: size,
            transform: rotateDeg ? [{ rotate: `${rotateDeg}deg` }] : undefined
          }}
        >
          {label}
        </Text>
      )}
    </Pressable>
  );
}

export function TopBar({
  title,
  onBack,
  onEdit,
  onRename,
  onAdd,
  backTargetId
}: {
  title: string;
  onBack?: () => void;
  // Registers the back arrow as a tutorial spotlight target.
  backTargetId?: string;
  onEdit?: () => void;
  // When set, the pencil edits the title in place (a cursor appears right
  // in the title text) instead of opening a Rename/Delete menu — used where
  // there's nothing to delete from this button, just a name to change.
  onRename?: (newName: string) => void;
  onAdd?: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(title);
  const inputRef = useRef<TextInput>(null);
  const backRef = useTutorialTarget(backTargetId);

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
    if (trimmed && trimmed !== title) onRename?.(trimmed);
  }

  return (
    <View style={styles.topBar}>
      {onBack && (
        <View ref={backRef} collapsable={false}>
          <BackCircleButton onPress={onBack} />
        </View>
      )}
      {editing ? (
        <TextInput
          ref={inputRef}
          style={[styles.title, styles.titleInput]}
          value={value}
          onChangeText={setValue}
          onSubmitEditing={commitEdit}
          onBlur={commitEdit}
          returnKeyType="done"
        />
      ) : (
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
      )}
      {onRename && !editing && (
        <IconButton
          onPress={startEdit}
          icon={
            <View style={styles.backCircle}>
              <EditPencilIcon size={21} color={colors.textPrimary} />
            </View>
          }
        />
      )}
      {onEdit && (
        <IconButton
          onPress={onEdit}
          icon={
            <View style={styles.backCircle}>
              <EditPencilIcon size={21} color={colors.textPrimary} />
            </View>
          }
        />
      )}
      {onAdd && <IconButton label="+" onPress={onAdd} size={24} />}
    </View>
  );
}

// A piece on the same mid-tone circle the home screen's side tiles use — the
// cburnett art outlines in black (white pieces) or is black-filled with thin
// white detail (black pieces), so a near-black background makes black
// pieces vanish; this mid-tone reads both colors clearly. Use it anywhere a
// piece stands in for a side/level outside the board.
export function PieceBadge({ code, size }: { code: PieceCode; size: number }) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: colors.pieceBadgeBg,
        alignItems: 'center',
        justifyContent: 'center'
      }}
    >
      <PieceGlyph code={code} cell={size * 0.85} />
    </View>
  );
}

// `piece` shows which level's list this path leads into (Queen for
// repertoires, Rook for openings, Knight for cards) — the same glyph used
// for that level's row badges and empty state, so the "what am I looking
// at" cue stays visible even once you're a level deep and the rows
// themselves have scrolled out of view.
export function Breadcrumb({ text, piece }: { text: string; piece?: PieceCode }) {
  return (
    <View style={styles.breadcrumbRow}>
      {piece && <PieceBadge code={piece} size={24} />}
      <Text style={styles.breadcrumb}>{text}</Text>
    </View>
  );
}

export function EmptyState({ text }: { text: string }) {
  return (
    <View style={styles.emptyState}>
      <Text style={styles.emptyStateText}>{text}</Text>
    </View>
  );
}

export function BigButton({
  title,
  onPress,
  variant = 'primary',
  targetId
}: {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'gold' | 'secondary' | 'danger';
  // Registers the button as a spotlight target for the tutorial.
  targetId?: string;
}) {
  const targetRef = useTutorialTarget(targetId);
  return (
    <Pressable
      ref={targetRef}
      collapsable={false}
      onPress={onPress}
      style={({ pressed }) => [
        bigStyles.base,
        variant === 'primary' && bigStyles.primary,
        variant === 'gold' && bigStyles.gold,
        variant === 'secondary' && bigStyles.secondary,
        variant === 'danger' && bigStyles.danger,
        pressed && bigStyles.pressed
      ]}
    >
      <Text
        style={[
          bigStyles.text,
          variant === 'gold' && bigStyles.textGold,
          variant === 'secondary' && bigStyles.textSecondary
        ]}
      >
        {title}
      </Text>
    </Pressable>
  );
}

export function ListRow({
  title,
  subtitle,
  onPress,
  onMenu,
  icon
}: {
  title: string;
  subtitle: string;
  onPress: () => void;
  onMenu: () => void;
  icon?: string;
}) {
  return (
    <View style={rowStyles.row}>
      <Pressable onPress={onPress} style={({ pressed }) => [rowStyles.main, pressed && styles.pressedDim]}>
        {icon && (
          <View style={rowStyles.iconBadge}>
            <Text style={{ fontSize: 18 }}>{icon}</Text>
          </View>
        )}
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={rowStyles.title} numberOfLines={1}>
            {title}
          </Text>
          <Text style={rowStyles.subtitle} numberOfLines={1}>
            {subtitle}
          </Text>
        </View>
        {icon && <Text style={rowStyles.chevron}>›</Text>}
      </Pressable>
      <Pressable onPress={onMenu} hitSlop={4} style={({ pressed }) => [rowStyles.menuBtn, pressed && styles.pressedDim]}>
        <Text style={{ color: colors.textSecondary, fontSize: 18 }}>⋮</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  screen: { flex: 1 },
  screenContent: { padding: spacing.lg, flexGrow: 1 },
  topBar: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.xl, minHeight: touchTarget },
  title: { color: colors.textPrimary, ...type.h1, flex: 1 },
  titleInput: {
    padding: 0,
    borderBottomWidth: 1,
    borderBottomColor: colors.accent
  },
  breadcrumbRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: spacing.xs },
  breadcrumb: { color: colors.textTertiary, ...type.caption },
  iconBtn: {
    minWidth: touchTarget,
    minHeight: touchTarget,
    alignItems: 'center',
    justifyContent: 'center'
  },
  backCircle: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center'
  },
  pressedDim: { opacity: 0.7 },
  emptyState: { paddingVertical: spacing.xxxl, paddingHorizontal: spacing.md, alignItems: 'center' },
  emptyStateText: { color: colors.textSecondary, ...type.body, textAlign: 'center' }
});

const bigStyles = StyleSheet.create({
  // Pill-shaped CTAs per Material 3 Expressive's mobile pattern.
  base: {
    width: '100%',
    borderRadius: radius.pill,
    paddingVertical: spacing.lg,
    minHeight: touchTarget,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.md
  },
  primary: { backgroundColor: colors.primary },
  gold: { backgroundColor: colors.gold },
  secondary: { backgroundColor: colors.surfaceRaised, borderWidth: 1, borderColor: colors.border },
  danger: { backgroundColor: colors.danger },
  pressed: { opacity: 0.85, transform: [{ scale: 0.98 }] },
  text: { color: colors.onPrimary, ...type.bodyStrong },
  textGold: { color: colors.onGold },
  textSecondary: { color: colors.textPrimary }
});

export const rowStyles = StyleSheet.create({
  row: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    marginBottom: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    paddingRight: spacing.xs
  },
  main: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.lg, minHeight: touchTarget },
  iconBadge: {
    width: 38,
    height: 38,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center'
  },
  title: { color: colors.textPrimary, ...type.bodyStrong },
  subtitle: { color: colors.textSecondary, ...type.caption, marginTop: 3 },
  chevron: { color: colors.textTertiary, fontSize: 18, marginRight: spacing.xs },
  menuBtn: { width: touchTarget, height: touchTarget, alignItems: 'center', justifyContent: 'center' }
});
