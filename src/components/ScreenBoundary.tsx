import { Component, type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

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
    if (this.state.failed) {
      return (
        <View style={styles.fallback}>
          <Text style={styles.title}>Something went wrong on this tab</Text>
          <Text style={styles.hint}>
            Switch tabs and come back, or restart the app. Your saved
            memories are safe.
          </Text>
        </View>
      );
    }
    return this.props.children;
  }
}

const styles = StyleSheet.create({
  fallback: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 8,
  },
  title: { fontSize: 17, fontWeight: '700', textAlign: 'center' },
  hint: { color: '#5f6368', textAlign: 'center' },
});
