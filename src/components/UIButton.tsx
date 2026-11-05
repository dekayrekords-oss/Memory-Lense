import { ActivityIndicator, Pressable, StyleSheet, Text } from 'react-native';
import { useTheme, useThemedStyles, type ThemeTokens } from './theme';

// One big friendly button for the whole app: 56pt tall so a child (or
// anyone with shaky hands) can't miss it, a real disabled state, and a
// spinner for async work so nothing is double-tappable while it runs.

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
  const theme = useTheme();
  const styles = useThemedStyles(createStyles);
  const inactive = disabled || loading;
  return (
    <Pressable
      style={({ pressed }) => [
        styles.button,
        variant === 'danger' && styles.danger,
        variant === 'secondary' && styles.secondary,
        inactive && styles.inactive,
        pressed && !inactive && styles.pressed,
      ]}
      onPress={onPress}
      disabled={inactive}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityState={{ disabled: inactive, busy: loading }}
    >
      {loading ? (
        <ActivityIndicator
          color={variant === 'secondary' ? theme.accent : theme.onAccent}
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

const createStyles = (t: ThemeTokens) =>
  StyleSheet.create({
    button: {
      backgroundColor: t.accent,
      borderRadius: 16,
      minHeight: 56,
      paddingHorizontal: 20,
      alignItems: 'center',
      justifyContent: 'center',
    },
    danger: { backgroundColor: t.danger },
    secondary: {
      backgroundColor: t.accentSoft,
      borderWidth: 1,
      borderColor: t.borderStrong,
    },
    inactive: { opacity: 0.55 },
    pressed: { opacity: 0.85, transform: [{ scale: 0.99 }] },
    text: { color: t.onAccent, fontWeight: '800', fontSize: 17 },
    secondaryText: { color: t.accentText },
  });
