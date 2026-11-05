import { File } from 'expo-file-system';
import type { ProjectPlan, ProjectStep, StepCheck, VisionResult } from '../types';
import {
  askStepPrompt,
  buildCloudRequest,
  extractCloudText,
  PARSE_INSTRUCTIONS_PROMPT,
  stepCheckPrompt,
  VISION_PROMPT,
  type CloudConfig,
} from '../aiProviders';
import type { VisionProvider } from './provider';
import { parseVisionResult } from './visionParse';
import {
  parseProjectPlan,
  parseStepCheck,
  type ProjectVision,
} from './projectVision';

// Bring-your-own-key cloud vision: calls the user's chosen provider
// directly from the phone with their key. Model text is untrusted —
// everything goes through the strict parsers, same as the backend path.

type FetchFn = typeof fetch;
type ReadBase64 = (uri: string) => Promise<string>;

async function readPhotoBase64(uri: string): Promise<string> {
  return new File(uri).base64();
}

export async function cloudChat(
  config: CloudConfig,
  prompt: string,
  imageBase64: string | null,
  fetchFn: FetchFn = fetch,
): Promise<string> {
  const request = buildCloudRequest(config, prompt, imageBase64);
  const response = await fetchFn(request.url, {
    method: 'POST',
    headers: request.headers,
    body: JSON.stringify(request.body),
  });
  if (!response.ok) {
    throw new Error(
      `AI provider ${config.providerId} failed: HTTP ${response.status}. Check the API key and model name in Settings.`,
    );
  }
  return extractCloudText(config.kind, await response.json());
}

export class CloudVisionProvider implements VisionProvider {
  constructor(
    private readonly config: CloudConfig,
    private readonly fetchFn: FetchFn = fetch,
    private readonly readBase64: ReadBase64 = readPhotoBase64,
  ) {}

  async analyze(photoUri: string | null): Promise<VisionResult> {
    if (!photoUri) {
      throw new Error(
        'Live vision needs a real photo; simulated frames have no image bytes.',
      );
    }
    const imageBase64 = await this.readBase64(photoUri);
    const text = await cloudChat(
      this.config,
      VISION_PROMPT,
      imageBase64,
      this.fetchFn,
    );
    return parseVisionResult(text);
  }
}

export class CloudProjectVision implements ProjectVision {
  constructor(
    private readonly config: CloudConfig,
    private readonly fetchFn: FetchFn = fetch,
    private readonly readBase64: ReadBase64 = readPhotoBase64,
  ) {}

  private async imageChat(
    prompt: string,
    photoUri: string | null,
  ): Promise<string> {
    if (!photoUri) {
      throw new Error(
        'Live vision needs a real photo; simulated frames have no image bytes.',
      );
    }
    return cloudChat(
      this.config,
      prompt,
      await this.readBase64(photoUri),
      this.fetchFn,
    );
  }

  async parseInstructions(photoUri: string | null): Promise<ProjectPlan> {
    const text = await this.imageChat(PARSE_INSTRUCTIONS_PROMPT, photoUri);
    return parseProjectPlan(text);
  }

  async checkStep(
    photoUri: string | null,
    step: ProjectStep,
  ): Promise<StepCheck> {
    const text = await this.imageChat(
      stepCheckPrompt(step.title, step.instruction),
      photoUri,
    );
    return parseStepCheck(text);
  }

  async ask(question: string, step: ProjectStep): Promise<string> {
    const text = await cloudChat(
      this.config,
      askStepPrompt(question, step.title, step.instruction),
      null,
      this.fetchFn,
    );
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start === -1 || end <= start) {
      return text.trim();
    }
    const parsed = JSON.parse(text.slice(start, end + 1)) as {
      answer?: unknown;
    };
    return typeof parsed.answer === 'string' && parsed.answer.trim()
      ? parsed.answer.trim()
      : text.trim();
  }
}
