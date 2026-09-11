import React, { useState, useEffect, useRef } from 'react';
import { Modal, View, Text, TextInput, StyleSheet, Pressable, Dimensions } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { colors, radius, spacing, type } from './theme';

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

interface Entry {
  id: number;
  node: React.ReactNode;
}

let nextId = 1;
let setEntries: React.Dispatch<React.SetStateAction<Entry[]>> | null = null;

export function OverlayHost() {
  const [entries, setEntriesState] = useState<Entry[]>([]);
  useEffect(() => {
    setEntries = setEntriesState;
    return () => {
      setEntries = null;
    };
  }, []);

  return (
    <>
      {entries.map((entry) => (
        <Modal key={entry.id} visible transparent animationType="fade" statusBarTranslucent onRequestClose={() => {}}>
          {entry.node}
        </Modal>
      ))}
    </>
  );
}

export function showOverlay<T>(render: (close: (result: T) => void) => React.ReactNode): Promise<T> {
  return new Promise((resolve) => {
    const id = nextId++;
    const handleClose = (result: T) => {
      setEntries?.((prev) => prev.filter((e) => e.id !== id));
      resolve(result);
    };
    const node = render(handleClose);
    setEntries?.((prev) => [...prev, { id, node }]);
  });
}

function Backdrop({ children }: { children: React.ReactNode }) {
  return (
    <View style={styles.backdrop}>
      <View style={styles.box}>{children}</View>
    </View>
  );
}

export function DialogButton({
  title,
  onPress,
  variant = 'secondary'
}: {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger';
}) {
  return (
    <Pressable
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

function ConfirmDialog({ message, close }: { message: string; close: (result: boolean) => void }) {
  return (
    <Backdrop>
      <Text style={styles.message}>{message}</Text>
      <View style={styles.row}>
        <DialogButton title="Cancel" variant="secondary" onPress={() => close(false)} />
        <DialogButton title="Delete" variant="danger" onPress={() => close(true)} />
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
  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 50);
    return () => clearTimeout(t);
  }, []);
  return (
    <Backdrop>
      <Text style={styles.title}>{title}</Text>
      <TextInput
        ref={inputRef}
        style={styles.input}
        value={value}
        onChangeText={setValue}
        placeholder={placeholder}
        placeholderTextColor={colors.textDim}
        onSubmitEditing={() => close(value.trim() || null)}
      />
      <View style={styles.row}>
        <DialogButton title="Cancel" variant="secondary" onPress={() => close(null)} />
        <DialogButton title="Save" variant="primary" onPress={() => close(value.trim() || null)} />
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

export function confirmDialog(message: string): Promise<boolean> {
  return showOverlay<boolean>((close) => <ConfirmDialog message={message} close={close} />);
}

export function promptDialog(title: string, initial = '', placeholder = ''): Promise<string | null> {
  return showOverlay<string | null>((close) => (
    <PromptDialog title={title} initial={initial} placeholder={placeholder} close={close} />
  ));
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
            <Text style={anchoredStyles.itemText}>{opt}</Text>
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
    paddingVertical: 10,
    paddingHorizontal: 14
  },
  itemText: { color: colors.textPrimary, fontSize: 15, fontWeight: '600' }
});

export function anchoredMenu(options: string[], anchor: AnchorRect): Promise<string | null> {
  return showOverlay<string | null>((close) => <AnchoredMenu anchor={anchor} options={options} close={close} />);
}

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
