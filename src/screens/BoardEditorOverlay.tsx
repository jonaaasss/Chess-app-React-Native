import React, { useRef } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BoardEditor, BoardEditorHandle } from '../components/BoardEditor';
import type { BoardState } from '../types';
import { colors } from '../theme';
import { showOverlay } from '../overlay';

function BoardEditorOverlay({ initial, close }: { initial: BoardState; close: (result: BoardState | null) => void }) {
  const editorRef = useRef<BoardEditorHandle>(null);

  return (
    <SafeAreaView style={styles.overlay}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.topBar}>
          <Pressable onPress={() => close(null)}>
            <Text style={styles.topBarBtn}>Cancel</Text>
          </Pressable>
          <Text style={styles.title}>Board editor</Text>
          <Pressable onPress={() => close(editorRef.current?.getState() ?? initial)}>
            <Text style={[styles.topBarBtn, styles.saveBtn]}>Done</Text>
          </Pressable>
        </View>
        <BoardEditor ref={editorRef} initial={initial} />
      </ScrollView>
    </SafeAreaView>
  );
}

export function openBoardEditorFullscreen(board: BoardState): Promise<BoardState | null> {
  return showOverlay<BoardState | null>((close) => <BoardEditorOverlay initial={board} close={close} />);
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, paddingBottom: 32 },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  topBarBtn: { color: colors.textDim, fontSize: 15 },
  saveBtn: { color: colors.accentHover, fontWeight: '600' },
  title: { color: colors.text, fontWeight: '600', fontSize: 15 }
});
