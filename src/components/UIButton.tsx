import { ActivityIndicator, Pressable, StyleSheet, Text } from 'react-native';

// One button for the whole app: consistent look on iOS and Android,
// a real disabled state, and a spinner for async work so nothing is
// double-tappable while it runs.

export type ButtonVariant = 'primary' | 'danger' | 'secondary';

interface UIButtonProps {
  title: string;
  onPress: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  loading?: boolean;
  accessibilityLabel?: string;
}

export default function UIButton({
  title,
  onPress,
  variant = 'primary',
  disabled = false,
  loading = false,
  accessibilityLabel,
}: UIButtonProps) {
  const inactive = disabled || loading;
  return (
    <Pressable
      style={[
        styles.button,
        variant === 'danger' && styles.danger,
        variant === 'secondary' && styles.secondary,
        inactive && styles.inactive,
      ]}
      onPress={onPress}
      disabled={inactive}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityState={{ disabled: inactive, busy: loading }}
    >
      {loading ? (
        <ActivityIndicator
          color={variant === 'secondary' ? '#0a6cff' : '#fff'}
        />
      ) : (
        <Text
          style={[
            styles.text,
            variant === 'secondary' && styles.secondaryText,
          ]}
        >
          {title}
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    backgroundColor: '#0a6cff',
    borderRadius: 10,
    minHeight: 48,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  danger: { backgroundColor: '#c62828' },
  secondary: {
    backgroundColor: '#eef3ff',
    borderWidth: 1,
    borderColor: '#c9d8f5',
  },
  inactive: { opacity: 0.55 },
  text: { color: '#fff', fontWeight: '700', fontSize: 16 },
  secondaryText: { color: '#0a3fa8' },
});
