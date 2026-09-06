import React, { useState, useEffect, useRef } from 'react';
import { Modal, View, Text, TextInput, StyleSheet, Pressable } from 'react-native';
import { colors, radius } from './theme';

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
      <Text style={[styles.btnText, variant === 'secondary' && { color: colors.text }]}>{title}</Text>
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

function SimpleMenu({ options, close }: { options: string[]; close: (result: string | null) => void }) {
  return (
    <Backdrop>
      {options.map((opt) => (
        <View key={opt} style={{ marginTop: 8 }}>
          <DialogButton title={opt} variant="secondary" onPress={() => close(opt)} />
        </View>
      ))}
      <View style={{ marginTop: 8 }}>
        <DialogButton title="Cancel" variant="secondary" onPress={() => close(null)} />
      </View>
    </Backdrop>
  );
}

export function confirmDialog(message: string): Promise<boolean> {
  return showOverlay<boolean>((close) => <ConfirmDialog message={message} close={close} />);
}

export function promptDialog(title: string, initial = '', placeholder = ''): Promise<string | null> {
  return showOverlay<string | null>((close) => (
    <PromptDialog title={title} initial={initial} placeholder={placeholder} close={close} />
  ));
}

export function simpleMenu(options: string[]): Promise<string | null> {
  return showOverlay<string | null>((close) => <SimpleMenu options={options} close={close} />);
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
    borderRadius: radius,
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
  btn: { borderRadius: 10, paddingVertical: 12, paddingHorizontal: 16, backgroundColor: colors.panel2 },
  btnPrimary: { backgroundColor: colors.accent },
  btnDanger: { backgroundColor: colors.danger },
  btnPressed: { opacity: 0.8 },
  btnText: { color: 'white', fontSize: 14, fontWeight: '600' }
});
