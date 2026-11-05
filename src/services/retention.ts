import type { MemoryEvent } from './types';

// Retention controls: review what is kept, export text memories, wipe a
// day, and keep the kept-photo folder bounded. Pure selections live here
// so they are unit-testable; the store/filesystem wrappers do the I/O.

export interface PhotoRef {
  uri: string;
  ts: number;
}

/** Local midnight (start of day) for a timestamp, in epoch ms. */
export function dayStartMs(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Events that fall on the same local day as `dayTs`. */
export function eventsOnDay(events: MemoryEvent[], dayTs: number): MemoryEvent[] {
  const start = dayStartMs(dayTs);
  const end = start + 24 * 60 * 60 * 1000;
  return events.filter((e) => e.ts >= start && e.ts < end);
}

export interface WipeSelection {
  ids: number[];
  photoUris: string[];
  audioUris: string[];
}

/** Rows + photos to remove when wiping the day containing `dayTs`. */
export function wipeDaySelection(
  events: MemoryEvent[],
  dayTs: number,
): WipeSelection {
  const day = eventsOnDay(events, dayTs);
  return {
    ids: day.map((e) => e.id),
    photoUris: day
      .map((e) => e.photoUri)
      .filter((u): u is string => u !== null),
    audioUris: day
      .map((e) => e.audioUri)
      .filter((u): u is string => u !== null && u !== undefined),
  };
}

/** Kept photos referenced by memories, oldest first. */
export function keptPhotoRefs(events: MemoryEvent[]): PhotoRef[] {
  return events
    .filter((e) => e.photoUri !== null)
    .map((e) => ({ uri: e.photoUri as string, ts: e.ts }))
    .sort((a, b) => a.ts - b.ts);
}

/**
 * Oldest photos to evict so at most `maxCount` remain. Never evicts when
 * already within quota; eviction order is oldest first.
 */
export function selectPhotosToEvict(
  photos: PhotoRef[],
  maxCount: number,
): string[] {
  if (!Number.isFinite(maxCount) || photos.length <= maxCount) return [];
  const sorted = [...photos].sort((a, b) => a.ts - b.ts);
  return sorted.slice(0, sorted.length - Math.max(0, Math.floor(maxCount))).map(
    (p) => p.uri,
  );
}

/** Photos older than `maxAgeMs` relative to `now`, oldest first. */
export function selectExpiredPhotos(
  photos: PhotoRef[],
  now: number,
  maxAgeMs: number,
): string[] {
  if (!Number.isFinite(maxAgeMs) || maxAgeMs < 0) return [];
  return [...photos]
    .sort((a, b) => a.ts - b.ts)
    .filter((p) => now - p.ts > maxAgeMs)
    .map((p) => p.uri);
}

/** Plain-text export of memories, oldest first, one line per memory. */
export function exportMemoriesAsText(
  events: MemoryEvent[],
  formatTime: (ts: number) => string = (ts) => new Date(ts).toLocaleString(),
): string {
  const sorted = [...events].sort((a, b) => a.ts - b.ts);
  if (sorted.length === 0) return 'No memories yet.';
  return sorted
    .map((e) => {
      const kept =
        e.kind === 'privacy-stop'
          ? 'privacy stop, no photo kept'
          : e.kind === 'audio'
            ? e.audioUri
              ? 'audio kept'
              : 'text only'
            : e.photoUri
              ? 'photo kept'
              : 'text only';
      return `- [${formatTime(e.ts)}] ${e.caption} (${kept})`;
    })
    .join('\n');
}
