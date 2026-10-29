import { File } from 'expo-file-system';
import type { VisionResult } from '../types';
import { MockVisionProvider } from './mockProvider';
import { parseVisionResult } from './visionParse';

/**
 * Vision backend contract. Without configuration the app uses a
 * deterministic offline mock so every feature works without keys.
 *
 * Set EXPO_PUBLIC_VISION_API_URL to the reference backend (see
 * server/vision-server.mjs, `npm run server`) or any compatible endpoint.
 * The app uploads the photo as base64 — a server cannot read phone-local
 * file URIs:
 *
 *   POST { imageBase64, mimeType }  ->  VisionResult JSON
 *
 * The backend must flag restroom/nudity scenes in `tags`; the privacy gate
 * stops capture on them before anything is stored.
 */
export interface VisionProvider {
  /** photoUri is null for simulated frames (no camera / no permission). */
  analyze(photoUri: string | null): Promise<VisionResult>;
}

async function readPhotoBase64(uri: string): Promise<string> {
  return new File(uri).base64();
}

export class HttpVisionProvider implements VisionProvider {
  constructor(
    private readonly endpoint: string,
    private readonly readBase64: (
      uri: string,
    ) => Promise<string> = readPhotoBase64,
  ) {}

  async analyze(photoUri: string | null): Promise<VisionResult> {
    if (!photoUri) {
      throw new Error(
        'Live vision needs a real photo; simulated frames have no image bytes.',
      );
    }
    const imageBase64 = await this.readBase64(photoUri);
    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageBase64, mimeType: 'image/jpeg' }),
    });
    if (!response.ok) {
      throw new Error(`vision API failed: ${response.status}`);
    }
    return parseVisionResult(await response.json());
  }
}

export function createVisionProvider(
  endpoint: string = process.env.EXPO_PUBLIC_VISION_API_URL ?? '',
): VisionProvider {
  const url = endpoint.trim();
  if (url) return new HttpVisionProvider(url);
  return new MockVisionProvider();
}
