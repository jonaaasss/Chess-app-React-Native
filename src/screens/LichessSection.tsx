// Settings → "Lichess": the personal API token the opening explorer needs.
// Kept on this phone only (not in the backup).
import React, { useEffect, useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { colors, radius, touchTarget, type } from '../theme';
import { fetchExplorer, getLichessToken, setLichessToken, TOKEN_PAGE } from '../lichessExplorer';

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

export function LichessSection() {
  const [token, setToken] = useState('');
  const [saved, setSaved] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getLichessToken().then((t) => {
      setSaved(t);
      setToken(t ?? '');
    });
  }, []);

  async function save() {
    await setLichessToken(token);
    const t = token.trim() || null;
    setSaved(t);
    setResult(t ? 'Saved.' : 'Token removed.');
  }

  async function test() {
    setBusy(true);
    setResult('Testing…');
    try {
      if (token.trim() !== (saved ?? '')) await save();
      const r = await fetchExplorer(START_FEN, 'lichess');
      setResult(`Works: ${r.games.toLocaleString()} games in the start position.`);
    } catch (e) {
      setResult(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const dirty = token.trim() !== (saved ?? '');
  return (
    <View style={styles.section}>
      <Text style={styles.heading}>Lichess</Text>
      <Text style={styles.body}>The opening explorer in the board editor needs a personal Lichess token (no permissions needed). It stays on this phone.</Text>
      <Pressable onPress={() => Linking.openURL(TOKEN_PAGE)} style={styles.linkBtn}>
        <Text style={styles.linkText}>Create a token on lichess.org</Text>
      </Pressable>
      <TextInput
        style={styles.input}
        value={token}
        onChangeText={setToken}
        placeholder="lip_…"
        placeholderTextColor={colors.textDim}
        autoCapitalize="none"
        autoCorrect={false}
        secureTextEntry
      />
      <View style={styles.actionRow}>
        <Pressable onPress={save} disabled={!dirty} style={[styles.actionBtn, styles.actionPrimary, !dirty && styles.disabled]}>
          <Text style={styles.actionPrimaryText}>Save</Text>
        </Pressable>
        <Pressable onPress={test} disabled={busy || !token.trim()} style={[styles.actionBtn, styles.actionSecondary, (busy || !token.trim()) && styles.disabled]}>
          <Text style={styles.actionSecondaryText}>Test</Text>
        </Pressable>
      </View>
      {result && <Text style={styles.result}>{result}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: 16, marginBottom: 20 },
  heading: { color: colors.text, ...type.bodyStrong, fontSize: 16, marginBottom: 6 },
  body: { color: colors.textSecondary, ...type.caption, marginBottom: 6 },
  linkBtn: { minHeight: touchTarget, justifyContent: 'center' },
  linkText: { color: colors.primary, fontSize: 14, fontWeight: '700' },
  input: { backgroundColor: colors.panel2, borderWidth: 1, borderColor: colors.border, borderRadius: 10, color: colors.text, paddingHorizontal: 12, minHeight: touchTarget, fontSize: 15, marginBottom: 10 },
  actionRow: { flexDirection: 'row', gap: 10, flexWrap: 'wrap' },
  actionBtn: { minHeight: touchTarget, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
  actionPrimary: { backgroundColor: colors.primary },
  actionPrimaryText: { color: colors.onPrimary, fontSize: 15, fontWeight: '700' },
  actionSecondary: { backgroundColor: colors.panel2 },
  actionSecondaryText: { color: colors.text, fontSize: 15, fontWeight: '600' },
  disabled: { opacity: 0.4 },
  result: { color: colors.text, ...type.caption, marginTop: 12 }
});
