import { File, Paths } from 'expo-file-system';
import { clampIntervalSeconds } from './config';

// App settings, editable from the Settings tab and persisted to a JSON
// file in the document directory. The vision backend URL is the big
// one: it turns the offline demo into real analysis (tracking, exit
// alerts, privacy screening) without a rebuild. EXPO_PUBLIC_* remains
// the seed default, never a requirement.

export interface AppSettings {
  /** Vision backend endpoint (…/analyze). Empty = offline demo vision. */
  visionApiUrl: string;
  /** Default photo interval for Memory mode on a fresh start. */
  captureIntervalSeconds: number;
  /** Silence the camera shutter/recording sounds. */
  muteCameraSounds: boolean;
}

export const DEFAULT_SETTINGS: AppSettings = {
  visionApiUrl: process.env.EXPO_PUBLIC_VISION_API_URL ?? '',
  captureIntervalSeconds: 5,
  muteCameraSounds: true,
};

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
  };
}

let current: AppSettings = { ...DEFAULT_SETTINGS };
let loaded = false;
const listeners = new Set<(settings: AppSettings) => void>();

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

/** Reads stored settings once; safe to call again (returns cache). */
export async function loadSettings(): Promise<AppSettings> {
  if (loaded) return current;
  loaded = true;
  try {
    const file = settingsFile();
    if (file.exists) {
      current = parseSettings(JSON.parse(await file.text()) as unknown);
    }
  } catch {
    current = { ...DEFAULT_SETTINGS };
  }
  return current;
}

/** Merges a patch, persists it, and notifies subscribers. */
export async function saveSettings(
  patch: Partial<AppSettings>,
): Promise<AppSettings> {
  current = parseSettings({ ...current, ...patch });
  try {
    const file = settingsFile();
    if (!file.exists) file.create();
    await file.write(JSON.stringify(current, null, 2));
  } catch {
    // Persistence is best-effort; the in-memory value still applies.
  }
  for (const listener of listeners) listener(current);
  return current;
}
