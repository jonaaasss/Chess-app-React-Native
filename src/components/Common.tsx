import React from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, radius } from '../theme';

export function Screen({ children, scroll = true }: { children: React.ReactNode; scroll?: boolean }) {
  const Container = scroll ? ScrollView : View;
  return (
    <SafeAreaView style={styles.safe}>
      <Container style={styles.screen} contentContainerStyle={scroll ? styles.screenContent : undefined}>
        {children}
      </Container>
    </SafeAreaView>
  );
}

export function IconButton({
  label,
  onPress,
  size = 20
}: {
  label: string;
  onPress: () => void;
  size?: number;
}) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.iconBtn, pressed && styles.pressedDim]}>
      <Text style={{ color: colors.textDim, fontSize: size }}>{label}</Text>
    </Pressable>
  );
}

export function TopBar({
  title,
  onBack,
  onEdit,
  onAdd
}: {
  title: string;
  onBack?: () => void;
  onEdit?: () => void;
  onAdd?: () => void;
}) {
  return (
    <View style={styles.topBar}>
      {onBack && <IconButton label="←" onPress={onBack} size={22} />}
      <Text style={styles.title} numberOfLines={1}>
        {title}
      </Text>
      {onEdit && <IconButton label="✎" onPress={onEdit} size={18} />}
      {onAdd && <IconButton label="+" onPress={onAdd} size={24} />}
    </View>
  );
}

export function Breadcrumb({ text }: { text: string }) {
  return <Text style={styles.breadcrumb}>{text}</Text>;
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
  variant = 'primary'
}: {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger';
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        bigStyles.base,
        variant === 'primary' && bigStyles.primary,
        variant === 'secondary' && bigStyles.secondary,
        variant === 'danger' && bigStyles.danger,
        pressed && { opacity: 0.85, transform: [{ scale: 0.98 }] }
      ]}
    >
      <Text style={bigStyles.text}>{title}</Text>
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
      <Pressable onPress={onMenu} style={({ pressed }) => [rowStyles.menuBtn, pressed && styles.pressedDim]}>
        <Text style={{ color: colors.textDim, fontSize: 18 }}>⋮</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  screen: { flex: 1 },
  screenContent: { padding: 16, flexGrow: 1 },
  topBar: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 20, minHeight: 32 },
  title: { color: colors.text, fontSize: 20, fontWeight: '700', flex: 1 },
  breadcrumb: { color: colors.textDim, fontSize: 12, marginBottom: 4 },
  iconBtn: { padding: 6 },
  pressedDim: { opacity: 0.7 },
  emptyState: { paddingVertical: 30, paddingHorizontal: 10, alignItems: 'center' },
  emptyStateText: { color: colors.textDim, textAlign: 'center' }
});

const bigStyles = StyleSheet.create({
  base: { width: '100%', borderRadius: 14, paddingVertical: 16, alignItems: 'center', marginTop: 12 },
  primary: { backgroundColor: colors.accent },
  secondary: { backgroundColor: colors.panel2, borderWidth: 1, borderColor: colors.border },
  danger: { backgroundColor: colors.danger },
  text: { color: 'white', fontSize: 15.5, fontWeight: '700' }
});

const rowStyles = StyleSheet.create({
  row: {
    backgroundColor: colors.panel,
    borderRadius: radius,
    marginBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    paddingRight: 6
  },
  main: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16 },
  iconBadge: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: colors.panel2,
    alignItems: 'center',
    justifyContent: 'center'
  },
  title: { color: colors.text, fontSize: 15.5, fontWeight: '600' },
  subtitle: { color: colors.textDim, fontSize: 12.5, marginTop: 3 },
  chevron: { color: colors.textDim, fontSize: 18, marginRight: 4 },
  menuBtn: { padding: 10 }
});
