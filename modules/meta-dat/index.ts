import { EventEmitter, requireNativeModule } from 'expo-modules-core';
import type {
  MetaCapturedPhoto,
  MetaDevice,
  MetaDeviceState,
  MetaNativeBridge,
  MetaPermission,
  MetaPermissionStatus,
  MetaStreamConfig,
} from '../../src/services/metaDAT';

// JS half of the MemoryLensMetaDat native module. The native halves
// (ios/MetaDatModule.swift, android MetaDatModule.kt) wrap Meta's
// Wearables DAT 1.0.1: MWDATCore/MWDATCamera on iOS (Swift Package
// github.com/facebook/meta-wearables-dat-ios) and
// com.meta.wearable:mwdat-* on Android (Maven Central).
//
// This file only loads inside a development build that includes the
// module; src/services/metaDAT.ts resolves it lazily and degrades to
// "unavailable" otherwise (Expo Go, tests).

interface NativeMetaDat {
  configure(): Promise<void>;
  startRegistration(): Promise<void>;
  checkPermission(kind: MetaPermission): Promise<MetaPermissionStatus>;
  listDevices(): Promise<MetaDevice[]>;
  startSession(deviceId: string): Promise<{ deviceId: string }>;
  startCameraStream(config: MetaStreamConfig): Promise<void>;
  stopCameraStream(): Promise<void>;
  capturePhoto(): Promise<MetaCapturedPhoto>;
  showText(lines: string[]): Promise<void>;
  startSpeech(): Promise<void>;
  getDeviceState(): Promise<MetaDeviceState>;
  addListener(event: string, listener: (event: unknown) => void): unknown;
  removeAllListeners?(event: string): void;
}

const nativeModule = requireNativeModule('MemoryLensMetaDat');
const native = nativeModule as unknown as NativeMetaDat;
const emitter = new EventEmitter(
  nativeModule,
) as unknown as {
  addListener(name: string, fn: (event: unknown) => void): { remove(): void };
  removeAllListeners(name: string): void;
};

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export const metaBridge: MetaNativeBridge = {
  configure: () => native.configure(),
  startRegistration: () => native.startRegistration(),
  checkPermission: (kind) => native.checkPermission(kind),
  listDevices: () => native.listDevices(),
  startSession: (deviceId) => native.startSession(deviceId),
  startCameraStream: async (config, onFrame) => {
    emitter.addListener('onCameraFrame', (event: unknown) => {
      const base64 = (event as { base64?: string }).base64;
      if (typeof base64 === 'string') onFrame(base64ToBytes(base64));
    });
    await native.startCameraStream(config);
  },
  stopCameraStream: async () => {
    emitter.removeAllListeners('onCameraFrame');
    await native.stopCameraStream();
  },
  capturePhoto: () => native.capturePhoto(),
  showText: (lines) => native.showText(lines),
  startSpeech: () => native.startSpeech(),
  getDeviceState: () => native.getDeviceState(),
};

export default metaBridge;
