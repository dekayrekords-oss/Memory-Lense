// Capture interval bounds from the product spec:
// default 1 second, scalable up to 10 minutes (600 seconds).

export const MIN_INTERVAL_SECONDS = 1;
export const MAX_INTERVAL_SECONDS = 600;
export const DEFAULT_INTERVAL_SECONDS = 1;

/** Intervals offered in the UI. */
export const INTERVAL_PRESETS_SECONDS = [1, 5, 15, 30, 60, 300, 600];

export function clampIntervalSeconds(seconds: number): number {
  if (!Number.isFinite(seconds)) return DEFAULT_INTERVAL_SECONDS;
  return Math.min(
    MAX_INTERVAL_SECONDS,
    Math.max(MIN_INTERVAL_SECONDS, Math.round(seconds)),
  );
}

export function formatInterval(seconds: number): string {
  const s = clampIntervalSeconds(seconds);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rest = s % 60;
  return rest === 0 ? `${m}m` : `${m}m ${rest}s`;
}
