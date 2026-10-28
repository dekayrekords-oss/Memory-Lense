import { describe, expect, it, jest } from '@jest/globals';
import { LocalRecap, parseRecap, recapWindow } from '../recap';
import {
  createVideoJobs,
  HttpVideoJobs,
  MAX_TIMELAPSE_ITEMS,
} from '../videoJobs';
import type { MemoryEvent } from '../types';

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-10-27T20:00:00').getTime();

function event(partial: Partial<MemoryEvent>): MemoryEvent {
  return {
    id: 1,
    ts: NOW,
    kind: 'scene',
    caption: '',
    objects: [],
    tags: [],
    photoUri: null,
    ...partial,
  };
}

describe('recapWindow', () => {
  const events = [
    event({ id: 1, ts: NOW - 2 * DAY, caption: 'old' }),
    event({ id: 2, ts: NOW - 60_000, caption: 'recent' }),
    event({ id: 3, ts: NOW - 6 * DAY, caption: 'this week' }),
  ];

  it('takes local-day events for day and 7d for week, oldest first', () => {
    expect(recapWindow(events, 'day', NOW).map((e) => e.id)).toEqual([2]);
    expect(recapWindow(events, 'week', NOW).map((e) => e.id)).toEqual([
      3, 1, 2,
    ]);
  });
});

describe('parseRecap', () => {
  it('parses strict recap JSON and caps highlights', () => {
    const recap = parseRecap({
      title: 'Your day',
      summary: 'Busy.',
      highlights: ['a', 'b'],
    });
    expect(recap.title).toBe('Your day');
    expect(recap.highlights).toEqual(['a', 'b']);
  });

  it('fails closed on garbage', () => {
    expect(() => parseRecap('nope')).toThrow();
    expect(() => parseRecap({ title: 'x' })).toThrow();
  });
});

describe('LocalRecap', () => {
  it('summarizes counts offline', async () => {
    const recap = await new LocalRecap(() => NOW).summarize(
      [
        event({ id: 1, ts: NOW, caption: 'Keys seen' }),
        event({ id: 2, ts: NOW, kind: 'audio', caption: 'buy milk' }),
      ],
      'day',
    );
    expect(recap.summary).toContain('2 memories');
    expect(recap.highlights).toContain('buy milk');
  });

  it('handles an empty window', async () => {
    const recap = await new LocalRecap().summarize([], 'week');
    expect(recap.summary).toContain('No memories');
  });
});

describe('HttpVideoJobs', () => {
  it('posts sorted timelapse items and returns videoBase64', async () => {
    const fetchMock = jest.fn(
      async (_url: string, _init?: unknown) =>
        ({
          ok: true,
          status: 200,
          json: async () => ({ videoBase64: 'AAAA' }),
        }) as unknown as Response,
    );
    const original = globalThis.fetch;
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    try {
      const jobs = new HttpVideoJobs('http://pc:8787/analyze');
      const out = await jobs.timelapse([
        { kind: 'image', base64: 'B', ts: 200 },
        { kind: 'video', base64: 'A', ts: 100 },
      ]);
      expect(out).toBe('AAAA');
      const [url, init] = fetchMock.mock.calls[0] as unknown as [
        string,
        { body: string },
      ];
      expect(url).toBe('http://pc:8787/timelapse');
      const body = JSON.parse(init.body) as { items: { ts: number }[] };
      expect(body.items.map((i) => i.ts)).toEqual([100, 200]);
    } finally {
      globalThis.fetch = original;
    }
  });

  it('validates counts and returns null unconfigured', async () => {
    const jobs = new HttpVideoJobs('http://pc:8787');
    await expect(jobs.cartoonMontage([])).rejects.toThrow(/at least one/);
    await expect(
      jobs.timelapse(
        Array.from({ length: MAX_TIMELAPSE_ITEMS + 1 }, (_, i) => ({
          kind: 'image' as const,
          base64: 'A',
          ts: i,
        })),
      ),
    ).rejects.toThrow(/at most/);
    expect(createVideoJobs('')).toBeNull();
  });
});
