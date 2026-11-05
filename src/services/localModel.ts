import { Directory, File, Paths } from 'expo-file-system';
import { getSettings, loadSettings, saveSettings } from './settings';

// On-device vision model management.
//
// The smallest usable vision-language models (SmolVLM class) are a few
// hundred MB — too big to bake into the app binary, so the app downloads
// one to the phone on demand and keeps it up to date: an automatic check
// runs at most once a day when the app opens, plus a manual button.
//
// Honest limit: running a VLM on-device needs a native inference runtime
// (llama.cpp-style) that this Expo build does not ship yet. Downloaded
// models are staged on the phone; until the runtime lands, real-photo
// analysis uses the cloud key / backend chosen in Settings. The UI says
// exactly this next to the model.

export interface LocalModelDef {
  id: string;
  name: string;
  /** Hugging Face repo holding GGUF weights. */
  repo: string;
  /** Files to download from the repo. */
  files: string[];
  approxSizeMB: number;
  blurb: string;
}

export const LOCAL_MODELS: LocalModelDef[] = [
  {
    id: 'smolvlm-256m',
    name: 'SmolVLM-256M Instruct',
    repo: 'ggml-org/SmolVLM-256M-Instruct-GGUF',
    files: [
      'SmolVLM-256M-Instruct-Q8_0.gguf',
      'mmproj-SmolVLM-256M-Instruct-Q8_0.gguf',
    ],
    approxSizeMB: 300,
    blurb: 'Smallest SmolVLM — reads scenes, labels, and short text.',
  },
  {
    id: 'smolvlm-500m',
    name: 'SmolVLM-500M Instruct',
    repo: 'ggml-org/SmolVLM-500M-Instruct-GGUF',
    files: [
      'SmolVLM-500M-Instruct-Q8_0.gguf',
      'mmproj-SmolVLM-500M-Instruct-Q8_0.gguf',
    ],
    approxSizeMB: 550,
    blurb: 'Better detail and text reading; bigger download.',
  },
];

export function localModelById(id: string): LocalModelDef {
  return LOCAL_MODELS.find((m) => m.id === id) ?? LOCAL_MODELS[0];
}

export const DAY_MS = 24 * 60 * 60 * 1000;

/** The once-a-day rule: check when never checked or ≥24h ago. Pure. */
export function shouldCheckForUpdate(
  lastCheckTs: number,
  now: number,
): boolean {
  return !Number.isFinite(lastCheckTs) || lastCheckTs <= 0 || now - lastCheckTs >= DAY_MS;
}

/** True when a downloaded copy exists and a newer remote version is known. */
export function isUpdateAvailable(state: {
  remoteVersion: string;
  downloadedVersion: string;
}): boolean {
  return (
    state.downloadedVersion !== '' &&
    state.remoteVersion !== '' &&
    state.remoteVersion !== state.downloadedVersion
  );
}

type FetchFn = typeof fetch;

/** Latest version = the repo's current commit sha on Hugging Face. */
export async function fetchRemoteModelVersion(
  def: LocalModelDef,
  fetchFn: FetchFn = fetch,
): Promise<string> {
  const response = await fetchFn(
    `https://huggingface.co/api/models/${def.repo}`,
  );
  if (!response.ok) {
    throw new Error(`model update check failed: HTTP ${response.status}`);
  }
  const json = (await response.json()) as { sha?: unknown };
  if (typeof json.sha !== 'string' || !json.sha) {
    throw new Error('model update check returned no version');
  }
  return json.sha;
}

function modelDir(def: LocalModelDef): Directory {
  return new Directory(Paths.document, 'local-models', def.id);
}

export function downloadedModelFiles(def: LocalModelDef): File[] {
  const dir = modelDir(def);
  return def.files.map((name) => new File(dir, name));
}

export function isModelDownloaded(def: LocalModelDef): boolean {
  // Existence is not enough: an interrupted 300MB download leaves a
  // truncated file that must never be reported as ready.
  return downloadedModelFiles(def).every(
    (f) => f.exists && (f.size ?? 0) >= MIN_MODEL_FILE_BYTES,
  );
}

export const MIN_MODEL_FILE_BYTES = 1_000_000;

/** Downloads (or re-downloads) every weight file. Large — Wi-Fi advised. */
export async function downloadLocalModel(def: LocalModelDef): Promise<void> {
  const dir = modelDir(def);
  if (!dir.exists) {
    try {
      dir.create({ intermediates: true });
    } catch {
      // Already present.
    }
  }
  for (const name of def.files) {
    const url = `https://huggingface.co/${def.repo}/resolve/main/${name}`;
    await File.downloadFileAsync(url, new File(dir, name), {
      idempotent: true,
    });
  }
}

export function deleteLocalModel(def: LocalModelDef): void {
  for (const file of downloadedModelFiles(def)) {
    try {
      if (file.exists) file.delete();
    } catch {
      // Best-effort cleanup.
    }
  }
}

export interface ModelUpdateCheck {
  remoteVersion: string;
  updateAvailable: boolean;
  checkedAt: number;
}

/**
 * Runs an update check now and records it (so the automatic daily check
 * will not repeat today). Throws on network failure.
 */
export async function checkLocalModelUpdate(
  fetchFn: FetchFn = fetch,
): Promise<ModelUpdateCheck> {
  const settings = await loadSettings();
  const def = localModelById(settings.localModel.modelId);
  const remoteVersion = await fetchRemoteModelVersion(def, fetchFn);
  const now = Date.now();
  const next = await saveSettings({
    localModel: {
      ...settings.localModel,
      remoteVersion,
      lastUpdateCheckTs: now,
    },
  });
  return {
    remoteVersion,
    updateAvailable: isUpdateAvailable(next.localModel),
    checkedAt: now,
  };
}

/**
 * Automatic check on app open — at most once a day, silent on failure.
 * Returns the check when it ran, null when skipped or failed.
 */
export async function maybeCheckLocalModelUpdate(
  fetchFn: FetchFn = fetch,
  now: number = Date.now(),
): Promise<ModelUpdateCheck | null> {
  try {
    const settings = await loadSettings();
    if (!shouldCheckForUpdate(settings.localModel.lastUpdateCheckTs, now)) {
      return null;
    }
    return await checkLocalModelUpdate(fetchFn);
  } catch {
    return null;
  }
}

/** Marks the currently downloaded files as at `version` after a download. */
export async function markModelDownloaded(version: string): Promise<void> {
  const settings = getSettings();
  await saveSettings({
    localModel: {
      ...settings.localModel,
      downloadedVersion: version,
      remoteVersion: version || settings.localModel.remoteVersion,
    },
  });
}
