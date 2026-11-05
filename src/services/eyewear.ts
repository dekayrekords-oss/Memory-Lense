import { Directory, File, Paths } from 'expo-file-system';
import { PermissionsAndroid, Platform } from 'react-native';
import {
  captureSourceLabel,
  type CaptureSourceAdapter,
} from './captureSources';
import { isStreamUrl } from './frameStream';
import {
  createMetaDat,
  resolveMetaBridge,
  type MetaDatService,
} from './metaDAT';
import type { CaptureSource } from './types';

// Eyewear = any camera on your face. Three ways frames arrive, one
// pipeline behind them:
// - meta:     Meta Wearables DAT native stream (development build)
// - generic:  any smart glasses / IP camera behind an HTTP snapshot URL
//             or a ws:// binary frame stream ("standard generic glasses")
// - phone/robot/simulation stay as before (see captureSources.ts)

export type EyewearTransport = 'stream' | 'snapshot';

export interface EyewearProfile {
  id: 'meta' | 'generic' | 'robot' | 'simulation';
  label: string;
  transport: EyewearTransport;
}

export const GENERIC_PRESETS: { label: string; hint: string }[] = [
  {
    label: 'Generic glasses — stream',
    hint: 'ws://<glasses-or-bridge>:9000/frames (one JPEG per message)',
  },
  {
    label: 'Generic glasses — snapshot',
    hint: 'http://<glasses-or-bridge>:9000/frame.jpg (polled)',
  },
  {
    label: 'Robot camera',
    hint: 'Any snapshot or stream endpoint on the robot',
  },
];

export function profileForUrl(rawUrl: string): EyewearProfile {
  const stream = isStreamUrl(rawUrl);
  return {
    id: 'generic',
    label: stream
      ? 'Generic glasses (stream)'
      : 'Generic glasses (snapshot)',
    transport: stream ? 'stream' : 'snapshot',
  };
}

/** Priority order the UI offers: native Meta, generic bridge, simulation. */
export class EyewearProfileResolver {
  resolve(input: {
    metaAvailable: boolean;
    url: string;
  }): EyewearProfile[] {
    const profiles: EyewearProfile[] = [];
    if (input.metaAvailable) {
      profiles.push({ id: 'meta', label: 'Meta glasses (DAT)', transport: 'stream' });
    }
    profiles.push(profileForUrl(input.url));
    profiles.push({
      id: 'simulation',
      label: 'Simulation',
      transport: 'snapshot',
    });
    return profiles;
  }
}

export interface MetaFrameDeps {
  writeFrame?: (bytes: Uint8Array, ts: number) => Promise<string>;
  meta?: MetaDatService;
}

async function writeMetaFrame(bytes: Uint8Array, ts: number): Promise<string> {
  const dir = new Directory(Paths.cache, 'frames');
  if (!dir.exists) {
    try {
      dir.create();
    } catch {
      // Created concurrently or already present.
    }
  }
  const file = new File(dir, `meta-${ts}.jpg`);
  if (!file.exists) file.create();
  await file.write(bytes);
  return file.uri;
}

/**
 * DAT camera stream -> CaptureSourceAdapter. The toolkit pushes frames;
 * the capture engine pulls, so the adapter serves the freshest frame.
 */
export function createMetaFrameSource(
  meta: MetaDatService,
  deps: MetaFrameDeps = {},
): CaptureSourceAdapter & {
  start: () => Promise<void>;
  stop: () => Promise<void>;
} {
  const writeFrame = deps.writeFrame ?? writeMetaFrame;
  let latest: { bytes: Uint8Array; ts: number } | null = null;
  let started = false;
  return {
    kind: 'meta' as CaptureSource,
    label: captureSourceLabel('meta'),
    start: async () => {
      if (started) return;
      try {
        await meta.configure();
      // The native stream needs a device session first: connect to the
      // first registered glasses (the DAT auto-selector picks the pair).
      const devices = await meta.listDevices();
      await meta.connect(devices[0]?.id ?? '');
        // Glasses-side camera access is a separate DAT grant made in
        // the Meta AI app. Without it the stream starts then dies
        // with PERMISSIONS_DENIED and no frames ever arrive.
        let permission = await meta.checkPermission('camera');
        if (permission !== 'granted') {
          permission = await meta.requestPermission('camera');
        }
        if (permission !== 'granted') {
          throw new Error(
            'Meta glasses camera permission was not granted. In the ' +
              'Meta AI prompt, allow camera access for Memory Lens, ' +
              'then tap Meta again.',
          );
        }
        await meta.startCameraStream(
          { fps: 7, resolution: 'medium' },
          (bytes) => {
            latest = { bytes, ts: Date.now() };
          },
        );
        started = true;
      } catch (error) {
        // A failed start must stay retryable: pairing/app-ID fixes take
        // effect on the next tap, not after a force-close.
        started = false;
        throw error;
      }
    },
    stop: async () => {
      started = false;
      await meta.stopCameraStream().catch(() => {});
    },
    takePhoto: async () => {
      if (!latest) return null;
      // A frozen glasses feed must never pass an old frame off as "now".
      if (Date.now() - latest.ts > META_FRAME_MAX_AGE_MS) return null;
      const frame = latest;
      return writeFrame(frame.bytes, frame.ts);
    },
  };
}

export type EyewearPreviewState = 'live' | 'waiting' | 'stale';

/** A feed with no new frame for this long is shown as paused. */
export const PREVIEW_STALE_MS = 10_000;

/**
 * What the live glasses preview should say: nothing has arrived yet
 * (waiting), fresh frames are flowing (live), or the feed paused —
 * glasses taken off, asleep, or disconnected (stale).
 */
export function eyewearPreviewState(
  hasFrame: boolean,
  ageMs: number | null,
): EyewearPreviewState {
  if (!hasFrame || ageMs === null) return 'waiting';
  return ageMs > PREVIEW_STALE_MS ? 'stale' : 'live';
}

export const META_BLUETOOTH_PERMISSIONS = [
  'android.permission.BLUETOOTH_CONNECT',
  'android.permission.BLUETOOTH_SCAN',
] as const;

export type BluetoothPermissionRequester = (
  permissions: string[],
) => Promise<Record<string, boolean>>;

/**
 * Android 12+: the DAT SDK finds the glasses over BLE itself
 * (BluetoothDeviceDetection), and that provider never starts unless
 * these runtime permissions are granted to THIS app — createSession
 * then fails NO_ELIGIBLE_DEVICE even with the glasses registered,
 * connected in Meta AI, and Developer Mode on. Off-Android there is
 * nothing to request and this resolves true. The requester is
 * injectable so tests never touch the real permission dialog.
 */
export async function ensureMetaBluetoothPermissions(
  requester?: BluetoothPermissionRequester,
): Promise<boolean> {
  if (!requester && Platform.OS !== 'android') return true;
  const ask: BluetoothPermissionRequester =
    requester ??
    (async (permissions) => {
      const results = await PermissionsAndroid.requestMultiple(
        permissions as Parameters<
          typeof PermissionsAndroid.requestMultiple
        >[0],
      );
      return Object.fromEntries(
        permissions.map((permission) => [
          permission,
          results[permission as keyof typeof results] ===
            PermissionsAndroid.RESULTS.GRANTED,
        ]),
      );
    });
  const grants = await ask([...META_BLUETOOTH_PERMISSIONS]);
  return META_BLUETOOTH_PERMISSIONS.every(
    (permission) => grants[permission] === true,
  );
}

/** App-facing singleton: real native bridge when present, else seam. */
export const META_FRAME_MAX_AGE_MS = 15_000;

export function createEyewearMeta(): MetaDatService {
  let appIdConfigured = true;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Constants = require('expo-constants').default as {
      expoConfig?: { extra?: { metaDat?: { appId?: unknown } } } | null;
    };
    const appId = Constants.expoConfig?.extra?.metaDat?.appId;
    appIdConfigured = typeof appId === 'string' && appId.trim().length > 0;
  } catch {
    appIdConfigured = true;
  }
  return createMetaDat(resolveMetaBridge(), { appIdConfigured });
}
