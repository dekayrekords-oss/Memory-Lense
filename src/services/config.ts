// Capture interval bounds from the product spec:
// default 1 second, scalable up to 10 minutes (600 seconds).

export const MIN_INTERVAL_SECONDS = 1;
export const MAX_INTERVAL_SECONDS = 600;
export const DEFAULT_INTERVAL_SECONDS = 1;

/** Intervals offered in the UI. */
export const INTERVAL_PRESETS_SECONDS = [1, 2, 3, 5, 15, 30, 60, 300, 600];

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

// Photo size for analysis: the smallest the camera offers that still
// carries readable text and detail for a vision model (≈720p). Smaller
// is not cheaper in any way that matters once the model can't read the
// frame. When nothing reaches the floor, take the largest available.
export const MIN_ANALYZABLE_WIDTH = 1280;
export const MIN_ANALYZABLE_HEIGHT = 720;

export function pickPictureSize(sizes: string[]): string | undefined {
  const parsed = sizes
    .map((raw) => {
      const [w, h] = raw.split('x').map((v) => parseInt(v, 10));
      return { raw, w, h, area: (w || 0) * (h || 0) };
    })
    .filter((s) => Number.isFinite(s.w) && Number.isFinite(s.h) && s.area > 0);
  if (parsed.length === 0) return undefined;
  const adequate = parsed.filter(
    (s) => s.w >= MIN_ANALYZABLE_WIDTH && s.h >= MIN_ANALYZABLE_HEIGHT,
  );
  const pool =
    adequate.length > 0
      ? adequate.sort((a, b) => a.area - b.area)
      : parsed.sort((a, b) => b.area - a.area);
  return pool[0].raw;
}

/**
 * Headers for the self-hosted vision backend. When the server is started
 * with MEMORY_LENS_TOKEN, the app must send the matching token; set it
 * via EXPO_PUBLIC_VISION_TOKEN at build time.
 */
export function backendAuthHeaders(): Record<string, string> {
  const token = process.env.EXPO_PUBLIC_VISION_TOKEN ?? '';
  return token ? { 'x-memory-lens-token': token } : {};
}
