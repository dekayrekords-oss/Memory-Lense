import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { Tabs } from 'expo-router';

export default function RootLayout() {
  return (
    <>
      <StatusBar style="dark" />
      <Tabs
        screenOptions={{
          tabBarActiveTintColor: '#0a6cff',
          tabBarInactiveTintColor: '#5f6368',
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
      </Tabs>
    </>
  );
}
