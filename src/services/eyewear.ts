import { Directory, File, Paths } from 'expo-file-system';
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
      started = true;
      await meta.configure();
      await meta.startCameraStream({ fps: 7, resolution: 'medium' }, (bytes) => {
        latest = { bytes, ts: Date.now() };
      });
    },
    stop: async () => {
      started = false;
      await meta.stopCameraStream().catch(() => {});
    },
    takePhoto: async () => {
      if (!latest) return null;
      const frame = latest;
      return writeFrame(frame.bytes, frame.ts);
    },
  };
}

/** App-facing singleton: real native bridge when present, else seam. */
export function createEyewearMeta(): MetaDatService {
  return createMetaDat(resolveMetaBridge());
}
