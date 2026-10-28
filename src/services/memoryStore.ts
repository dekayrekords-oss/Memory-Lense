import * as SQLite from 'expo-sqlite';
import type { MemoryEvent, SeenObject } from './types';

// Text-first memory store. Rows hold the AI interpretation; photo_uri is set
// only for memories important enough to keep the physical photo.

interface EventRow {
  id: number;
  ts: number;
  kind: string;
  caption: string;
  objects: string;
  tags: string;
  photo_uri: string | null;
  audio_uri?: string | null;
}

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const db = await SQLite.openDatabaseAsync('memory-lens.db');
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          ts INTEGER NOT NULL,
          kind TEXT NOT NULL,
          caption TEXT NOT NULL,
          objects TEXT NOT NULL,
          tags TEXT NOT NULL,
          photo_uri TEXT
        );
      `);
      // Mic memories: audio_uri added after the fact on older installs.
      try {
        await db.execAsync('ALTER TABLE events ADD COLUMN audio_uri TEXT');
      } catch {
        // Column already present.
      }
      return db;
    })();
  }
  return dbPromise;
}

function parseJson<T>(text: string, fallback: T): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

function rowToEvent(row: EventRow): MemoryEvent {
  return {
    id: row.id,
    ts: row.ts,
    kind:
      row.kind === 'privacy-stop'
        ? 'privacy-stop'
        : row.kind === 'audio'
          ? 'audio'
          : 'scene',
    caption: row.caption,
    objects: parseJson<SeenObject[]>(row.objects, []),
    tags: parseJson<string[]>(row.tags, []),
    photoUri: row.photo_uri,
    audioUri: row.audio_uri ?? null,
  };
}

export async function insertEvent(
  event: Omit<MemoryEvent, 'id'>,
): Promise<MemoryEvent> {
  const db = await getDb();
  const result = await db.runAsync(
    'INSERT INTO events (ts, kind, caption, objects, tags, photo_uri, audio_uri) VALUES (?, ?, ?, ?, ?, ?, ?)',
    event.ts,
    event.kind,
    event.caption,
    JSON.stringify(event.objects),
    JSON.stringify(event.tags),
    event.photoUri,
    event.audioUri ?? null,
  );
  return { ...event, id: result.lastInsertRowId };
}

/** Most recent events first. */
export async function listEvents(limit = 200): Promise<MemoryEvent[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<EventRow>(
    'SELECT * FROM events ORDER BY ts DESC LIMIT ?',
    limit,
  );
  return rows.map(rowToEvent);
}

/** Deletes rows by id. Used by day wipe; callers delete the photo files. */
export async function deleteEventsByIds(ids: number[]): Promise<number> {
  if (ids.length === 0) return 0;
  const db = await getDb();
  const placeholders = ids.map(() => '?').join(',');
  const result = await db.runAsync(
    `DELETE FROM events WHERE id IN (${placeholders})`,
    ...ids,
  );
  return result.changes;
}

/**
 * Detaches photos from their memories (rows stay as text-only). Used by
 * photo cleanup and per-photo delete; callers delete the photo files.
 */
export async function clearPhotoUris(uris: string[]): Promise<number> {
  if (uris.length === 0) return 0;
  const db = await getDb();
  const placeholders = uris.map(() => '?').join(',');
  const result = await db.runAsync(
    `UPDATE events SET photo_uri = NULL WHERE photo_uri IN (${placeholders})`,
    ...uris,
  );
  return result.changes;
}

/** Events that saw the given object, most recent first. */
export async function eventsSeeing(
  objectName: string,
  limit = 200,
): Promise<MemoryEvent[]> {
  const events = await listEvents(limit);
  const needle = objectName.trim().toLowerCase();
  return events.filter((e) =>
    e.objects.some((o) => o.name.trim().toLowerCase() === needle),
  );
}
