import { File } from 'expo-file-system';

// Audio transcription client: POST {base}/transcribe { audioBase64,
// mimeType } -> { text }. Returns '' when no backend is configured —
// mic mode then keeps voice notes untranscribed (see micCapture.ts).

export interface Transcriber {
  transcribeFile(uri: string): Promise<string>;
}

async function readAudioBase64(uri: string): Promise<string> {
  return new File(uri).base64();
}

export class HttpTranscriber implements Transcriber {
  private readonly base: string;

  constructor(
    endpoint: string,
    private readonly readBase64: (
      uri: string,
    ) => Promise<string> = readAudioBase64,
  ) {
    this.base = endpoint.replace(/\/analyze\/?$/, '').replace(/\/+$/, '');
  }

  async transcribeFile(uri: string): Promise<string> {
    const audioBase64 = await this.readBase64(uri);
    const response = await fetch(`${this.base}/transcribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ audioBase64, mimeType: 'audio/m4a' }),
    });
    if (!response.ok) {
      throw new Error(`transcribe API failed: ${response.status}`);
    }
    const data = (await response.json()) as { text?: unknown };
    if (typeof data.text !== 'string') {
      throw new Error('transcribe response has no text');
    }
    return data.text;
  }
}

export function createTranscriber(
  endpoint: string = process.env.EXPO_PUBLIC_VISION_API_URL ?? '',
): Transcriber | null {
  if (!endpoint) return null;
  return new HttpTranscriber(endpoint);
}
