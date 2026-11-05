import { backendAuthHeaders } from './config';
import type { MemoryEvent } from './types';

// End-of-day / end-of-week recaps. The backend narrates from the text
// memories (POST /recap); offline, a deterministic summary counts what
// was seen and heard. Photos/audio never leave the text layer here —
// recaps are built from captions only.

export type RecapPeriod = 'day' | 'week';

export interface Recap {
  title: string;
  summary: string;
  highlights: string[];
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** Events inside the recap window, oldest first. */
export function recapWindow(
  events: MemoryEvent[],
  period: RecapPeriod,
  now: number,
): MemoryEvent[] {
  const sorted = [...events].sort((a, b) => a.ts - b.ts);
  if (period === 'week') {
    return sorted.filter((e) => now - e.ts <= WEEK_MS && e.ts <= now);
  }
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  return sorted.filter((e) => e.ts >= start.getTime() && e.ts <= now);
}

export function parseRecap(raw: unknown): Recap {
  let value: unknown = raw;
  if (typeof raw === 'string') {
    const s = raw.indexOf('{');
    const e = raw.lastIndexOf('}');
    if (s === -1 || e <= s) throw new Error('recap contains no JSON object');
    value = JSON.parse(raw.slice(s, e + 1)) as unknown;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('recap is not a JSON object');
  }
  const record = value as Record<string, unknown>;
  const title = typeof record.title === 'string' ? record.title.trim() : '';
  const summary =
    typeof record.summary === 'string' ? record.summary.trim() : '';
  if (!title || !summary) throw new Error('recap needs a title and summary');
  const highlights = (Array.isArray(record.highlights) ? record.highlights : [])
    .filter((h): h is string => typeof h === 'string')
    .map((h) => h.trim())
    .filter(Boolean)
    .slice(0, 8);
  return { title, summary, highlights };
}

export interface RecapService {
  summarize(events: MemoryEvent[], period: RecapPeriod): Promise<Recap>;
}

/** Deterministic offline recap from captions alone. */
export class LocalRecap implements RecapService {
  constructor(private readonly now: () => number = Date.now) {}

  async summarize(
    events: MemoryEvent[],
    period: RecapPeriod,
  ): Promise<Recap> {
    const now = this.now();
    const window = recapWindow(events, period, now);
    const title = period === 'day' ? 'Your day' : 'Your week';
    if (window.length === 0) {
      return {
        title,
        summary: `No memories recorded this ${period} yet.`,
        highlights: [],
      };
    }
    const scenes = window.filter((e) => e.kind === 'scene').length;
    const notes = window.filter((e) => e.kind === 'audio').length;
    const stops = window.filter((e) => e.kind === 'privacy-stop').length;
    const parts = [`${window.length} memories`];
    if (scenes) parts.push(`${scenes} scenes`);
    if (notes) parts.push(`${notes} voice memories`);
    if (stops) parts.push(`${stops} privacy stops`);
    const highlights = window.slice(-5).map((e) => e.caption);
    return {
      title,
      summary: `This ${period}: ${parts.join(', ')}.`,
      highlights,
    };
  }
}

export class HttpRecap implements RecapService {
  private readonly base: string;

  constructor(endpoint: string) {
    this.base = endpoint.replace(/\/analyze\/?$/, '').replace(/\/+$/, '');
  }

  async summarize(
    events: MemoryEvent[],
    period: RecapPeriod,
  ): Promise<Recap> {
    const window = recapWindow(events, period, Date.now());
    const response = await fetch(`${this.base}/recap`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...backendAuthHeaders() },
      body: JSON.stringify({
        period,
        events: window.slice(-120).map((e) => ({
          ts: e.ts,
          caption: e.caption,
          kind: e.kind,
        })),
      }),
    });
    if (!response.ok) {
      throw new Error(`recap API failed: ${response.status}`);
    }
    return parseRecap(await response.json());
  }
}

export function createRecap(
  endpoint: string = process.env.EXPO_PUBLIC_VISION_API_URL ?? '',
): RecapService {
  if (!endpoint) return new LocalRecap();
  return new HttpRecap(endpoint);
}
