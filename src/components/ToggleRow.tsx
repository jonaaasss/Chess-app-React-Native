import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { colors, type } from '../theme';

// The whole row is the switch: tapping the label or its description toggles
// too, not just the small switch itself.
export function ToggleRow({
  label,
  value,
  onToggle,
  description
}: {
  label: string;
  value: boolean;
  onToggle: () => void;
  description: string;
}) {
  return (
    <Pressable
      onPress={onToggle}
      accessibilityRole="switch"
      accessibilityState={{ checked: value }}
      style={({ pressed }) => [styles.toggleRow, pressed && styles.toggleRowPressed]}
    >
      <View style={{ flex: 1 }}>
        <Text style={styles.label}>{label}</Text>
        <Text style={styles.description}>{description}</Text>
      </View>
      <View style={[styles.toggle, value && styles.toggleOn]}>
        <View style={[styles.toggleThumb, value && styles.toggleThumbOn]} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 56,
    paddingVertical: 10,
    marginBottom: 12,
    borderRadius: 10
  },
  toggleRowPressed: { opacity: 0.7 },
  label: { color: colors.text, ...type.bodyStrong, fontSize: 16 },
  description: { color: colors.textDim, ...type.caption, marginTop: 3 },
  toggle: { width: 46, height: 26, borderRadius: 13, backgroundColor: colors.border, justifyContent: 'center' },
  toggleOn: { backgroundColor: colors.accent },
  toggleThumb: { width: 20, height: 20, borderRadius: 10, backgroundColor: 'white', marginLeft: 3 },
  toggleThumbOn: { marginLeft: 23 }
});
