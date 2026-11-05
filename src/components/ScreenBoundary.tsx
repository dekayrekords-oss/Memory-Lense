import { Component, type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useThemedStyles, type ThemeTokens } from './theme';

// Per-tab error boundary: a render crash in one tab shows a card on
// that tab instead of blanking the app. (The 3D preview keeps its own
// tighter boundary inside StepModelView.)

export default class ScreenBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  render(): ReactNode {
    if (this.state.failed) return <FallbackCard />;
    return this.props.children;
  }
}

function FallbackCard() {
  const styles = useThemedStyles(createStyles);
  return (
    <View style={styles.fallback}>
      <Text style={styles.title}>Something went wrong on this tab</Text>
      <Text style={styles.hint}>
        Switch tabs and come back, or restart the app. Your saved memories
        are safe.
      </Text>
    </View>
  );
}

const createStyles = (t: ThemeTokens) =>
  StyleSheet.create({
    fallback: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      padding: 24,
      gap: 8,
      backgroundColor: t.bg,
    },
    title: {
      fontSize: 19,
      fontWeight: '800',
      textAlign: 'center',
      color: t.text,
    },
    hint: { color: t.textSub, textAlign: 'center', fontSize: 15, lineHeight: 21 },
  });
