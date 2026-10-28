import { describe, expect, it, jest } from '@jest/globals';
import type { ProjectStep } from '../types';
import {
  createProjectVision,
  HttpProjectVision,
  parseProjectPlan,
  parseStepCheck,
} from '../vision/projectVision';

function withoutHttpEnv(): string | undefined {
  const saved = process.env.EXPO_PUBLIC_VISION_API_URL;
  delete process.env.EXPO_PUBLIC_VISION_API_URL;
  return saved;
}

function restoreEnv(saved: string | undefined): void {
  if (saved === undefined) delete process.env.EXPO_PUBLIC_VISION_API_URL;
  else process.env.EXPO_PUBLIC_VISION_API_URL = saved;
}

const PLAN = {
  title: '  Desk build  ',
  steps: [
    {
      title: '  Unbox and sort every part ',
      parts: ['Table top x1', ' Leg x4 '],
      instruction: ' Lay every part on the floor. ',
    },
    { title: 'Attach the legs', instruction: 'Screw each leg in.' },
  ],
};

const STEP: ProjectStep = {
  title: 'Check the wiring',
  parts: ['Cable tray x1', 'Clip x4'],
  instruction: 'Red wire goes to the red terminal. Black to black.',
};

describe('parseProjectPlan', () => {
  it('accepts a clean plan object, trimming strings', () => {
    const plan = parseProjectPlan(PLAN);
    expect(plan.title).toBe('Desk build');
    expect(plan.steps).toHaveLength(2);
    expect(plan.steps[0]).toEqual({
      title: 'Unbox and sort every part',
      parts: ['Table top x1', 'Leg x4'],
      instruction: 'Lay every part on the floor.',
    });
  });

  it('defaults parts to [] when a step omits them', () => {
    const plan = parseProjectPlan(PLAN);
    expect(plan.steps[1].parts).toEqual([]);
    expect(plan.steps[1].instruction).toBe('Screw each leg in.');
  });

  it('extracts JSON from a markdown-fenced string', () => {
    const text = '```json\n' + JSON.stringify(PLAN) + '\n```';
    const plan = parseProjectPlan(text);
    expect(plan.title).toBe('Desk build');
    expect(plan.steps[1].title).toBe('Attach the legs');
  });

  it('throws on empty steps', () => {
    expect(() => parseProjectPlan({ title: 'Empty', steps: [] })).toThrow();
    expect(() => parseProjectPlan({ title: 'No steps' })).toThrow();
  });

  it('fails closed on garbage', () => {
    expect(() => parseProjectPlan('no json here at all')).toThrow();
    expect(() => parseProjectPlan(null)).toThrow();
    expect(() => parseProjectPlan(42)).toThrow();
    expect(() => parseProjectPlan({ steps: 'not-an-array' })).toThrow();
  });
});

describe('parseStepCheck', () => {
  it('accepts a clean verdict', () => {
    const check = parseStepCheck({
      verdict: 'complete',
      detail: '  Looks done. ',
      confidence: 0.92,
    });
    expect(check).toEqual({
      verdict: 'complete',
      detail: 'Looks done.',
      confidence: 0.92,
    });
  });

  it('extracts JSON from a fenced string', () => {
    const text =
      '```json\n' +
      JSON.stringify({ verdict: 'unclear', detail: 'Blurry', confidence: 0.3 }) +
      '\n```';
    expect(parseStepCheck(text).verdict).toBe('unclear');
  });

  it('clamps confidence into 0..1', () => {
    expect(
      parseStepCheck({ verdict: 'complete', confidence: 7 }).confidence,
    ).toBe(1);
    expect(
      parseStepCheck({ verdict: 'mistake', confidence: -2 }).confidence,
    ).toBe(0);
  });

  it('defaults detail to empty string and confidence to 0', () => {
    const check = parseStepCheck({ verdict: 'unclear' });
    expect(check.detail).toBe('');
    expect(check.confidence).toBe(0);
  });

  it('throws on a bad verdict', () => {
    expect(() => parseStepCheck({ verdict: 'done', confidence: 0.5 })).toThrow();
    expect(() => parseStepCheck({ confidence: 0.5 })).toThrow();
    expect(() => parseStepCheck({ verdict: 'COMPLETE' })).toThrow();
  });

  it('fails closed on garbage', () => {
    expect(() => parseStepCheck('no json here')).toThrow();
    expect(() => parseStepCheck(null)).toThrow();
  });
});

describe('Mock project vision (no env configured)', () => {
  it('returns the deterministic desk plan matching the stub steps', async () => {
    const saved = withoutHttpEnv();
    try {
      const vision = createProjectVision();
      const plan = await vision.parseInstructions(null);
      expect(plan.title.length).toBeGreaterThan(0);
      expect(plan.steps.map((s) => s.title)).toEqual([
        'Unbox and sort every part',
        'Attach the legs',
        'Check the wiring',
        'Stand it up and level it',
      ]);
      expect(plan.steps[0].parts).toEqual([
        'Table top x1',
        'Leg x4',
        'Screw pack A',
      ]);
      expect(plan.steps[0].instruction).toBe(
        'Lay every part on the floor. Count them against the sheet.',
      );
      expect(plan.steps[2].instruction).toBe(
        'Red wire goes to the red terminal. Black to black.',
      );
      for (const step of plan.steps) {
        expect(step.parts.length).toBeGreaterThan(0);
        expect(step.instruction.length).toBeGreaterThan(0);
      }
    } finally {
      restoreEnv(saved);
    }
  });

  it('returns a fresh plan copy on each call', async () => {
    const saved = withoutHttpEnv();
    try {
      const vision = createProjectVision();
      const first = await vision.parseInstructions(null);
      first.steps[0].title = 'mutated';
      const second = await vision.parseInstructions(null);
      expect(second.steps[0].title).toBe('Unbox and sort every part');
    } finally {
      restoreEnv(saved);
    }
  });

  it('cycles complete, mistake at the wiring step, complete, unclear, then complete', async () => {
    const saved = withoutHttpEnv();
    try {
      const vision = createProjectVision();
      const plan = await vision.parseInstructions(null);
      const wiring = plan.steps[2];
      expect(wiring.title).toBe('Check the wiring');

      const first = await vision.checkStep(null, plan.steps[0]);
      expect(first.verdict).toBe('complete');

      const mistake = await vision.checkStep(null, wiring);
      expect(mistake.verdict).toBe('mistake');
      expect(mistake.detail).toBe(
        'Red wire is on the black terminal — swap red to red, black to black.',
      );

      const fixed = await vision.checkStep(null, wiring);
      expect(fixed.verdict).toBe('complete');

      const unclear = await vision.checkStep(null, wiring);
      expect(unclear.verdict).toBe('unclear');
      expect(unclear.detail).toBe(
        'I cannot see the terminals — hold the phone closer.',
      );

      const after = await vision.checkStep(null, plan.steps[3]);
      expect(after.verdict).toBe('complete');
      const rest = await vision.checkStep(null, plan.steps[3]);
      expect(rest.verdict).toBe('complete');
    } finally {
      restoreEnv(saved);
    }
  });

  it('ask() returns a sentence built from the step instruction', async () => {
    const saved = withoutHttpEnv();
    try {
      const vision = createProjectVision();
      const answer = await vision.ask('Which wire goes where?', STEP);
      expect(answer).toContain(STEP.instruction);
      expect(answer.length).toBeGreaterThan(STEP.instruction.length);
    } finally {
      restoreEnv(saved);
    }
  });
});

describe('HttpProjectVision', () => {
  it('posts base64 to /parse-instructions with the /analyze suffix stripped', async () => {
    const fetchMock = jest.fn(
      async (_url: string, _init?: unknown) => ({
        ok: true,
        status: 200,
        json: async () => PLAN,
      }),
    );
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    try {
      const vision = new HttpProjectVision(
        'http://localhost:8787/analyze',
        async () => 'QUJD',
      );
      const plan = await vision.parseInstructions('file:///cache/sheet.jpg');
      expect(plan.title).toBe('Desk build');
      expect(plan.steps).toHaveLength(2);
      expect(fetchMock.mock.calls).toHaveLength(1);
      const [url, init] = fetchMock.mock.calls[0] as unknown as [
        string,
        { method: string; body: string },
      ];
      expect(url).toBe('http://localhost:8787/parse-instructions');
      expect(init.method).toBe('POST');
      const body = JSON.parse(init.body) as {
        imageBase64: string;
        mimeType: string;
      };
      expect(body.imageBase64).toBe('QUJD');
      expect(body.mimeType).toBe('image/jpeg');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('posts base64 and the step to /verify-step and clamps the verdict', async () => {
    const fetchMock = jest.fn(
      async (_url: string, _init?: unknown) => ({
        ok: true,
        status: 200,
        json: async () => ({
          verdict: 'mistake',
          detail: 'Red wire is on the black terminal',
          confidence: 7,
        }),
      }),
    );
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    try {
      const vision = new HttpProjectVision(
        'http://localhost:8787/analyze',
        async () => 'QUJD',
      );
      const check = await vision.checkStep('file:///cache/step.jpg', STEP);
      expect(check.verdict).toBe('mistake');
      expect(check.confidence).toBe(1);
      const [url, init] = fetchMock.mock.calls[0] as unknown as [
        string,
        { body: string },
      ];
      expect(url).toBe('http://localhost:8787/verify-step');
      const body = JSON.parse(init.body) as {
        imageBase64: string;
        step: ProjectStep;
      };
      expect(body.imageBase64).toBe('QUJD');
      expect(body.step).toEqual(STEP);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('posts question and step to /ask and returns the answer string', async () => {
    const fetchMock = jest.fn(
      async (_url: string, _init?: unknown) => ({
        ok: true,
        status: 200,
        json: async () => ({ answer: 'Use screw A here.' }),
      }),
    );
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    try {
      const vision = new HttpProjectVision(
        'http://localhost:8787',
        async () => 'QUJD',
      );
      const answer = await vision.ask('Which screw goes here?', STEP);
      expect(answer).toBe('Use screw A here.');
      const [url, init] = fetchMock.mock.calls[0] as unknown as [
        string,
        { body: string },
      ];
      expect(url).toBe('http://localhost:8787/ask');
      const body = JSON.parse(init.body) as {
        question: string;
        step: ProjectStep;
      };
      expect(body.question).toBe('Which screw goes here?');
      expect(body.step).toEqual(STEP);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('refuses simulated frames instead of sending an empty request', async () => {
    const fetchMock = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => PLAN,
    }));
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    try {
      const vision = new HttpProjectVision(
        'http://localhost:8787/analyze',
        async () => 'QUJD',
      );
      await expect(vision.parseInstructions(null)).rejects.toThrow();
      await expect(vision.checkStep(null, STEP)).rejects.toThrow();
      expect(fetchMock.mock.calls).toHaveLength(0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('fails closed when the endpoint returns an error status', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => ({
      ok: false,
      status: 503,
      json: async () => ({ error: 'VISION_API_KEY is not set' }),
    })) as unknown as typeof fetch;
    try {
      const vision = new HttpProjectVision(
        'http://localhost:8787/analyze',
        async () => 'QUJD',
      );
      await expect(
        vision.parseInstructions('file:///cache/sheet.jpg'),
      ).rejects.toThrow(/503/);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('fails closed when /ask returns no answer', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => ({
      ok: true,
      status: 200,
      json: async () => ({}),
    })) as unknown as typeof fetch;
    try {
      const vision = new HttpProjectVision(
        'http://localhost:8787',
        async () => 'QUJD',
      );
      await expect(vision.ask('Which screw?', STEP)).rejects.toThrow();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe('createProjectVision with HTTP configured', () => {
  it('posts base64 via the injected reader', async () => {
    const saved = process.env.EXPO_PUBLIC_VISION_API_URL;
    process.env.EXPO_PUBLIC_VISION_API_URL = 'http://localhost:8787/analyze';
    const fetchMock = jest.fn(
      async (_url: string, _init?: unknown) => ({
        ok: true,
        status: 200,
        json: async () => PLAN,
      }),
    );
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    try {
      const vision = createProjectVision({ readBase64: async () => 'QUJD' });
      const plan = await vision.parseInstructions('file:///cache/sheet.jpg');
      expect(plan.title).toBe('Desk build');
      const [url, init] = fetchMock.mock.calls[0] as unknown as [
        string,
        { body: string },
      ];
      expect(url).toBe('http://localhost:8787/parse-instructions');
      const body = JSON.parse(init.body) as { imageBase64: string };
      expect(body.imageBase64).toBe('QUJD');
    } finally {
      globalThis.fetch = originalFetch;
      restoreEnv(saved);
    }
  });

  it('throws on a simulated frame when HTTP is configured', async () => {
    const saved = process.env.EXPO_PUBLIC_VISION_API_URL;
    process.env.EXPO_PUBLIC_VISION_API_URL = 'http://localhost:8787/analyze';
    try {
      const vision = createProjectVision({ readBase64: async () => 'QUJD' });
      await expect(vision.parseInstructions(null)).rejects.toThrow();
      await expect(vision.checkStep(null, STEP)).rejects.toThrow();
    } finally {
      restoreEnv(saved);
    }
  });
});
