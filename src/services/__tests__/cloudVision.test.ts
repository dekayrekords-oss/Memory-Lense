import { describe, expect, it, jest } from '@jest/globals';
import type { CloudConfig } from '../aiProviders';
import { CloudProjectVision, CloudVisionProvider } from '../vision/cloudVision';

const CONFIG: CloudConfig = {
  providerId: 'openrouter',
  kind: 'openai-compatible',
  apiKey: 'sk-test',
  model: 'test-model',
  baseUrl: 'https://openrouter.ai/api/v1',
};

function fetchReturning(text: string, ok = true, status = 200) {
  return jest.fn(async () => ({
    ok,
    status,
    json: async () => ({ choices: [{ message: { content: text } }] }),
  })) as unknown as typeof fetch;
}

describe('CloudVisionProvider', () => {
  it('analyzes a real photo through the provider and parses strictly', async () => {
    const fetchFn = fetchReturning(
      JSON.stringify({
        caption: 'Keys on the table',
        objects: [{ name: 'keys', place: 'table', confidence: 0.9 }],
        tags: ['indoor'],
        importance: 0.7,
      }),
    );
    const vision = new CloudVisionProvider(CONFIG, fetchFn, async () => 'QUJD');
    const result = await vision.analyze('file:///photo.jpg');
    expect(result.caption).toBe('Keys on the table');
    expect(result.objects[0].name).toBe('keys');
  });

  it('rejects simulated frames and provider HTTP failures', async () => {
    const vision = new CloudVisionProvider(
      CONFIG,
      fetchReturning('x'),
      async () => 'QUJD',
    );
    await expect(vision.analyze(null)).rejects.toThrow(/real photo/);
    const failing = new CloudVisionProvider(
      CONFIG,
      fetchReturning('no', false, 401),
      async () => 'QUJD',
    );
    await expect(failing.analyze('file:///p.jpg')).rejects.toThrow(/401/);
  });

  it('fails closed on non-JSON model text', async () => {
    const vision = new CloudVisionProvider(
      CONFIG,
      fetchReturning('I see a cat, trust me'),
      async () => 'QUJD',
    );
    await expect(vision.analyze('file:///p.jpg')).rejects.toThrow();
  });
});

describe('CloudProjectVision', () => {
  it('parses a photographed instruction sheet into a plan', async () => {
    const fetchFn = fetchReturning(
      JSON.stringify({
        title: 'Shelf build',
        steps: [
          { title: 'Sort parts', parts: ['Panel x2'], instruction: 'Lay out panels.' },
          { title: 'Attach sides', parts: ['Screw x8'], instruction: 'Screw sides on.' },
        ],
      }),
    );
    const vision = new CloudProjectVision(CONFIG, fetchFn, async () => 'QUJD');
    const plan = await vision.parseInstructions('file:///sheet.jpg');
    expect(plan.title).toBe('Shelf build');
    expect(plan.steps).toHaveLength(2);
    await expect(vision.parseInstructions(null)).rejects.toThrow(/real photo/);
  });

  it('checks a step and answers questions', async () => {
    const checkFetch = fetchReturning(
      JSON.stringify({ verdict: 'mistake', detail: 'Leg is backwards.', confidence: 0.8 }),
    );
    const vision = new CloudProjectVision(CONFIG, checkFetch, async () => 'QUJD');
    const step = { title: 'Attach legs', parts: [], instruction: 'Screw legs in.' };
    const check = await vision.checkStep('file:///step.jpg', step);
    expect(check.verdict).toBe('mistake');

    const askFetch = fetchReturning(JSON.stringify({ answer: 'Use screw A.' }));
    const asker = new CloudProjectVision(CONFIG, askFetch, async () => 'QUJD');
    await expect(asker.ask('Which screw?', step)).resolves.toBe('Use screw A.');
  });
});
