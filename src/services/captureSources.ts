import { Directory, File, Paths } from 'expo-file-system';
import type { CaptureSource } from './types';

// Every camera feeds the same pipeline through one seam: takePhoto().
// - phone: the device camera (see Memory screen)
// - glasses: Meta glasses have no public continuous-camera API for
//   third-party apps, so this polls a bridge endpoint that serves the
//   latest glasses frame over HTTP (companion app / wearable bridge).
// - robot: a third-person robot camera's snapshot endpoint (e.g.
//   http://robot:9000/frame.jpg) — same HTTP frame mechanism.
// - simulation: no frames at all; the mock vision provider scripts them.

export interface CaptureSourceAdapter {
  kind: CaptureSource;
  label: string;
  /** Cache file URI for the frame, or null when there is no file. */
  takePhoto: () => Promise<string | null>;
  /** Push-style sources (e.g. native Meta DAT) start/stop their feed. */
  start?: () => Promise<void>;
  stop?: () => Promise<void>;
}

const LABELS: Record<CaptureSource, string> = {
  phone: 'Phone camera',
  glasses: 'Glasses (generic bridge)',
  robot: 'Robot camera (3rd person)',
  simulation: 'Simulation',
  meta: 'Meta glasses (DAT)',
};

export function captureSourceLabel(kind: CaptureSource): string {
  return LABELS[kind];
}

export function createPhoneSource(
  takePhoto: () => Promise<string | null>,
): CaptureSourceAdapter {
  return { kind: 'phone', label: 'Phone camera', takePhoto };
}

export function createSimulationSource(): CaptureSourceAdapter {
  return {
    kind: 'simulation',
    label: 'Simulation',
    takePhoto: async () => null,
  };
}

export interface HttpFrameDeps {
  fetchFrame?: (url: string) => Promise<Uint8Array>;
  writeFrame?: (bytes: Uint8Array, ts: number) => Promise<string>;
}

async function fetchFrameBytes(url: string): Promise<Uint8Array> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`frame source failed: ${response.status} (${url})`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

async function writeFrameFile(bytes: Uint8Array, ts: number): Promise<string> {
  const dir = new Directory(Paths.cache, 'frames');
  if (!dir.exists) {
    try {
      dir.create();
    } catch {
      // Created concurrently or already present.
    }
  }
  const file = new File(dir, `frame-${ts}.jpg`);
  if (!file.exists) file.create();
  await file.write(bytes);
  return file.uri;
}

export function createHttpFrameSource(
  kind: 'glasses' | 'robot',
  url: string,
  deps: HttpFrameDeps = {},
): CaptureSourceAdapter {
  const fetchFrame = deps.fetchFrame ?? fetchFrameBytes;
  const writeFrame = deps.writeFrame ?? writeFrameFile;
  return {
    kind,
    label: captureSourceLabel(kind),
    takePhoto: async () => writeFrame(await fetchFrame(url), Date.now()),
  };
}
