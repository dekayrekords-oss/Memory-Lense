// Meta Wearables Device Access Toolkit (DAT) — JS surface.
//
// Mirrors Meta's documented toolkit (wearables.developer.meta.com/docs/
// develop/dat, v1.0.1): core (registration, sessions, devices), camera
// (stream + photo capture), microphones & speakers, display, speech,
// inputs, motion, and device state. The native half lives in
// modules/meta-dat (Swift MWDATCore/MWDATCamera + Kotlin
// com.meta.wearable:mwdat-*) and needs a development build with a Meta
// wearables console app ID — it cannot run in Expo Go or in tests.
//
// Every method here has a typed entry point. When the native module is
// absent the service reports unavailable with a reason instead of
// throwing, so the UI can offer the generic bridge instead. Per Meta's
// docs, microphone/speech/inputs are experimental (dev builds only).

export type MetaPermission = 'camera' | 'microphone';
export type MetaPermissionStatus = 'granted' | 'denied' | 'undetermined';

export interface MetaDevice {
  id: string;
  name: string;
  kind: 'glasses' | 'mock';
}

export interface MetaStreamConfig {
  /** DAT supports 2, 7, 15, 24, or 30 FPS. */
  fps: 2 | 7 | 15 | 24 | 30;
  /** 360x640 / 504x896 / 720x1280 on both platforms. */
  resolution: 'low' | 'medium' | 'high';
}

export interface MetaCapturedPhoto {
  base64: string;
  mimeType: string;
}

export interface MetaDeviceState {
  batteryPercent: number | null;
  connected: boolean;
}

/** The 100% DAT module surface, per Meta's documentation index. */
export const DAT_MODULES = [
  'core',
  'camera',
  'microphone',
  'speakers',
  'display',
  'speech',
  'inputs',
  'motion',
  'deviceState',
] as const;
export type MetaModule = (typeof DAT_MODULES)[number];

/** Experimental per Meta docs — development builds only, not shippable. */
export const DAT_EXPERIMENTAL: MetaModule[] = [
  'microphone',
  'speech',
  'inputs',
];

export interface MetaNativeBridge {
  configure(): Promise<void>;
  startRegistration(): Promise<void>;
  checkPermission(kind: MetaPermission): Promise<MetaPermissionStatus>;
  /** Opens the Meta AI consent screen; resolves with the new status. */
  requestPermission(kind: MetaPermission): Promise<MetaPermissionStatus>;
  listDevices(): Promise<MetaDevice[]>;
  startSession(deviceId: string): Promise<{ deviceId: string }>;
  startCameraStream(
    config: MetaStreamConfig,
    onFrame: (bytes: Uint8Array) => void,
  ): Promise<void>;
  stopCameraStream(): Promise<void>;
  capturePhoto(): Promise<MetaCapturedPhoto>;
  showText(lines: string[]): Promise<void>;
  startSpeech(): Promise<void>;
  getDeviceState(): Promise<MetaDeviceState>;
}

export interface MetaStatus {
  available: boolean;
  reason: string | null;
  modules: MetaModule[];
  experimental: MetaModule[];
}

export function unavailableReason(): string {
  return (
    'Meta native module unavailable — use a development build with the ' +
    'Meta wearables console app configured (Expo Go cannot load it).'
  );
}

export interface MetaDatService {
  status(): Promise<MetaStatus>;
  /** Idempotent. Returns false when unavailable. */
  configure(): Promise<boolean>;
  register(): Promise<void>;
  checkPermission(kind: MetaPermission): Promise<MetaPermissionStatus>;
  requestPermission(kind: MetaPermission): Promise<MetaPermissionStatus>;
  listDevices(): Promise<MetaDevice[]>;
  connect(deviceId: string): Promise<void>;
  startCameraStream(
    config: MetaStreamConfig,
    onFrame: (bytes: Uint8Array) => void,
  ): Promise<void>;
  stopCameraStream(): Promise<void>;
  capturePhoto(): Promise<MetaCapturedPhoto>;
  showText(lines: string[]): Promise<void>;
  startSpeech(): Promise<void>;
  getDeviceState(): Promise<MetaDeviceState>;
}

function unavailableService(): MetaDatService {
  const reason = unavailableReason();
  const fail = async (): Promise<never> => {
    throw new Error(reason);
  };
  return {
    status: async () => ({
      available: false,
      reason,
      modules: [],
      experimental: DAT_EXPERIMENTAL,
    }),
    configure: async () => false,
    register: fail,
    checkPermission: fail,
    requestPermission: fail,
    listDevices: async () => [],
    connect: fail,
    startCameraStream: fail,
    stopCameraStream: async () => {},
    capturePhoto: fail,
    showText: fail,
    startSpeech: fail,
    getDeviceState: async () => ({ batteryPercent: null, connected: false }),
  };
}

/**
 * Builds the DAT service around a native bridge (tests inject a mock;
 * the app passes the real module or null). Never throws at build time.
 */
export function createMetaDat(
  bridge: MetaNativeBridge | null,
  options?: { appIdConfigured?: boolean },
): MetaDatService {
  if (!bridge) return unavailableService();
  let configured = false;
  return {
    status: async () => ({
      available: true,
      reason:
        options?.appIdConfigured === false
          ? 'No Meta App ID set: running in Developer Mode. In the Meta AI app (v290+) go to Settings > App Info, tap the app version 5 times, turn Developer Mode ON, then reopen this app and tap Register app, then Check Meta. Glasses firmware must be V128+. For a production build, add a Wearables Developer Center App ID in app.json (extra.metaDat.appId).'
          : null,
      modules: [...DAT_MODULES],
      experimental: DAT_EXPERIMENTAL,
    }),
    configure: async () => {
      // No App ID is NOT a blocker: the SDK treats an empty App ID as
      // Developer Mode. Registration then runs against glasses that
      // have Developer Mode switched on in the Meta AI app.
      if (!configured) {
        await bridge.configure();
        configured = true;
      }
      return true;
    },
    register: () => bridge.startRegistration(),
    checkPermission: (kind) => bridge.checkPermission(kind),
    requestPermission: async (kind) => {
      try {
        return await bridge.requestPermission(kind);
      } catch (error) {
        throw new Error(friendlyDatError(error));
      }
    },
    listDevices: () => bridge.listDevices(),
    connect: async (deviceId) => {
      try {
        await bridge.startSession(deviceId);
      } catch (error) {
        throw new Error(friendlyDatError(error));
      }
    },
    startCameraStream: async (config, onFrame) => {
      try {
        return await bridge.startCameraStream(config, onFrame);
      } catch (error) {
        throw new Error(friendlyDatError(error));
      }
    },
    stopCameraStream: () => bridge.stopCameraStream(),
    capturePhoto: () => bridge.capturePhoto(),
    showText: (lines) => bridge.showText(lines),
    startSpeech: () => bridge.startSpeech(),
    getDeviceState: () => bridge.getDeviceState(),
  };
}

/**
 * DAT failures arrive as raw native strings (e.g. a Kotlin error naming
 * NO_ELIGIBLE_DEVICE). Translate the ones a user can act on.
 */
export function friendlyDatError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const upper = raw.toUpperCase();
  if (
    upper.includes('NO_ELIGIBLE_DEVICE') ||
    upper.includes('NO ELIGIBLE DEVICE') ||
    upper.includes('DEVICE_NOT_FOUND')
  ) {
    return (
      'No Meta glasses are available for a session yet. Wear the glasses ' +
      'so they are on and connected. In the Meta AI app (v290+), go to ' +
      'Settings > App Info, tap the app version 5 times, and turn ' +
      'Developer Mode ON. Then reopen Memory Lens, tap Register app, ' +
      'then Check Meta. (A Meta Wearables Developer Center App ID is ' +
      'only needed for production builds.) DAT does not support ' +
      'non-Meta glasses.'
    );
  }
  if (
    upper.includes('UPDATE_REQUIRED') ||
    upper.includes('UPDATE REQUIRED')
  ) {
    return (
      'Your glasses need a software update before they can stream to ' +
      'apps. Open the Meta AI app, open your glasses settings, and ' +
      'install the firmware update (glasses in their case, charging, ' +
      'near the phone). Then come back and tap Meta again.'
    );
  }
  if (
    upper.includes('SESSION_ENDED_BY_DEVICE') ||
    upper.includes('DID NOT FINISH STARTING')
  ) {
    return (
      'The glasses ended the session. Keep them on, make sure the ' +
      'Meta AI app shows them connected, then tap Meta again.'
    );
  }
  if (upper.includes('ALREADY_INITIALIZED')) {
    return 'The Meta SDK was already initialized in this app process — try Check Meta again.';
  }
  if (
    upper.includes('PERMISSION') &&
    (upper.includes('DENIED') || upper.includes('NOT_GRANTED'))
  ) {
    return 'Camera permission for the Meta device was denied. Allow Memory Lens camera access in the Meta AI prompt (or Meta AI app permissions), then try again.';
  }
  if (upper.includes('NOT_CONFIGURED') || upper.includes('MISSING_APP_ID')) {
    return 'Meta app ID not configured. Create an app at the Meta Wearables Developer Center and set its ID in the app config (extra.metaDat.appId).';
  }
  return raw;
}

/** Lazy native resolution — the local module throws when absent. */
export function resolveMetaBridge(): MetaNativeBridge | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('../../modules/meta-dat') as {
      metaBridge?: MetaNativeBridge;
      default?: MetaNativeBridge;
    };
    return mod.metaBridge ?? mod.default ?? null;
  } catch {
    return null;
  }
}
