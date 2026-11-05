import Constants from 'expo-constants';
import { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Linking,
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
import { useThemedStyles, type ThemeTokens } from '@/components/theme';
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
import {
  AI_PROVIDERS,
  freeVisionModels,
  providerById,
} from '@/services/aiProviders';
import {
  checkLocalModelUpdate,
  deleteLocalModel,
  downloadLocalModel,
  fetchRemoteModelVersion,
  isModelDownloaded,
  isUpdateAvailable,
  LOCAL_MODELS,
  localModelById,
  markModelDownloaded,
  maybeCheckLocalModelUpdate,
} from '@/services/localModel';

// Settings: the vision backend URL is what turns the offline demo
// into real analysis (find/watch, exit alerts, privacy screening).
// Saved values apply live — no rebuild, no restart.

export default function SettingsScreen() {
  const styles = useThemedStyles(createStyles);

  const [settings, setSettingsState] = useState<AppSettings>(() =>
    getSettings(),
  );
  const [urlDraft, setUrlDraft] = useState(settings.visionApiUrl);
  const [savedNote, setSavedNote] = useState<string | null>(null);
  const [providerId, setProviderId] = useState(settings.cloudProviderId);
  const [keyDraft, setKeyDraft] = useState('');
  const [modelDraft, setModelDraft] = useState('');
  const [baseUrlDraft, setBaseUrlDraft] = useState('');
  const [localBusy, setLocalBusy] = useState<string | null>(null);
  const [localNote, setLocalNote] = useState<string | null>(null);

  const loadProviderDrafts = (id: string, from: AppSettings) => {
    const def = providerById(id);
    const stored = from.providerConfigs[id];
    setProviderId(id);
    setKeyDraft(stored?.apiKey ?? '');
    setModelDraft(
      stored?.model ?? def?.models.find((m) => m.vision)?.id ?? '',
    );
    setBaseUrlDraft(stored?.baseUrl ?? def?.defaultBaseUrl ?? '');
  };

  useEffect(() => {
    void loadSettings().then((loaded) => {
      setSettingsState(loaded);
      setUrlDraft(loaded.visionApiUrl);
      loadProviderDrafts(loaded.cloudProviderId, loaded);
    });
    // Automatic model update check — runs at most once a day.
    void maybeCheckLocalModelUpdate().then(() => {
      setSettingsState(getSettings());
    });
  }, []);

  const apply = async (patch: Partial<AppSettings>, note: string) => {
    try {
      const next = await saveSettings(patch);
      setSettingsState(next);
      setSavedNote(note);
    } catch {
      setSettingsState(getSettings());
      setSavedNote(
        'Could not save on this phone — the change works until the app restarts, then it is gone. Free up storage and try again.',
      );
    }
  };

  const providerDef = providerById(providerId) ?? AI_PROVIDERS[0];
  const freeModels = freeVisionModels();
  const localDef = localModelById(settings.localModel.modelId);
  const localDownloaded = isModelDownloaded(localDef);
  const localUpdate = isUpdateAvailable(settings.localModel);
  const sourceLabel =
    settings.visionSource === 'cloud'
      ? `Cloud: ${providerById(settings.cloudProviderId)?.label ?? settings.cloudProviderId}`
      : settings.visionSource === 'backend'
        ? 'My vision backend'
        : settings.visionSource === 'local'
          ? 'On-device model'
          : 'Offline demo';

  const runLocalCheck = async (manual: boolean) => {
    setLocalBusy('check');
    try {
      const result = await checkLocalModelUpdate();
      setSettingsState(getSettings());
      setLocalNote(
        result.updateAvailable
          ? 'A model update is available — tap Download model to get it.'
          : localDownloaded
            ? 'Your on-device model is up to date.'
            : 'Checked: no model downloaded yet. Tap Download model to install it.',
      );
    } catch (error) {
      if (manual) {
        setLocalNote(
          `Update check failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    } finally {
      setLocalBusy(null);
    }
  };

  const runLocalDownload = async () => {
    setLocalBusy('download');
    setLocalNote(
      `Downloading ${localDef.name} (~${localDef.approxSizeMB} MB). Keep the app open; Wi-Fi recommended.`,
    );
    try {
      const version =
        settings.localModel.remoteVersion ||
        (await fetchRemoteModelVersion(localDef));
      await downloadLocalModel(localDef);
      await markModelDownloaded(version);
      setSettingsState(getSettings());
      setLocalNote(
        `${localDef.name} downloaded to this phone (${version.slice(0, 8)}).`,
      );
    } catch (error) {
      setLocalNote(
        `Download failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      setLocalBusy(null);
    }
  };

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
            {savedNote ? (
              <Text style={styles.answer}>{savedNote}</Text>
            ) : null}

            <Section
              title="Look & feel"
              hint="Light, dark, or match your phone. Changes everything instantly."
            >
              <View style={styles.chips}>
                {(
                  [
                    ['system', 'Match phone'],
                    ['light', 'Light'],
                    ['dark', 'Dark'],
                  ] as const
                ).map(([id, label]) => (
                  <Pressable
                    key={id}
                    style={[
                      styles.chip,
                      settings.themePreference === id && styles.chipActive,
                    ]}
                    onPress={() =>
                      void apply(
                        { themePreference: id },
                        'Theme saved: ' + label + '.',
                      )
                    }
                    accessibilityRole="button"
                    accessibilityLabel={'Theme ' + label}
                    accessibilityState={{
                      selected: settings.themePreference === id,
                    }}
                  >
                    <Text
                      style={[
                        styles.chipText,
                        settings.themePreference === id &&
                          styles.chipTextActive,
                      ]}
                    >
                      {label}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </Section>

            <Section
              title="Vision backend"
              hint={
                settings.visionSource === 'backend'
                  ? settings.visionApiUrl.trim()
                    ? 'Connected. Real photos are analyzed by this backend.'
                    : 'No URL saved yet — "My backend" is your AI source, so real photos are not analyzed until you save one.'
                  : 'Optional. The AI source below is what analyzes real photos; this backend only runs when "My backend" is the selected AI source.'
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
                    {
                      visionApiUrl: urlDraft.trim(),
                      visionSource: urlDraft.trim()
                        ? 'backend'
                        : settings.visionSource,
                    },
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
              title="AI source"
              hint={`Real photos are analyzed by: ${sourceLabel}. Offline demo never analyzes real photos.`}
            >
              <View style={styles.chips}>
                {(
                  [
                    ['demo', 'Offline demo'],
                    ['backend', 'My backend'],
                    ['cloud', 'Cloud API key'],
                    ['local', 'On-device model'],
                  ] as const
                ).map(([id, label]) => (
                  <Pressable
                    key={id}
                    style={[
                      styles.chip,
                      settings.visionSource === id && styles.chipActive,
                    ]}
                    onPress={() =>
                      void apply(
                        { visionSource: id },
                        `AI source saved: ${label}.`,
                      )
                    }
                    accessibilityRole="button"
                    accessibilityLabel={`AI source ${label}`}
                    accessibilityState={{
                      selected: settings.visionSource === id,
                    }}
                  >
                    <Text
                      style={[styles.chipText, settings.visionSource === id && styles.chipTextActive]}
                    >
                      {label}
                    </Text>
                  </Pressable>
                ))}
              </View>
              {settings.visionSource === 'local' ? (
                <Text style={styles.sub}>
                  The on-device model is downloaded and kept updated below.
                  This build stages the model on the phone; until the
                  on-device inference runtime ships, real-photo analysis
                  still uses the cloud key or backend — pick one of those
                  above for working analysis today.
                </Text>
              ) : null}
            </Section>

            <Section
              title="Cloud AI provider & API key"
              hint="Your key is kept in this phone's secure keystore and sent only to the provider you pick. Photos leave the phone and are analysed by that provider — that is how cloud mode works. Saving activates the cloud source."
            >
              <View style={styles.chips}>
                {AI_PROVIDERS.map((def) => (
                  <Pressable
                    key={def.id}
                    style={[
                      styles.chip,
                      providerId === def.id && styles.chipActive,
                    ]}
                    onPress={() => loadProviderDrafts(def.id, settings)}
                    accessibilityRole="button"
                    accessibilityLabel={`Provider ${def.label}`}
                    accessibilityState={{ selected: providerId === def.id }}
                  >
                    <Text
                      style={[styles.chipText, providerId === def.id && styles.chipTextActive]}
                    >
                      {def.label}
                      {def.models.some((m) => m.free && m.vision)
                        ? ' · FREE'
                        : ''}
                    </Text>
                  </Pressable>
                ))}
              </View>
              <Text style={styles.sub}>{providerDef.keyHelp}</Text>
              {providerDef.keyUrl ? (
                <Pressable
                  onPress={() => void Linking.openURL(providerDef.keyUrl!)}
                  accessibilityRole="link"
                  accessibilityLabel={`Get a ${providerDef.label} API key (opens browser)`}
                >
                  <Text style={styles.link}>
                    Get a {providerDef.label} API key →
                  </Text>
                </Pressable>
              ) : null}
              <TextInput
                style={styles.input}
                value={keyDraft}
                onChangeText={setKeyDraft}
                placeholder={`${providerDef.label} API key`}
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="next"
              />
              <TextInput
                style={styles.input}
                value={modelDraft}
                onChangeText={setModelDraft}
                placeholder="Vision model name"
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="next"
              />
              {providerDef.models.length > 0 ? (
                <View style={styles.chips}>
                  {providerDef.models.map((m) => (
                    <Pressable
                      key={m.id}
                      style={styles.chip}
                      onPress={() => setModelDraft(m.id)}
                      accessibilityRole="button"
                      accessibilityLabel={`Use model ${m.id}`}
                    >
                      <Text style={styles.chipText}>
                        {m.id}
                        {m.free ? ' · FREE' : ''}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              ) : null}
              {providerDef.kind === 'openai-compatible' ? (
                <TextInput
                  style={styles.input}
                  value={baseUrlDraft}
                  onChangeText={setBaseUrlDraft}
                  placeholder="Base URL, e.g. https://openrouter.ai/api/v1"
                  autoCapitalize="none"
                  autoCorrect={false}
                  returnKeyType="done"
                />
              ) : null}
              <Text style={styles.sub}>{providerDef.freeNote}</Text>
              <UIButton
                title={`Save ${providerDef.label} & use it`}
                onPress={() =>
                  void apply(
                    {
                      visionSource: 'cloud',
                      cloudProviderId: providerId,
                      providerConfigs: {
                        ...settings.providerConfigs,
                        [providerId]: {
                          apiKey: keyDraft.trim(),
                          model: modelDraft.trim(),
                          baseUrl: baseUrlDraft.trim(),
                        },
                      },
                    },
                    keyDraft.trim() && modelDraft.trim()
                      ? `${providerDef.label} saved — real photos now go to ${modelDraft.trim()}.`
                      : 'Saved, but analysis needs both an API key and a model name.',
                  )
                }
              />
            </Section>

            <Section
              title="Free model options"
              hint="Free vision models you can use with a key from that provider. Free rosters change — the provider console is the source of truth."
            >
              {freeModels.map((entry) => (
                <Text key={`${entry.provider}:${entry.model}`} style={styles.sub}>
                  {entry.provider}: {entry.model} — FREE
                </Text>
              ))}
              <Text style={styles.sub}>
                Also free: OpenCode Zen and OpenRouter rotate extra free
                vision models (names ending in :free on OpenRouter). Type
                the current model name into the model field above.
              </Text>
            </Section>

            <Section
              title="On-device model (local)"
              hint="A small vision model downloaded to this phone. The app checks for a model update once a day when opened, and you can check manually any time."
            >
              <View style={styles.chips}>
                {LOCAL_MODELS.map((def) => (
                  <Pressable
                    key={def.id}
                    style={[
                      styles.chip,
                      settings.localModel.modelId === def.id &&
                        styles.chipActive,
                    ]}
                    onPress={() =>
                      void apply(
                        {
                          visionSource: 'local',
                          localModel: {
                            ...settings.localModel,
                            modelId: def.id,
                          },
                        },
                        `On-device model selected: ${def.name}.`,
                      )
                    }
                    accessibilityRole="button"
                    accessibilityLabel={`Local model ${def.name}`}
                    accessibilityState={{
                      selected: settings.localModel.modelId === def.id,
                    }}
                  >
                    <Text
                      style={[styles.chipText, settings.localModel.modelId === def.id && styles.chipTextActive]}
                    >
                      {def.name} · ~{def.approxSizeMB} MB
                    </Text>
                  </Pressable>
                ))}
              </View>
              <Text style={styles.sub}>{localDef.blurb}</Text>
              <Text style={styles.sub}>
                Status:{' '}
                {localDownloaded
                  ? `downloaded${settings.localModel.downloadedVersion ? ` (${settings.localModel.downloadedVersion.slice(0, 8)})` : ''}`
                  : 'not downloaded'}
                {localUpdate ? ' · UPDATE AVAILABLE' : ''}
                {settings.localModel.lastUpdateCheckTs > 0
                  ? ` · last checked ${new Date(settings.localModel.lastUpdateCheckTs).toLocaleDateString()}`
                  : ' · never checked'}
              </Text>
              <View style={styles.buttonRow}>
                <View style={styles.flex}>
                  <UIButton
                    title={localDownloaded ? 'Re-download / update' : 'Download model'}
                    loading={localBusy === 'download'}
                    disabled={localBusy !== null}
                    onPress={() => void runLocalDownload()}
                  />
                </View>
                <View style={styles.flex}>
                  <UIButton
                    title="Check for updates"
                    variant="secondary"
                    loading={localBusy === 'check'}
                    disabled={localBusy !== null}
                    onPress={() => void runLocalCheck(true)}
                  />
                </View>
              </View>
              {localDownloaded ? (
                <UIButton
                  title="Delete downloaded model"
                  variant="danger"
                  disabled={localBusy !== null}
                  onPress={() => {
                    deleteLocalModel(localDef);
                    void apply(
                      {
                        localModel: {
                          ...settings.localModel,
                          downloadedVersion: '',
                        },
                      },
                      'On-device model deleted from this phone.',
                    );
                  }}
                />
              ) : null}
              {localNote ? <Text style={styles.answer}>{localNote}</Text> : null}
              <Text style={styles.sub}>
                Downloaded models live in the app&apos;s private storage on this
                phone. On-device inference needs a native vision runtime
                that is not in this build yet — until it ships, analysis
                uses your cloud key or backend, and the model stays staged
                and updated here.
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
                      style={[styles.chipText, s === settings.captureIntervalSeconds && styles.chipTextActive]}
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

const createStyles = (t: ThemeTokens) =>
  StyleSheet.create({
  safe: { flex: 1, backgroundColor: t.bg },
  keyboard: { flex: 1 },
  container: {
    padding: 16,
    gap: 12,
    width: '100%',
    maxWidth: 720,
    alignSelf: 'center',
  },
  heading: { fontSize: 28, fontWeight: '800', color: t.text, letterSpacing: 0.2 },
  sub: { color: t.textSub, fontSize: 14, lineHeight: 20 },
  input: {
    color: t.text,
    fontSize: 16,
    borderWidth: 1,
    borderColor: t.borderStrong,
    borderRadius: 8,
    padding: 10,
    backgroundColor: t.card,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    backgroundColor: t.accentSoft,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 9,
    minHeight: 48,
    justifyContent: 'center',
    overflow: 'hidden',
  },
  chipActive: { backgroundColor: t.accent },
  chipText: { color: t.text, fontWeight: '600', fontSize: 15 },
  chipTextActive: { color: t.onAccent, fontWeight: '800' },
  buttonRow: { flexDirection: 'row', gap: 8 },
  flex: { flex: 1 },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  switchLabel: { fontSize: 16, color: t.text, fontWeight: '600' },
  answer: { backgroundColor: t.infoBg, borderRadius: 12, padding: 12, color: t.text, fontSize: 15, lineHeight: 21 },
  link: { color: t.accent, fontSize: 14, paddingVertical: 4 },
});
