import type { SeenObject, VisionResult } from '../types';

// Model output is untrusted input. Parse strictly at the boundary: a valid
// result comes out, or this throws — never pass raw model text downstream.

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
      throw new Error('vision response contains no JSON object');
    }
    value = JSON.parse(raw.slice(start, end + 1)) as unknown;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('vision response is not a JSON object');
  }
  return value as Record<string, unknown>;
}

function parseObjects(value: unknown): SeenObject[] {
  if (!Array.isArray(value)) return [];
  const objects: SeenObject[] = [];
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null) continue;
    const record = entry as Record<string, unknown>;
    const name = asString(record.name).trim();
    if (!name) continue;
    const place = asString(record.place).trim();
    objects.push({
      name,
      place: place ? place : null,
      confidence: clamp01(record.confidence),
    });
  }
  return objects;
}

function parseTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((t): t is string => typeof t === 'string')
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Normalizes a vision backend response (object or raw model text) into a
 * VisionResult. Throws when there is nothing interpretable to work with.
 */
export function parseVisionResult(raw: unknown): VisionResult {
  const record = extractObject(raw);
  return {
    caption: asString(record.caption).trim(),
    objects: parseObjects(record.objects),
    tags: parseTags(record.tags),
    importance: clamp01(record.importance),
  };
}
