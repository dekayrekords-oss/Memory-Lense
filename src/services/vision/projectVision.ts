import { File } from 'expo-file-system';
import type { ProjectPlan, ProjectStep, StepCheck, StepVerdict } from '../types';

// Project-mode vision client: parses an instruction sheet into steps,
// checks a photographed step, and answers questions about a step.
//
// Model output is untrusted input. Parse strictly at the boundary like
// visionParse.ts does: a valid result comes out, or this throws — never
// pass raw model text downstream.
//
// Without configuration the app uses a deterministic offline mock so the
// guided-build flow works without keys. Set EXPO_PUBLIC_VISION_API_URL to
// the reference backend (see server/vision-server.mjs); it may point at
// the /analyze endpoint — the Project routes share its base:
//
//   POST {base}/parse-instructions { imageBase64, mimeType } -> ProjectPlan
//   POST {base}/verify-step        { imageBase64, mimeType, step } -> StepCheck
//   POST {base}/ask                { question, step } -> { answer }
//
// The model key stays server-side (VISION_API_KEY) — never in the app.

export interface ProjectVision {
  /** photoUri is null for simulated frames (no camera / no permission). */
  parseInstructions(photoUri: string | null): Promise<ProjectPlan>;
  checkStep(photoUri: string | null, step: ProjectStep): Promise<StepCheck>;
  ask(question: string, step: ProjectStep): Promise<string>;
}

type ReadBase64 = (uri: string) => Promise<string>;

function clamp01(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function extractObject(raw: unknown): Record<string, unknown> {
  let value: unknown = raw;
  if (typeof raw === 'string') {
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start === -1 || end <= start) {
      throw new Error('project vision response contains no JSON object');
    }
    value = JSON.parse(raw.slice(start, end + 1)) as unknown;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('project vision response is not a JSON object');
  }
  return value as Record<string, unknown>;
}

function parseParts(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((p): p is string => typeof p === 'string')
    .map((p) => p.trim())
    .filter(Boolean);
}

function parseStep(value: unknown): ProjectStep {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('project plan step is not an object');
  }
  const record = value as Record<string, unknown>;
  return {
    title: asString(record.title).trim(),
    parts: parseParts(record.parts),
    instruction: asString(record.instruction).trim(),
  };
}

/**
 * Normalizes a backend/model response (object or raw model text) into a
 * ProjectPlan. Throws when there is nothing interpretable to work with —
 * in particular a plan with no steps is never usable downstream.
 */
export function parseProjectPlan(raw: unknown): ProjectPlan {
  const record = extractObject(raw);
  if (!Array.isArray(record.steps) || record.steps.length === 0) {
    throw new Error('project plan has no steps');
  }
  return {
    title: asString(record.title).trim(),
    steps: record.steps.map(parseStep),
  };
}

const VERDICTS: readonly StepVerdict[] = ['complete', 'mistake', 'unclear'];

/**
 * Normalizes a backend/model response into a StepCheck. An unrecognized
 * verdict throws (fail closed) — never guess complete/mistake/unclear.
 */
export function parseStepCheck(raw: unknown): StepCheck {
  const record = extractObject(raw);
  if (
    typeof record.verdict !== 'string' ||
    !VERDICTS.includes(record.verdict as StepVerdict)
  ) {
    throw new Error('step check has an unrecognized verdict');
  }
  return {
    verdict: record.verdict as StepVerdict,
    detail: asString(record.detail).trim(),
    confidence: clamp01(record.confidence),
  };
}

function parseAnswer(raw: unknown): string {
  const record = extractObject(raw);
  const answer = asString(record.answer).trim();
  if (!answer) {
    throw new Error('project vision response has no answer');
  }
  return answer;
}

async function readPhotoBase64(uri: string): Promise<string> {
  return new File(uri).base64();
}

export class HttpProjectVision implements ProjectVision {
  private readonly base: string;

  constructor(
    endpoint: string,
    private readonly readBase64: ReadBase64 = readPhotoBase64,
  ) {
    this.base = endpoint.replace(/\/analyze\/?$/, '').replace(/\/+$/, '');
  }

  private async post(path: string, body: unknown): Promise<unknown> {
    const response = await fetch(`${this.base}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      throw new Error(`project vision API failed: ${response.status}`);
    }
    return response.json() as Promise<unknown>;
  }

  private async imageBody(photoUri: string | null): Promise<{
    imageBase64: string;
    mimeType: string;
  }> {
    if (!photoUri) {
      throw new Error(
        'Live vision needs a real photo; simulated frames have no image bytes.',
      );
    }
    return {
      imageBase64: await this.readBase64(photoUri),
      mimeType: 'image/jpeg',
    };
  }

  async parseInstructions(photoUri: string | null): Promise<ProjectPlan> {
    const body = await this.imageBody(photoUri);
    return parseProjectPlan(await this.post('/parse-instructions', body));
  }

  async checkStep(
    photoUri: string | null,
    step: ProjectStep,
  ): Promise<StepCheck> {
    const body = await this.imageBody(photoUri);
    return parseStepCheck(
      await this.post('/verify-step', { ...body, step }),
    );
  }

  async ask(question: string, step: ProjectStep): Promise<string> {
    return parseAnswer(await this.post('/ask', { question, step }));
  }
}

// Deterministic offline desk build, matching the stub steps in
// src/app/project.tsx. checkStep follows a fixed script so the demo
// exercises every verdict: a clean step, the classic red-wire-on-black
// mistake, a retry that passes, an unclear photo, then clean steps.
const MOCK_PLAN: ProjectPlan = {
  title: 'Desk build',
  steps: [
    {
      title: 'Unbox and sort every part',
      parts: ['Table top x1', 'Leg x4', 'Screw pack A'],
      instruction: 'Lay every part on the floor. Count them against the sheet.',
    },
    {
      title: 'Attach the legs',
      parts: ['Leg x4', 'Screw A x8'],
      instruction: 'Screw each leg into a corner bracket. Hand-tight only.',
    },
    {
      title: 'Check the wiring',
      parts: ['Cable tray x1', 'Clip x4'],
      instruction: 'Red wire goes to the red terminal. Black to black.',
    },
    {
      title: 'Stand it up and level it',
      parts: ['Foot pad x4'],
      instruction: 'Flip the desk over with a second person. Adjust the pads.',
    },
  ],
};

const MOCK_CHECKS: StepCheck[] = [
  { verdict: 'complete', detail: 'Step looks complete.', confidence: 0.95 },
  {
    verdict: 'mistake',
    detail:
      'Red wire is on the black terminal — swap red to red, black to black.',
    confidence: 0.88,
  },
  { verdict: 'complete', detail: 'Step looks complete.', confidence: 0.95 },
  {
    verdict: 'unclear',
    detail: 'I cannot see the terminals — hold the phone closer.',
    confidence: 0.35,
  },
];

const MOCK_COMPLETE: StepCheck = {
  verdict: 'complete',
  detail: 'Step looks complete.',
  confidence: 0.95,
};

export class MockProjectVision implements ProjectVision {
  private index = 0;

  async parseInstructions(
    _photoUri: string | null,
  ): Promise<ProjectPlan> {
    return {
      title: MOCK_PLAN.title,
      steps: MOCK_PLAN.steps.map((step) => ({
        ...step,
        parts: [...step.parts],
      })),
    };
  }

  async checkStep(
    _photoUri: string | null,
    _step: ProjectStep,
  ): Promise<StepCheck> {
    const check = MOCK_CHECKS[this.index] ?? MOCK_COMPLETE;
    this.index += 1;
    return { ...check };
  }

  async ask(_question: string, step: ProjectStep): Promise<string> {
    const instruction = step.instruction.trim();
    if (!instruction) {
      return `For the step "${step.title}", check the instruction sheet for details.`;
    }
    return `For the step "${step.title}": ${instruction}`;
  }
}

export interface ProjectVisionOptions {
  /** Full vision URL (may end in /analyze); overrides the env value. */
  endpoint?: string;
  /** Alias for endpoint. */
  baseUrl?: string;
  /** Photo reader override — tests inject a fake instead of the file system. */
  readBase64?: ReadBase64;
}

export function createProjectVision(
  options: ProjectVisionOptions = {},
): ProjectVision {
  const endpoint =
    options.endpoint ??
    options.baseUrl ??
    process.env.EXPO_PUBLIC_VISION_API_URL ??
    '';
  const base = endpoint.replace(/\/analyze\/?$/, '');
  if (base) return new HttpProjectVision(endpoint, options.readBase64);
  return new MockProjectVision();
}
