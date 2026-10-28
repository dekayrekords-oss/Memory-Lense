import { Directory, File, Paths } from 'expo-file-system';
import { clearPhotoUris, listEvents } from './memoryStore';
import {
  keptPhotoRefs,
  selectExpiredPhotos,
  selectPhotosToEvict,
} from './retention';

// Kept photos live in the app document directory. Everything else captured
// during a session is deleted after its text interpretation is stored.

/** Default cap on kept photos; oldest are evicted first. */
export const DEFAULT_MAX_KEPT_PHOTOS = 500;
/** Default photo lifetime; older photos are pruned to text-only memories. */
export const DEFAULT_MAX_PHOTO_AGE_MS = 30 * 24 * 60 * 60 * 1000;

function keptPhotosDir(): Directory {
  return new Directory(Paths.document, 'kept-photos');
}

function ensureKeptDir(): Directory {
  const dir = keptPhotosDir();
  if (!dir.exists) {
    try {
      dir.create();
    } catch {
      // Created concurrently or already present.
    }
  }
  return dir;
}

/** Copies a cache photo into the kept-photos directory. Returns its URI. */
export async function keepPhoto(cacheFileUri: string, ts: number): Promise<string> {
  const dir = ensureKeptDir();
  const dest = new File(dir, `memory-${ts}.jpg`);
  await new File(cacheFileUri).copy(dest);
  return dest.uri;
}

/** Deletes a photo file if it exists. Never throws. */
export function deletePhoto(uri: string): void {
  try {
    const file = new File(uri);
    if (file.exists) file.delete();
  } catch {
    // Already gone — deletion is best-effort by design.
  }
}

/**
 * Deletes the files for `uris` and detaches them from their memories (rows
 * stay as text-only). Returns the number of memories detached.
 */
export async function removeKeptPhotos(uris: string[]): Promise<number> {
  if (uris.length === 0) return 0;
  for (const uri of uris) deletePhoto(uri);
  return clearPhotoUris(uris);
}

/**
 * Enforces the kept-photo cap: evicts the oldest photos down to `maxCount`
 * and detaches them (memories stay as text). Returns the evicted URIs.
 */
export async function enforcePhotoQuota(
  maxCount: number = DEFAULT_MAX_KEPT_PHOTOS,
): Promise<string[]> {
  const refs = keptPhotoRefs(await listEvents(5000));
  const evict = selectPhotosToEvict(refs, maxCount);
  await removeKeptPhotos(evict);
  return evict;
}

/**
 * Prunes photos older than `maxAgeMs` and detaches them (memories stay as
 * text). Returns the pruned URIs.
 */
export async function pruneExpiredPhotos(
  maxAgeMs: number = DEFAULT_MAX_PHOTO_AGE_MS,
  now: number = Date.now(),
): Promise<string[]> {
  const refs = keptPhotoRefs(await listEvents(5000));
  const expired = selectExpiredPhotos(refs, now, maxAgeMs);
  await removeKeptPhotos(expired);
  return expired;
}
