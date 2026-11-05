import { describe, expect, it, jest } from '@jest/globals';
import {
  createClipVision,
  HttpClipVision,
  MAX_CLIP_FRAMES,
  type ClipFrameInput,
} from '../vision/clipVision';

const FRAMES: ClipFrameInput[] = [
  { imageBase64: 'AAA', tsOffsetMs: 0 },
  { imageBase64: 'BBB', tsOffsetMs: 500 },
  { imageBase64: 'CCC', tsOffsetMs: 1500 },
];

function mockFetchOnce(json: unknown, ok = true, status = 200) {
  const fetchMock = jest.fn(
    async (_url: string, _init?: unknown) =>
      ({
        ok,
        status,
        json: async () => json,
      }) as unknown as Response,
  );
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  return {
    fetchMock,
    restore: () => {
      globalThis.fetch = originalFetch;
    },
  };
}

describe('HttpClipVision', () => {
  it('posts ordered frames to /analyze-clip and parses the event', async () => {
    const { fetchMock, restore } = mockFetchOnce({
      caption: 'Glass tipped off the table',
      objects: [{ name: 'glass', place: 'floor', confidence: 0.9 }],
      tags: ['indoor', 'kitchen'],
      importance: 0.95,
    });
    try {
      const vision = new HttpClipVision('http://localhost:8787/analyze');
      const result = await vision.analyzeClip(FRAMES);
      expect(result.caption).toBe('Glass tipped off the table');
      expect(result.objects).toHaveLength(1);
      expect(fetchMock.mock.calls).toHaveLength(1);
      const [url, init] = fetchMock.mock.calls[0] as unknown as [
        string,
        { method: string; body: string },
      ];
      expect(url).toBe('http://localhost:8787/analyze-clip');
      expect(init.method).toBe('POST');
      const body = JSON.parse(init.body) as {
        frames: { imageBase64: string; mimeType: string; tsOffsetMs: number }[];
      };
      expect(body.frames).toHaveLength(3);
      expect(body.frames[0]).toMatchObject({
        imageBase64: 'AAA',
        mimeType: 'image/jpeg',
        tsOffsetMs: 0,
      });
      expect(body.frames[2].tsOffsetMs).toBe(1500);
    } finally {
      restore();
    }
  });

  it('rejects empty, oversized, and blank-frame clips without calling fetch', async () => {
    const { fetchMock, restore } = mockFetchOnce({});
    try {
      const vision = new HttpClipVision('http://localhost:8787/analyze');
      await expect(vision.analyzeClip([])).rejects.toThrow(/at least one/);
      const tooMany = Array.from(
        { length: MAX_CLIP_FRAMES + 1 },
        (_, i) => ({ imageBase64: 'AAA', tsOffsetMs: i }) as ClipFrameInput,
      );
      await expect(vision.analyzeClip(tooMany)).rejects.toThrow(/at most/);
      await expect(
        vision.analyzeClip([{ imageBase64: '  ', tsOffsetMs: 0 }]),
      ).rejects.toThrow(/imageBase64/);
      expect(fetchMock.mock.calls).toHaveLength(0);
    } finally {
      restore();
    }
  });

  it('throws on HTTP errors and garbage responses', async () => {
    const failed = mockFetchOnce({ error: 'boom' }, false, 502);
    try {
      const vision = new HttpClipVision('http://localhost:8787/analyze');
      await expect(vision.analyzeClip(FRAMES)).rejects.toThrow(/502/);
    } finally {
      failed.restore();
    }
    const garbage = mockFetchOnce('not json at all {{{');
    try {
      const vision = new HttpClipVision('http://localhost:8787/analyze');
      await expect(vision.analyzeClip(FRAMES)).rejects.toThrow();
    } finally {
      garbage.restore();
    }
  });
});

describe('createClipVision', () => {
  it('returns null without configuration (caller falls back to one frame)', () => {
    const saved = process.env.EXPO_PUBLIC_VISION_API_URL;
    delete process.env.EXPO_PUBLIC_VISION_API_URL;
    try {
      expect(createClipVision()).toBeNull();
    } finally {
      if (saved !== undefined) process.env.EXPO_PUBLIC_VISION_API_URL = saved;
    }
  });

  it('builds an HTTP client from an explicit endpoint', () => {
    const vision = createClipVision({ endpoint: 'http://pc:8787/analyze' });
    expect(vision).toBeInstanceOf(HttpClipVision);
  });
});
