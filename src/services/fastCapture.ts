// Fast Capture core: watch a frame stream for sudden change and keep only
// the seconds around the event — not the whole stream.
//
// The trigger works on raw frame bytes (a cheap change heuristic that runs
// at stream rate on-device). Vision captions still come from the regular
// provider pipeline, applied to the trigger frame after the fact.

export interface TimedFrame<T> {
  ts: number;
  value: T;
}

/**
 * Mean absolute difference between two frames over evenly sampled bytes,
 * normalized to 0..1. JPEG bytes are nonlinear, so this is a change
 * heuristic, not an image diff — good enough to notice "something moved".
 */
export function byteChangeScore(
  prev: Uint8Array,
  next: Uint8Array,
  sampleCount = 512,
): number {
  if (prev.length === 0 || next.length === 0) return 0;
  const length = Math.max(prev.length, next.length);
  const samples = Math.min(sampleCount, length);
  let total = 0;
  for (let i = 0; i < samples; i += 1) {
    const index = Math.floor((i / samples) * length);
    const a = prev[Math.min(index, prev.length - 1)];
    const b = next[Math.min(index, next.length - 1)];
    total += Math.abs(a - b);
  }
  return total / samples / 255;
}

export interface FrameTriggerConfig {
  /** Change score (0..1) at or above which an event fires. */
  threshold: number;
  /** Minimum quiet time between events, so one motion = one clip. */
  cooldownMs: number;
}

export const DEFAULT_TRIGGER_CONFIG: FrameTriggerConfig = {
  threshold: 0.18,
  cooldownMs: 1500,
};

/** Stateful trigger: fires once per burst of change. */
export class FrameTrigger {
  private lastFiredAt = Number.NEGATIVE_INFINITY;

  constructor(private readonly config: FrameTriggerConfig) {}

  /** Returns true exactly when a new event should be recorded. */
  observe(score: number, ts: number): boolean {
    if (score < this.config.threshold) return false;
    if (ts - this.lastFiredAt < this.config.cooldownMs) return false;
    this.lastFiredAt = ts;
    return true;
  }

  reset(): void {
    this.lastFiredAt = Number.NEGATIVE_INFINITY;
  }
}

/**
 * Frames within [triggerTs - preMs, triggerTs + postMs], in time order.
 * Feed it the ring buffer contents once post-trigger frames have arrived.
 */
export function assembleClip<T>(
  frames: TimedFrame<T>[],
  triggerTs: number,
  preMs: number,
  postMs: number,
): TimedFrame<T>[] {
  return frames.filter(
    (f) => f.ts >= triggerTs - preMs && f.ts <= triggerTs + postMs,
  );
}

/**
 * Representative frames for clip upload: the whole clip when it fits,
 * otherwise the trigger frame first, then the pre/post edges, then an
 * even spread — always deduped and in time order.
 */
export function selectClipFrames<T>(
  clip: TimedFrame<T>[],
  triggerTs: number,
  maxFrames: number,
): TimedFrame<T>[] {
  if (clip.length === 0 || maxFrames < 1) return [];
  if (clip.length <= maxFrames) return [...clip];
  const ordered = [...clip].sort((a, b) => a.ts - b.ts);
  let triggerIndex = 0;
  for (let i = 1; i < ordered.length; i += 1) {
    if (
      Math.abs(ordered[i].ts - triggerTs) <
      Math.abs(ordered[triggerIndex].ts - triggerTs)
    ) {
      triggerIndex = i;
    }
  }
  // Priority order: trigger frame, pre/post edges, then an even spread.
  // The budget cut happens in priority order; the result is time-ordered.
  const candidates = [triggerIndex, 0, ordered.length - 1];
  for (let i = 1; i < ordered.length; i += 1) {
    candidates.push(Math.round((i / (maxFrames + 1)) * (ordered.length - 1)));
  }
  const picked: number[] = [];
  for (const index of candidates) {
    if (picked.length >= maxFrames) break;
    if (!picked.includes(index)) picked.push(index);
  }
  return picked.sort((a, b) => a - b).map((i) => ordered[i]);
}
