import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useThemedStyles, type ThemeTokens } from './theme';

// One friendly card per job: a clear title in plain words, one short
// hint, then big controls. Same card on every tab, light and dark.

interface SectionProps {
  title: string;
  hint?: string;
  children: ReactNode;
}

export default function Section({ title, hint, children }: SectionProps) {
  const styles = useThemedStyles(createStyles);
  return (
    <View style={styles.card} accessibilityRole="none">
      <Text style={styles.title}>{title}</Text>
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
      {children}
    </View>
  );
}

const createStyles = (t: ThemeTokens) =>
  StyleSheet.create({
    card: {
      backgroundColor: t.card,
      borderRadius: 20,
      padding: 18,
      gap: 12,
      borderWidth: 1,
      borderColor: t.border,
      shadowColor: '#0B1B33',
      shadowOpacity: t.scheme === 'dark' ? 0 : 0.06,
      shadowRadius: 12,
      shadowOffset: { width: 0, height: 4 },
      elevation: t.scheme === 'dark' ? 0 : 2,
    },
    title: { fontSize: 18, fontWeight: '800', color: t.text, letterSpacing: 0.2 },
    hint: { color: t.textSub, fontSize: 14, lineHeight: 20 },
  });
