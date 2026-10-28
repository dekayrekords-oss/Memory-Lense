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
): MetaDatService {
  if (!bridge) return unavailableService();
  let configured = false;
  return {
    status: async () => ({
      available: true,
      reason: null,
      modules: [...DAT_MODULES],
      experimental: DAT_EXPERIMENTAL,
    }),
    configure: async () => {
      if (!configured) {
        await bridge.configure();
        configured = true;
      }
      return true;
    },
    register: () => bridge.startRegistration(),
    checkPermission: (kind) => bridge.checkPermission(kind),
    listDevices: () => bridge.listDevices(),
    connect: async (deviceId) => {
      await bridge.startSession(deviceId);
    },
    startCameraStream: (config, onFrame) =>
      bridge.startCameraStream(config, onFrame),
    stopCameraStream: () => bridge.stopCameraStream(),
    capturePhoto: () => bridge.capturePhoto(),
    showText: (lines) => bridge.showText(lines),
    startSpeech: () => bridge.startSpeech(),
    getDeviceState: () => bridge.getDeviceState(),
  };
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
