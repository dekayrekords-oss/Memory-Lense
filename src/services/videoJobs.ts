// Server video jobs: cartoon montage (event photos -> cartoon MP4) and
// POV timelapse (project photos + video clips -> sped-up MP4).
//
//   POST {base}/cartoon-montage { frames: [{ imageBase64 }] } -> { videoBase64 }
//   POST {base}/timelapse { items: [{ kind, base64, ts }] } -> { videoBase64 }
//
// The server needs ffmpeg; without it (or without a backend) callers
// fall back to an in-app slideshow. Never throws "unavailable" —
// createVideoJobs returns null instead.

export interface TimelapseItem {
  kind: 'image' | 'video';
  base64: string;
  ts: number;
}

export interface VideoJobs {
  cartoonMontage(imageBase64List: string[]): Promise<string>;
  timelapse(items: TimelapseItem[]): Promise<string>;
}

export const MAX_MONTAGE_FRAMES = 24;
export const MAX_TIMELAPSE_ITEMS = 40;

function assertVideoBase64(raw: unknown): string {
  const record = (raw ?? {}) as Record<string, unknown>;
  if (typeof record.videoBase64 !== 'string' || !record.videoBase64) {
    throw new Error('video job response has no videoBase64');
  }
  return record.videoBase64;
}

export class HttpVideoJobs implements VideoJobs {
  private readonly base: string;

  constructor(endpoint: string) {
    this.base = endpoint.replace(/\/analyze\/?$/, '').replace(/\/+$/, '');
  }

  private async post(path: string, body: unknown): Promise<string> {
    const response = await fetch(`${this.base}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      throw new Error(`video API failed: ${response.status}`);
    }
    return assertVideoBase64(await response.json());
  }

  async cartoonMontage(imageBase64List: string[]): Promise<string> {
    if (imageBase64List.length === 0) {
      throw new Error('cartoon montage needs at least one image');
    }
    if (imageBase64List.length > MAX_MONTAGE_FRAMES) {
      throw new Error(`cartoon montage takes at most ${MAX_MONTAGE_FRAMES} images`);
    }
    return this.post('/cartoon-montage', {
      frames: imageBase64List.map((imageBase64) => ({ imageBase64 })),
    });
  }

  async timelapse(items: TimelapseItem[]): Promise<string> {
    if (items.length === 0) {
      throw new Error('timelapse needs at least one item');
    }
    if (items.length > MAX_TIMELAPSE_ITEMS) {
      throw new Error(`timelapse takes at most ${MAX_TIMELAPSE_ITEMS} items`);
    }
    const sorted = [...items].sort((a, b) => a.ts - b.ts);
    return this.post('/timelapse', { items: sorted });
  }
}

export function createVideoJobs(
  endpoint: string = process.env.EXPO_PUBLIC_VISION_API_URL ?? '',
): VideoJobs | null {
  if (!endpoint) return null;
  return new HttpVideoJobs(endpoint);
}

export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
