import { describe, expect, it, jest } from '@jest/globals';
import { HttpVisionProvider } from '../vision/provider';

const RESULT = {
  caption: 'Wallet on the couch',
  objects: [{ name: 'wallet', place: 'couch', confidence: 0.9 }],
  tags: ['indoor'],
  importance: 0.8,
};

describe('HttpVisionProvider', () => {
  it('uploads image bytes and returns the parsed result', async () => {
    const fetchMock = jest.fn(async (_url: string, _init?: unknown) => ({
      ok: true,
      status: 200,
      json: async () => RESULT,
    }));
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    try {
      const provider = new HttpVisionProvider(
        'http://localhost:8787/analyze',
        async () => 'QUJD', // base64 "ABC"
      );
      const result = await provider.analyze('file:///cache/photo.jpg');
      expect(result.caption).toBe('Wallet on the couch');
      const body = JSON.parse(
        (fetchMock.mock.calls[0][1] as { body: string }).body,
      ) as { imageBase64: string };
      expect(body.imageBase64).toBe('QUJD');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('refuses simulated frames instead of sending an empty request', async () => {
    const provider = new HttpVisionProvider('http://localhost:8787/analyze');
    await expect(provider.analyze(null)).rejects.toThrow();
  });

  it('fails closed when the endpoint returns an error status', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => ({
      ok: false,
      status: 503,
      json: async () => ({ error: 'VISION_API_KEY is not set' }),
    })) as unknown as typeof fetch;
    try {
      const provider = new HttpVisionProvider(
        'http://localhost:8787/analyze',
        async () => 'QUJD',
      );
      await expect(provider.analyze('file:///cache/photo.jpg')).rejects.toThrow(
        /503/,
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
