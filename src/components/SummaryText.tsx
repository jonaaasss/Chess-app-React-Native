import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { MoveText } from './MoveText';
import { colors } from '../theme';

// An opening's Summary. Plain lines are shown as text; consecutive lines with a
// "|" in them become a table, one line per row and one "|" per column. A line
// that starts with "#" is the table's header row. Column widths follow the
// longest text in each column, so the columns line up whatever the font.
// Write \n inside a cell for a second line in that same cell.
// Moves are coloured: c3 (always played) green, ?Bd3 (depends on the
// opponent) orange, !c3 (the opponent plays it) red.
export function SummaryText({ text, blurred }: { text: string; blurred?: boolean }) {
  const out: React.ReactNode[] = [];
  let block: string[] = [];
  const flush = (key: string) => {
    if (block.length === 0) return;
    out.push(<SummaryTable key={key} lines={block} blurred={blurred} />);
    block = [];
  };
  text.split('\n').forEach((line, i) => {
    if (line.includes('|')) {
      block.push(line);
      return;
    }
    flush(`t${i}`);
    if (line.trim() === '') out.push(<View key={`s${i}`} style={{ height: 12 }} />);
    else out.push(<MoveText key={`l${i}`} markers text={line} style={styles.cell} blurred={blurred} />);
  });
  flush('end');
  return <View>{out}</View>;
}

function SummaryTable({ lines, blurred }: { lines: string[]; blurred?: boolean }) {
  const rows = lines.map((line) => {
    const header = line.trimStart().startsWith('#');
    const cells = line.replace(/^\s*#\s*/, '').split('|').map((c) => c.trim().replace(/\\n/g, '\n'));
    return { header, cells };
  });
  const columns = Math.max(...rows.map((r) => r.cells.length));
  const widths = Array.from({ length: columns }, (_, c) =>
    Math.max(3, ...rows.flatMap((r) => (r.cells[c] ?? '').split('\n').map((l) => l.replace(/[!?]/g, '').length)))
  );
  return (
    <View style={styles.table}>
      {rows.map((r, ri) => (
        <View key={ri} style={[styles.row, r.header && styles.headerRow]}>
          {widths.map((w, c) => (
            <View key={c} style={c === 0 ? { width: w * 9.5 + 8, flexShrink: 0, paddingRight: 8 } : { flex: w, paddingRight: 8 }}>
              {r.header ? (
                <Text style={styles.headerCell}>{r.cells[c] ?? ''}</Text>
              ) : (
                <MoveText markers text={r.cells[c] ?? ''} style={styles.cell} blurred={blurred} />
              )}
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}

// The same text as a short plain preview (no table), for the Cards screen.
export function summaryPreviewText(text: string): string {
  return text
    .split('\n')
    .filter((l) => !l.trimStart().startsWith('#'))
    .map((l) => (l.includes('|') ? l.split('|').map((c) => c.trim().replace(/\\n/g, ' ')).filter(Boolean).join('  ·  ') : l))
    .join('\n');
}

const styles = StyleSheet.create({
  table: { marginVertical: 4 },
  row: {
    flexDirection: 'row',
    paddingVertical: 7,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border
  },
  headerRow: { borderBottomColor: 'rgba(255,255,255,0.25)' },
  headerCell: { color: colors.textSecondary, fontSize: 12, fontWeight: '700' },
  cell: { color: colors.text, fontSize: 15, lineHeight: 21 }
});
