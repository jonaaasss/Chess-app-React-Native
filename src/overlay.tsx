import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { Modal, View, Text, TextInput, StyleSheet, Pressable, Dimensions, Animated } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';
import { colors, radius, spacing, touchTarget, type } from './theme';
import { TutorialLayer, useTutorial, useTutorialTarget } from './tutorial';
import type { TutorialSurface } from './tutorialContent';

function CloseIcon({ size, color }: { size: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path
        d="M18.3 5.71 12 12.01l-6.3-6.3-1.41 1.41 6.3 6.3-6.3 6.3 1.41 1.41 6.3-6.3 6.3 6.3 1.41-1.41-6.3-6.3 6.3-6.3z"
        fill={color}
      />
    </Svg>
  );
}

export function CloseCircleButton({ onPress }: { onPress: () => void }) {
  return (
    <Pressable onPress={onPress} hitSlop={12} style={closeStyles.circle}>
      <CloseIcon size={13} color="#ffffff" />
    </Pressable>
  );
}

const closeStyles = StyleSheet.create({
  circle: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: colors.danger,
    alignItems: 'center',
    justifyContent: 'center'
  }
});

interface OverlayOptions {
  // Dialogs fade in and out by default. Full-screen windows are better off
  // without: during a fade both windows are half visible at once, each with
  // its own tutorial popup on top.
  animation?: 'fade' | 'none';
  // Fade normally, except while the make-your-own-cards tutorial is running.
  noAnimationInTutorial?: boolean;
}

interface Entry extends OverlayOptions {
  id: number;
  node: React.ReactNode;
}

let nextId = 1;
let setEntries: React.Dispatch<React.SetStateAction<Entry[]>> | null = null;

// What the Android back button/gesture does is up to the window that's on top:
// each window registers its handler under its own entry id (see
// `useOverlayBack`), and only the top Modal ever receives the press.
const OverlayEntryContext = createContext<number | null>(null);
const backHandlers = new Map<number, () => void>();

// Call from a window (or dialog) rendered through `showOverlay`. `handler`
// always runs with the latest render's state.
export function useOverlayBack(handler: () => void) {
  const id = useContext(OverlayEntryContext);
  const latest = useRef(handler);
  latest.current = handler;
  useEffect(() => {
    if (id === null) return;
    backHandlers.set(id, () => latest.current());
    return () => {
      backHandlers.delete(id);
    };
  }, [id]);
}

export function OverlayHost() {
  const [entries, setEntriesState] = useState<Entry[]>([]);
  const { step } = useTutorial();
  // A window's animation is fixed when it opens (Android bakes it into the
  // window, for closing too), so it's decided once per entry.
  const animations = useRef(new Map<number, 'fade' | 'none'>());
  useEffect(() => {
    setEntries = setEntriesState;
    return () => {
      setEntries = null;
    };
  }, []);

  for (const id of [...animations.current.keys()]) {
    if (!entries.some((e) => e.id === id)) animations.current.delete(id);
  }

  return (
    <>
      {entries.map((entry) => {
        let animation = animations.current.get(entry.id);
        if (!animation) {
          animation = entry.animation === 'none' || (entry.noAnimationInTutorial && step) ? 'none' : 'fade';
          animations.current.set(entry.id, animation);
        }
        return (
          <Modal
            key={entry.id}
            visible
            transparent
            animationType={animation}
            statusBarTranslucent
            onRequestClose={() => backHandlers.get(entry.id)?.()}
          >
            <OverlayEntryContext.Provider value={entry.id}>{entry.node}</OverlayEntryContext.Provider>
          </Modal>
        );
      })}
    </>
  );
}

export function showOverlay<T>(
  render: (close: (result: T) => void) => React.ReactNode,
  options: OverlayOptions = {}
): Promise<T> {
  return new Promise((resolve) => {
    const id = nextId++;
    const handleClose = (result: T) => {
      setEntries?.((prev) => prev.filter((e) => e.id !== id));
      resolve(result);
    };
    const node = render(handleClose);
    setEntries?.((prev) => [...prev, { id, node, ...options }]);
  });
}

// `tutorialSurface` lets a dialog host the make-your-own-cards tutorial's popup
// layer (dialogs are separate native windows, so a popup on the screen behind
// can't reach over them).
function Backdrop({ children, tutorialSurface }: { children: React.ReactNode; tutorialSurface?: TutorialSurface }) {
  return (
    <View style={styles.backdrop}>
      <View style={styles.box}>{children}</View>
      {tutorialSurface && <TutorialLayer surface={tutorialSurface} />}
    </View>
  );
}

export function DialogButton({
  title,
  onPress,
  variant = 'secondary',
  targetId
}: {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger';
  targetId?: string;
}) {
  const targetRef = useTutorialTarget(targetId);
  return (
    <Pressable
      ref={targetRef}
      collapsable={false}
      onPress={onPress}
      style={({ pressed }) => [
        styles.btn,
        variant === 'primary' && styles.btnPrimary,
        variant === 'danger' && styles.btnDanger,
        pressed && styles.btnPressed
      ]}
    >
      <Text style={[styles.btnText, variant === 'primary' && styles.btnTextPrimary]}>{title}</Text>
    </Pressable>
  );
}

export interface ConfirmOptions {
  confirmLabel?: string;
  cancelLabel?: string;
  confirmVariant?: 'danger' | 'primary';
}

function ConfirmDialog({
  message,
  options,
  close
}: {
  message: string;
  options: ConfirmOptions;
  close: (result: boolean) => void;
}) {
  useOverlayBack(() => close(false));
  return (
    <Backdrop>
      <Text style={styles.message}>{message}</Text>
      <View style={styles.row}>
        <DialogButton title={options.cancelLabel ?? 'Cancel'} variant="secondary" onPress={() => close(false)} />
        <DialogButton
          title={options.confirmLabel ?? 'Delete'}
          variant={options.confirmVariant ?? 'danger'}
          onPress={() => close(true)}
        />
      </View>
    </Backdrop>
  );
}

// Purely informational — one OK button, no cancel path — for blocking a
// action until the user acknowledges why (e.g. a missing required arrow).
function AlertDialog({ message, close }: { message: string; close: (result: void) => void }) {
  useOverlayBack(() => close());
  return (
    <Backdrop>
      <Text style={styles.message}>{message}</Text>
      <View style={styles.row}>
        <DialogButton title="OK" variant="primary" onPress={() => close()} />
      </View>
    </Backdrop>
  );
}

function PromptDialog({
  title,
  initial,
  placeholder,
  close
}: {
  title: string;
  initial: string;
  placeholder: string;
  close: (result: string | null) => void;
}) {
  const [value, setValue] = useState(initial);
  const inputRef = useRef<TextInput>(null);
  const tutorial = useTutorial();
  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 50);
    return () => clearTimeout(t);
  }, []);
  function save() {
    tutorial.event('promptSave');
    close(value.trim() || null);
  }
  function cancel() {
    tutorial.event('promptCancel');
    close(null);
  }
  useOverlayBack(cancel);
  return (
    <Backdrop tutorialSurface="prompt">
      <Text style={styles.title}>{title}</Text>
      <TextInput
        ref={inputRef}
        style={styles.input}
        value={value}
        onChangeText={setValue}
        placeholder={placeholder}
        placeholderTextColor={colors.textDim}
        onSubmitEditing={save}
      />
      <View style={styles.row}>
        <DialogButton title="Cancel" variant="secondary" onPress={cancel} />
        <DialogButton title="Save" variant="primary" onPress={save} targetId="prompt.save" />
      </View>
    </Backdrop>
  );
}

// Rename/Delete-style actions get colored to match their meaning (green =
// constructive, red = destructive) instead of every option looking the same
// neutral gray — the same color language used for every other button in
// the app.
function menuOptionVariant(opt: string): 'primary' | 'danger' | 'secondary' {
  if (/^delete/i.test(opt)) return 'danger';
  if (/^rename/i.test(opt)) return 'primary';
  return 'secondary';
}

function SimpleMenu({
  title,
  options,
  close
}: {
  title?: string;
  options: string[];
  close: (result: string | null) => void;
}) {
  useOverlayBack(() => close(null));
  return (
    <View style={menuStyles.backdrop}>
      <View style={styles.box}>
        <View style={menuStyles.header}>
          <Text style={menuStyles.title} numberOfLines={1}>
            {title ?? ''}
          </Text>
          <CloseCircleButton onPress={() => close(null)} />
        </View>
        {options.map((opt) => (
          <View key={opt} style={{ marginTop: 8 }}>
            <DialogButton title={opt} variant={menuOptionVariant(opt)} onPress={() => close(opt)} />
          </View>
        ))}
      </View>
    </View>
  );
}

const menuStyles = StyleSheet.create({
  // Anchored near the top of the screen (roughly where the page's own
  // header sits) instead of vertically centered, so the close button reads
  // as being in the top-right of the page, not floating mid-screen.
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    paddingHorizontal: 16,
    paddingTop: 64
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md
  },
  title: { color: colors.textPrimary, ...type.h2, flex: 1, marginRight: spacing.md }
});

export function confirmDialog(message: string, options: ConfirmOptions = {}): Promise<boolean> {
  return showOverlay<boolean>((close) => <ConfirmDialog message={message} options={options} close={close} />);
}

export function alertDialog(message: string): Promise<void> {
  return showOverlay<void>((close) => <AlertDialog message={message} close={close} />);
}

export function promptDialog(title: string, initial = '', placeholder = ''): Promise<string | null> {
  return showOverlay<string | null>(
    (close) => <PromptDialog title={title} initial={initial} placeholder={placeholder} close={close} />,
    { noAnimationInTutorial: true }
  );
}

export function simpleMenu(options: string[], title?: string): Promise<string | null> {
  return showOverlay<string | null>((close) => <SimpleMenu title={title} options={options} close={close} />);
}

export interface AnchorRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

// A plain-text popover pinned just under a given anchor (e.g. a row's "⋮"
// button), with no card/backdrop behind it — just tappable colored labels,
// for spots where a full-screen menu dialog would be overkill.
function AnchoredMenu({
  anchor,
  options,
  close
}: {
  anchor: AnchorRect;
  options: string[];
  close: (result: string | null) => void;
}) {
  useOverlayBack(() => close(null));
  const screenWidth = Dimensions.get('window').width;
  const top = anchor.y + anchor.height + 4;
  const right = Math.max(8, screenWidth - (anchor.x + anchor.width));

  return (
    <>
      <Pressable style={StyleSheet.absoluteFill} onPress={() => close(null)} />
      <View style={[anchoredStyles.menu, { top, right }]}>
        {options.map((opt) => (
          <Pressable
            key={opt}
            onPress={() => close(opt)}
            hitSlop={6}
            style={({ pressed }) => [anchoredStyles.item, pressed && styles.btnPressed]}
          >
            <Text style={[anchoredStyles.itemText, /^delete/i.test(opt) && anchoredStyles.itemTextDanger]}>{opt}</Text>
          </Pressable>
        ))}
      </View>
    </>
  );
}

const anchoredStyles = StyleSheet.create({
  menu: {
    position: 'absolute',
    alignItems: 'flex-end'
  },
  item: {
    minHeight: touchTarget,
    justifyContent: 'center',
    paddingHorizontal: 14
  },
  itemText: { color: colors.textPrimary, fontSize: 15, fontWeight: '600' },
  itemTextDanger: { color: colors.dangerText }
});

export function anchoredMenu(options: string[], anchor: AnchorRect): Promise<string | null> {
  return showOverlay<string | null>((close) => <AnchoredMenu anchor={anchor} options={options} close={close} />);
}

// ---------- Snackbar ----------
// A short message at the bottom of the screen, optionally with an action
// ("Undo"). It's drawn by a <SnackbarLayer /> that lives in each window that
// can be on top (the app itself, the editors), because a Modal window covers
// everything below it — only the topmost layer shows the message.

const SNACKBAR_MS = 6000;

export interface SnackbarOptions {
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  duration?: number;
}

interface SnackbarState extends SnackbarOptions {
  id: number;
}

let currentSnackbar: SnackbarState | null = null;
let snackbarTimer: ReturnType<typeof setTimeout> | undefined;
let nextSnackbarId = 1;
let nextLayerId = 1;
const snackbarListeners = new Set<() => void>();
const snackbarLayers: number[] = [];

function notifySnackbar() {
  snackbarListeners.forEach((listener) => listener());
}

// Returns an id, so whoever showed it can take it down again (see below).
export function showSnackbar(options: SnackbarOptions): number {
  if (snackbarTimer) clearTimeout(snackbarTimer);
  const id = nextSnackbarId++;
  currentSnackbar = { ...options, id };
  snackbarTimer = setTimeout(() => dismissSnackbar(id), options.duration ?? SNACKBAR_MS);
  notifySnackbar();
  return id;
}

// With an id, only takes down that very message (not a newer one that has
// replaced it).
export function dismissSnackbar(id?: number) {
  if (!currentSnackbar || (id !== undefined && currentSnackbar.id !== id)) return;
  if (snackbarTimer) clearTimeout(snackbarTimer);
  currentSnackbar = null;
  notifySnackbar();
}

export function SnackbarLayer({ bottom = 16 }: { bottom?: number }) {
  const insets = useSafeAreaInsets();
  const [, rerender] = useState(0);
  const [layerId] = useState(() => nextLayerId++);
  const fade = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    snackbarLayers.push(layerId);
    const listener = () => rerender((n) => n + 1);
    snackbarListeners.add(listener);
    notifySnackbar();
    return () => {
      snackbarLayers.splice(snackbarLayers.indexOf(layerId), 1);
      snackbarListeners.delete(listener);
      notifySnackbar();
    };
  }, [layerId]);

  const item = currentSnackbar;
  const isTop = snackbarLayers[snackbarLayers.length - 1] === layerId;
  const shownId = item && isTop ? item.id : 0;
  useEffect(() => {
    if (!shownId) return;
    fade.setValue(0);
    Animated.timing(fade, { toValue: 1, duration: 180, useNativeDriver: true }).start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shownId]);

  if (!item || !isTop) return null;
  return (
    <View pointerEvents="box-none" style={[snackbarStyles.wrap, { bottom: bottom + insets.bottom }]}>
      <Animated.View style={[snackbarStyles.bar, { opacity: fade }]}>
        <Text style={snackbarStyles.text}>{item.message}</Text>
        {item.actionLabel ? (
          <Pressable
            onPress={() => {
              dismissSnackbar(item.id);
              item.onAction?.();
            }}
            style={snackbarStyles.action}
          >
            <Text style={snackbarStyles.actionText}>{item.actionLabel}</Text>
          </Pressable>
        ) : (
          <View style={{ width: 10 }} />
        )}
      </Animated.View>
    </View>
  );
}

const snackbarStyles = StyleSheet.create({
  wrap: { position: 'absolute', left: 12, right: 12, alignItems: 'center' },
  bar: {
    alignSelf: 'stretch',
    maxWidth: 520,
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: touchTarget,
    paddingLeft: 16,
    backgroundColor: '#e2e8f0',
    borderRadius: radius.md,
    elevation: 6
  },
  text: { flex: 1, color: colors.bg, fontSize: 14, fontWeight: '500', paddingVertical: 10 },
  action: { minWidth: 64, minHeight: touchTarget, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14 },
  actionText: { color: colors.goldPressed, fontSize: 14, fontWeight: '700' }
});

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16
  },
  box: {
    backgroundColor: colors.panel,
    borderRadius: radius.lg,
    padding: 20,
    width: '100%',
    maxWidth: 380,
    borderWidth: 1,
    borderColor: colors.border
  },
  title: { color: colors.text, fontSize: 16, fontWeight: '600', marginBottom: 12 },
  message: { color: colors.text, fontSize: 15, marginBottom: 16 },
  input: {
    backgroundColor: colors.panel2,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    color: colors.text,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15
  },
  row: { flexDirection: 'row', gap: 10, justifyContent: 'flex-end', marginTop: 16 },
  btn: { borderRadius: radius.pill, paddingVertical: 12, paddingHorizontal: 18, backgroundColor: colors.panel2 },
  btnPrimary: { backgroundColor: colors.accent },
  btnDanger: { backgroundColor: colors.danger },
  btnPressed: { opacity: 0.8 },
  btnText: { color: colors.textPrimary, fontSize: 14, fontWeight: '600' },
  btnTextPrimary: { color: colors.onPrimary }
});
