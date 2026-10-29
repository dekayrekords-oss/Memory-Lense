import Constants from 'expo-constants';
import { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import ScreenBoundary from '@/components/ScreenBoundary';
import Section from '@/components/Section';
import UIButton from '@/components/UIButton';
import {
  formatInterval,
  INTERVAL_PRESETS_SECONDS,
} from '@/services/config';
import {
  getSettings,
  loadSettings,
  saveSettings,
  type AppSettings,
} from '@/services/settings';

// Settings: the vision backend URL is what turns the offline demo
// into real analysis (find/watch, exit alerts, privacy screening).
// Saved values apply live — no rebuild, no restart.

export default function SettingsScreen() {
  const [settings, setSettingsState] = useState<AppSettings>(() =>
    getSettings(),
  );
  const [urlDraft, setUrlDraft] = useState(settings.visionApiUrl);
  const [savedNote, setSavedNote] = useState<string | null>(null);

  useEffect(() => {
    void loadSettings().then((loaded) => {
      setSettingsState(loaded);
      setUrlDraft(loaded.visionApiUrl);
    });
  }, []);

  const apply = async (patch: Partial<AppSettings>, note: string) => {
    const next = await saveSettings(patch);
    setSettingsState(next);
    setSavedNote(note);
  };

  const demoVision = settings.visionApiUrl.trim() === '';

  return (
    <ScreenBoundary>
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <KeyboardAvoidingView
          style={styles.keyboard}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <ScrollView
            contentContainerStyle={styles.container}
            keyboardShouldPersistTaps="handled"
          >
            <Text style={styles.heading}>Settings</Text>

            <Section
              title="Vision backend"
              hint={
                demoVision
                  ? 'Not connected — the app runs on offline demo vision. Simulation demos work, but real photos are not analyzed: find/watch, exit alerts, and privacy screening need the backend.'
                  : 'Connected. Real photos are analyzed by this backend.'
              }
            >
              <TextInput
                style={styles.input}
                value={urlDraft}
                onChangeText={setUrlDraft}
                placeholder="http://192.168.1.20:8787/analyze"
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="done"
              />
              <UIButton
                title="Save backend URL"
                onPress={() =>
                  void apply(
                    { visionApiUrl: urlDraft.trim() },
                    urlDraft.trim()
                      ? 'Backend saved — real analysis is on.'
                      : 'Backend cleared — offline demo vision.',
                  )
                }
              />
              <Text style={styles.sub}>
                On your computer: cd memory-lens, set VISION_API_KEY, then
                npm run server. Use the LAN IP of that computer (the phone
                cannot reach localhost) with port 8787 and the /analyze
                path. Free options are listed in .env.example.
              </Text>
            </Section>

            <Section
              title="Capture"
              hint="Default photo interval when Memory mode starts. Raise it to save battery."
            >
              <View style={styles.chips}>
                {INTERVAL_PRESETS_SECONDS.map((s) => (
                  <Pressable
                    key={s}
                    style={[
                      styles.chip,
                      s === settings.captureIntervalSeconds &&
                        styles.chipActive,
                    ]}
                    onPress={() =>
                      void apply(
                        { captureIntervalSeconds: s },
                        `Default interval saved: ${formatInterval(s)}.`,
                      )
                    }
                    accessibilityRole="button"
                    accessibilityLabel={`Default photo interval ${formatInterval(s)}`}
                    accessibilityState={{
                      selected: s === settings.captureIntervalSeconds,
                    }}
                  >
                    <Text
                      style={
                        s === settings.captureIntervalSeconds &&
                        styles.chipTextActive
                      }
                    >
                      {formatInterval(s)}
                    </Text>
                  </Pressable>
                ))}
              </View>
              <View style={styles.switchRow}>
                <Text style={styles.switchLabel}>
                  Silence camera sounds
                </Text>
                <Switch
                  value={settings.muteCameraSounds}
                  onValueChange={(value) =>
                    void apply(
                      { muteCameraSounds: value },
                      value
                        ? 'Camera sounds silenced.'
                        : 'Camera sounds on.',
                    )
                  }
                  accessibilityLabel="Silence camera sounds"
                />
              </View>
            </Section>

            <Section title="Privacy">
              <Text style={styles.sub}>
                Restroom or nudity detection stops capture immediately and
                never keeps that photo. This stays on — it is not a
                setting. With no backend connected there is no real
                screening, and real photos are never kept from demo mode.
              </Text>
            </Section>

            <Section title="About">
              <Text style={styles.sub}>
                Memory Lens {Constants.expoConfig?.version ?? '1.0.0'} ·
                Expo SDK 58 · Memories live in on-device SQLite; photos
                exist only for kept frames (cap 500, pruned at 30 days).
                Manage them from the Memory tab → Storage & retention.
              </Text>
            </Section>

            {savedNote ? (
              <Text style={styles.answer}>{savedNote}</Text>
            ) : null}
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </ScreenBoundary>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  keyboard: { flex: 1 },
  container: {
    padding: 16,
    gap: 12,
    width: '100%',
    maxWidth: 720,
    alignSelf: 'center',
  },
  heading: { fontSize: 22, fontWeight: '700' },
  sub: { color: '#5f6368', fontSize: 13 },
  input: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    padding: 10,
    backgroundColor: '#fff',
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    backgroundColor: '#eef3ff',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 9,
    minHeight: 40,
    justifyContent: 'center',
    overflow: 'hidden',
  },
  chipActive: { backgroundColor: '#0a6cff' },
  chipTextActive: { color: '#fff', fontWeight: '700' },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  switchLabel: { fontSize: 15 },
  answer: { backgroundColor: '#f2f7ff', borderRadius: 8, padding: 10 },
});
