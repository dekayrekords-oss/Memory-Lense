import { Tabs } from 'expo-router';

export default function RootLayout() {
  return (
    <Tabs>
      <Tabs.Screen name="index" options={{ title: 'Memory' }} />
      <Tabs.Screen name="project" options={{ title: 'Project' }} />
      <Tabs.Screen name="fast" options={{ title: 'Fast Capture' }} />
    </Tabs>
  );
}
