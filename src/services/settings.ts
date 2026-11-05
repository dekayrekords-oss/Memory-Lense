import { File, Paths } from 'expo-file-system';
import { readProviderKey, writeProviderKey } from './secureKeys';
import { clampIntervalSeconds } from './config';

// App settings, editable from the Settings tab and persisted to a JSON
// file in the document directory. The vision backend URL is the big
// one: it turns the offline demo into real analysis (tracking, exit
// alerts, privacy screening) without a rebuild. EXPO_PUBLIC_* remains
// the seed default, never a requirement.

export type VisionSourceKind = 'demo' | 'backend' | 'cloud' | 'local';

export type ThemePreference = 'system' | 'light' | 'dark';

export interface StoredProviderConfig {
  apiKey: string;
  model: string;
  baseUrl: string;
}

export interface LocalModelState {
  /** Catalog id of the selected on-device model. */
  modelId: string;
  /** Version (HF repo sha) last seen remotely. */
  remoteVersion: string;
  /** Version actually downloaded to this phone. */
  downloadedVersion: string;
  /** Epoch ms of the last update check (auto-check runs at most daily). */
  lastUpdateCheckTs: number;
}

export interface AppSettings {
  /** Vision backend endpoint (…/analyze). Empty = offline demo vision. */
  visionApiUrl: string;
  /** Default photo interval for Memory mode on a fresh start. */
  captureIntervalSeconds: number;
  /** Silence the camera shutter/recording sounds. */
  muteCameraSounds: boolean;
  /** Which vision source analyzes real photos. */
  visionSource: VisionSourceKind;
  /** UI theme: follow the phone, or pin light/dark. */
  themePreference: ThemePreference;
  /** Active provider id when visionSource is 'cloud'. */
  cloudProviderId: string;
  /** Per-provider key/model/baseUrl, stored on-device only. */
  providerConfigs: Record<string, StoredProviderConfig>;
  /** On-device model download/update bookkeeping. */
  localModel: LocalModelState;
}

export const DEFAULT_SETTINGS: AppSettings = {
  visionApiUrl: process.env.EXPO_PUBLIC_VISION_API_URL ?? '',
  captureIntervalSeconds: 5,
  muteCameraSounds: true,
  visionSource: process.env.EXPO_PUBLIC_VISION_API_URL ? 'backend' : 'demo',
  themePreference: 'system',
  cloudProviderId: 'gemini',
  providerConfigs: {},
  localModel: {
    modelId: 'smolvlm-256m',
    remoteVersion: '',
    downloadedVersion: '',
    lastUpdateCheckTs: 0,
  },
};

function parseProviderConfigs(raw: unknown): Record<string, StoredProviderConfig> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};
  const out: Record<string, StoredProviderConfig> = {};
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value !== 'object' || value === null) continue;
    const record = value as Record<string, unknown>;
    out[id] = {
      apiKey: typeof record.apiKey === 'string' ? record.apiKey : '',
      model: typeof record.model === 'string' ? record.model : '',
      baseUrl: typeof record.baseUrl === 'string' ? record.baseUrl : '',
    };
  }
  return out;
}

function parseLocalModel(raw: unknown): LocalModelState {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ...DEFAULT_SETTINGS.localModel };
  }
  const record = raw as Record<string, unknown>;
  return {
    modelId:
      typeof record.modelId === 'string' && record.modelId
        ? record.modelId
        : DEFAULT_SETTINGS.localModel.modelId,
    remoteVersion:
      typeof record.remoteVersion === 'string' ? record.remoteVersion : '',
    downloadedVersion:
      typeof record.downloadedVersion === 'string'
        ? record.downloadedVersion
        : '',
    lastUpdateCheckTs:
      typeof record.lastUpdateCheckTs === 'number' &&
      Number.isFinite(record.lastUpdateCheckTs)
        ? record.lastUpdateCheckTs
        : 0,
  };
}

/** Merges stored (untrusted) JSON over defaults. Pure — unit-tested. */
export function parseSettings(raw: unknown): AppSettings {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ...DEFAULT_SETTINGS };
  }
  const record = raw as Record<string, unknown>;
  return {
    visionApiUrl:
      typeof record.visionApiUrl === 'string'
        ? record.visionApiUrl.trim()
        : DEFAULT_SETTINGS.visionApiUrl,
    captureIntervalSeconds:
      typeof record.captureIntervalSeconds === 'number' &&
      Number.isFinite(record.captureIntervalSeconds)
        ? clampIntervalSeconds(record.captureIntervalSeconds)
        : DEFAULT_SETTINGS.captureIntervalSeconds,
    muteCameraSounds:
      typeof record.muteCameraSounds === 'boolean'
        ? record.muteCameraSounds
        : DEFAULT_SETTINGS.muteCameraSounds,
    visionSource:
      record.visionSource === 'backend' ||
      record.visionSource === 'cloud' ||
      record.visionSource === 'local' ||
      record.visionSource === 'demo'
        ? record.visionSource
        : // Older installs only had a backend URL — keep it active.
          typeof record.visionApiUrl === 'string' &&
            record.visionApiUrl.trim() !== ''
          ? 'backend'
          : DEFAULT_SETTINGS.visionSource,
    themePreference:
      record.themePreference === 'light' ||
      record.themePreference === 'dark' ||
      record.themePreference === 'system'
        ? record.themePreference
        : DEFAULT_SETTINGS.themePreference,
    cloudProviderId:
      typeof record.cloudProviderId === 'string' && record.cloudProviderId
        ? record.cloudProviderId
        : DEFAULT_SETTINGS.cloudProviderId,
    providerConfigs: parseProviderConfigs(record.providerConfigs),
    localModel: parseLocalModel(record.localModel),
  };
}

let current: AppSettings = { ...DEFAULT_SETTINGS };
let loadPromise: Promise<void> | null = null;
const listeners = new Set<(settings: AppSettings) => void>();

function notifySettings(): void {
  for (const listener of listeners) listener(current);
}

function settingsFile(): File {
  return new File(Paths.document, 'memory-lens-settings.json');
}

/** Current snapshot (defaults until loadSettings resolves). */
export function getSettings(): AppSettings {
  return current;
}

export function subscribeSettings(
  listener: (settings: AppSettings) => void,
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

async function loadFromDisk(): Promise<void> {
  try {
    const file = settingsFile();
    if (file.exists) {
      current = parseSettings(JSON.parse(await file.text()) as unknown);
    }
  } catch {
    current = { ...DEFAULT_SETTINGS };
  }
  // API keys live in the keystore, not the JSON. Hydrate them; a legacy
  // key still sitting in the JSON (pre-keystore installs) is migrated.
  try {
    for (const [id, config] of Object.entries(current.providerConfigs)) {
      const secure = await readProviderKey(id);
      if (secure) {
        config.apiKey = secure;
      } else if (config.apiKey) {
        await writeProviderKey(id, config.apiKey);
      }
    }
  } catch {
    // Keystore unavailable: keep the parsed settings, keys stay empty.
  }
  notifySettings();
}

/**
 * Reads stored settings once. Concurrent first callers share the same
 * load — a caller that arrives mid-load waits for the real settings
 * instead of settling for defaults — and subscribers are told when the
 * load lands, so screens mounted before it finished still converge.
 * Later calls return the live snapshot (saves included).
 */
export async function loadSettings(): Promise<AppSettings> {
  if (!loadPromise) loadPromise = loadFromDisk();
  await loadPromise;
  return current;
}

/**
 * Merges a patch, persists it, and notifies subscribers.
 * API keys go to the keystore only — the JSON on disk never contains
 * them. Throws when the settings file cannot be written, so callers can
 * say so instead of pretending the change was saved.
 */
export async function saveSettings(
  patch: Partial<AppSettings>,
): Promise<AppSettings> {
  current = parseSettings({ ...current, ...patch });
  for (const [id, config] of Object.entries(current.providerConfigs)) {
    await writeProviderKey(id, config.apiKey);
  }
  const onDisk: AppSettings = {
    ...current,
    providerConfigs: Object.fromEntries(
      Object.entries(current.providerConfigs).map(([id, config]) => [
        id,
        { ...config, apiKey: '' },
      ]),
    ),
  };
  const file = settingsFile();
  if (!file.exists) file.create();
  await file.write(JSON.stringify(onDisk, null, 2));
  notifySettings();
  return current;
}
