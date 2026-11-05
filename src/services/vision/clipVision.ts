import { backendAuthHeaders } from '../config';
import type { VisionResult } from '../types';
import { parseVisionResult } from './visionParse';

// Fast Capture clip client: sends the representative frames of one event
// clip to the backend for analysis across frames (what moved / happened).
//
//   POST {base}/analyze-clip { frames: [{ imageBase64, mimeType, tsOffsetMs }] }
//     -> VisionResult JSON (caption describes the event)
//
// The endpoint may point at /analyze — the clip route shares its base, the
// same convention as projectVision.ts. Without configuration there is no
// mock: the caller falls back to single-frame analysis, which already has
// an offline mock (MockVisionProvider).

export interface ClipFrameInput {
  imageBase64: string;
  mimeType?: string;
  /** Milliseconds since the first frame of the clip. */
  tsOffsetMs?: number;
}

/** Upper bound per request — clips are representative frames, not video. */
export const MAX_CLIP_FRAMES = 6;

export class HttpClipVision {
  private readonly base: string;

  constructor(endpoint: string) {
    this.base = endpoint.replace(/\/analyze\/?$/, '').replace(/\/+$/, '');
  }

  async analyzeClip(frames: ClipFrameInput[]): Promise<VisionResult> {
    if (!Array.isArray(frames) || frames.length === 0) {
      throw new Error('analyzeClip needs at least one frame');
    }
    if (frames.length > MAX_CLIP_FRAMES) {
      throw new Error(`analyzeClip sends at most ${MAX_CLIP_FRAMES} frames`);
    }
    const body = {
      frames: frames.map((f, i) => {
        if (typeof f?.imageBase64 !== 'string' || !f.imageBase64.trim()) {
          throw new Error(`clip frame ${i} has no imageBase64`);
        }
        return {
          imageBase64: f.imageBase64,
          mimeType:
            typeof f.mimeType === 'string' && f.mimeType
              ? f.mimeType
              : 'image/jpeg',
          tsOffsetMs:
            typeof f.tsOffsetMs === 'number' && Number.isFinite(f.tsOffsetMs)
              ? f.tsOffsetMs
              : 0,
        };
      }),
    };
    const response = await fetch(`${this.base}/analyze-clip`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...backendAuthHeaders() },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      throw new Error(`clip vision API failed: ${response.status}`);
    }
    return parseVisionResult(await response.json());
  }
}

export interface ClipVisionOptions {
  /** Full vision URL (may end in /analyze); overrides the env value. */
  endpoint?: string;
  /** Alias for endpoint. */
  baseUrl?: string;
}

/** HTTP client when a backend is configured, otherwise null (no mock). */
export function createClipVision(
  options: ClipVisionOptions = {},
): HttpClipVision | null {
  const endpoint =
    options.endpoint ??
    options.baseUrl ??
    process.env.EXPO_PUBLIC_VISION_API_URL ??
    '';
  if (!endpoint) return null;
  return new HttpClipVision(endpoint);
}
