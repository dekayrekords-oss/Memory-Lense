import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { Tabs } from 'expo-router';
import { ThemeProvider, useTheme } from '@/components/theme';

function ThemedTabs() {
  const theme = useTheme();
  return (
    <>
      <StatusBar style={theme.scheme === 'dark' ? 'light' : 'dark'} />
      <Tabs
        screenOptions={{
          headerStyle: { backgroundColor: theme.card },
          headerTintColor: theme.text,
          headerTitleStyle: { fontSize: 20, fontWeight: '800' },
          headerShadowVisible: false,
          tabBarActiveTintColor: theme.accent,
          tabBarInactiveTintColor: theme.textMuted,
          tabBarStyle: {
            backgroundColor: theme.card,
            borderTopColor: theme.border,
            height: 68,
            paddingBottom: 8,
            paddingTop: 6,
          },
          tabBarLabelStyle: { fontSize: 12, fontWeight: '700' },
        }}
      >
        <Tabs.Screen
          name="index"
          options={{
            title: 'Memory',
            tabBarIcon: ({ color, size, focused }) => (
              <Ionicons
                name={focused ? 'eye' : 'eye-outline'}
                size={size}
                color={color as string}
              />
            ),
          }}
        />
        <Tabs.Screen
          name="project"
          options={{
            title: 'Project',
            tabBarIcon: ({ color, size, focused }) => (
              <Ionicons
                name={focused ? 'hammer' : 'hammer-outline'}
                size={size}
                color={color as string}
              />
            ),
          }}
        />
        <Tabs.Screen
          name="fast"
          options={{
            title: 'Fast Capture',
            tabBarIcon: ({ color, size, focused }) => (
              <Ionicons
                name={focused ? 'flash' : 'flash-outline'}
                size={size}
                color={color as string}
              />
            ),
          }}
        />
        <Tabs.Screen
          name="settings"
          options={{
            title: 'Settings',
            tabBarIcon: ({ color, size, focused }) => (
              <Ionicons
                name={focused ? 'settings' : 'settings-outline'}
                size={size}
                color={color as string}
              />
            ),
          }}
        />
      </Tabs>
    </>
  );
}

export default function RootLayout() {
  return (
    <ThemeProvider>
      <ThemedTabs />
    </ThemeProvider>
  );
}
