import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

// Card section for the long settings-style screens: one title, one
// optional hint line, then the controls. Keeps the Memory/Project/Fast
// screens visually consistent without restyling every row.

interface SectionProps {
  title: string;
  hint?: string;
  children: ReactNode;
}

export default function Section({ title, hint, children }: SectionProps) {
  return (
    <View style={styles.card} accessibilityRole="none">
      <Text style={styles.title}>{title}</Text>
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    gap: 10,
    borderWidth: 1,
    borderColor: '#e3e3e3',
  },
  title: { fontSize: 15, fontWeight: '700' },
  hint: { color: '#5f6368', fontSize: 13 },
});
