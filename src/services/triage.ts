import type { MemoryEvent, PhotoAction, VisionResult } from './types';

// Photo management from the product spec:
// - important frames keep their photo as a callable memory
// - everything else is stored as a text interpretation and the photo deleted
// - duplicates are deleted without creating a new memory

export interface TriageConfig {
  /** Minimum importance (0..1) for a frame to count as important. */
  importanceThreshold: number;
  /** Two identical scenes inside this window are duplicates. */
  dedupeWindowMs: number;
}

export const DEFAULT_TRIAGE_CONFIG: TriageConfig = {
  importanceThreshold: 0.6,
  dedupeWindowMs: 120_000,
};

export interface TriageDecision {
  action: PhotoAction;
  reason: string;
}

export function normalizeName(name: string): string {
  const n = name.trim().toLowerCase().replace(/\s+/g, ' ');
  // Very small singular/plural normalizer for object lookup ("keys" ~ "key").
  if (n.length > 3 && n.endsWith('s')) return n.slice(0, -1);
  return n;
}

/** Stable signature of a scene: caption + sorted object names. */
export function sceneSignature(
  input: Pick<VisionResult, 'caption' | 'objects'>,
): string {
  const objects = input.objects
    .map((o) => normalizeName(o.name))
    .sort()
    .join(',');
  return `${input.caption.trim().toLowerCase()}|${objects}`;
}

export function decideTriage(
  result: VisionResult,
  recentEvents: MemoryEvent[],
  trackedObjects: string[],
  now: number,
  config: TriageConfig = DEFAULT_TRIAGE_CONFIG,
): TriageDecision {
  const signature = sceneSignature(result);
  const duplicate = recentEvents.some(
    (e) =>
      e.kind === 'scene' &&
      now - e.ts <= config.dedupeWindowMs &&
      sceneSignature(e) === signature,
  );
  if (duplicate) {
    return { action: 'delete', reason: 'duplicate scene' };
  }

  const tracked = new Set(trackedObjects.map(normalizeName));
  const seesTracked = result.objects.some((o) => tracked.has(normalizeName(o.name)));
  if (seesTracked) {
    return { action: 'keep', reason: 'tracked object in frame' };
  }

  if (result.importance >= config.importanceThreshold) {
    return { action: 'keep', reason: `importance ${result.importance.toFixed(2)}` };
  }

  return { action: 'text-only', reason: 'kept as text interpretation' };
}
