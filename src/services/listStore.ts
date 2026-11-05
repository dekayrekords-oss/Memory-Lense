import * as SQLite from 'expo-sqlite';
import type { Scenario, ScenarioAlert } from './types';

// Durable watch list + trained objects, in the same SQLite file as
// memories. "Things to remember" must survive an app restart — a
// list that evaporates when the app closes reads as broken.

export interface TrainedObject {
  name: string;
  photoUris: string[];
}

/** Validates one stored scenario payload. Returns null when unusable. */
export function parseWatchItem(raw: unknown): Scenario | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const item = raw as Record<string, unknown>;
  if (typeof item.id !== 'string' || typeof item.label !== 'string') {
    return null;
  }
  switch (item.kind) {
    case 'remember-object':
      return typeof item.object === 'string'
        ? { id: item.id, kind: 'remember-object', object: item.object, label: item.label }
        : null;
    case 'exit-check':
      return typeof item.object === 'string'
        ? {
            id: item.id,
            kind: 'exit-check',
            object: item.object,
            label: item.label,
            windowMinutes:
              typeof item.windowMinutes === 'number' ? item.windowMinutes : 60,
          }
        : null;
    case 'requirement':
      return typeof item.requirement === 'string'
        ? {
            id: item.id,
            kind: 'requirement',
            requirement: item.requirement,
            label: item.label,
            windowMinutes:
              typeof item.windowMinutes === 'number' ? item.windowMinutes : 120,
          }
        : null;
    case 'checklist':
      return typeof item.title === 'string' && Array.isArray(item.items)
        ? {
            id: item.id,
            kind: 'checklist',
            title: item.title,
            label: item.label,
            items: item.items.filter(
              (i): i is string => typeof i === 'string',
            ),
          }
        : null;
    default:
      return null;
  }
}

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const db = await SQLite.openDatabaseAsync('memory-lens.db');
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS watch_items (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          payload TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS trained_photos (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          photo_uri TEXT NOT NULL,
          ts INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS store_meta (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS alerts (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          payload TEXT NOT NULL
        );
      `);
      return db;
    })();
  }
  return dbPromise;
}

/** Stored watch list, or null when nothing was ever saved. */
export async function loadWatchItems(): Promise<Scenario[] | null> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ payload: string }>(
    'SELECT payload FROM watch_items ORDER BY id ASC',
  );
  if (rows.length === 0) {
    // Null means "never saved" (keep defaults). Once the user has saved
    // anything — including an empty list — the saved list is the truth.
    const flag = await db.getAllAsync<{ value: string }>(
      "SELECT value FROM store_meta WHERE key = 'watch_initialized'",
    );
    return flag.length > 0 ? [] : null;
  }
  return rows
    .map((row) => {
      try {
        return parseWatchItem(JSON.parse(row.payload) as unknown);
      } catch {
        return null;
      }
    })
    .filter((s): s is Scenario => s !== null);
}

/** Replaces the stored watch list. Fire-and-forget safe. */
export async function saveWatchItems(items: Scenario[]): Promise<void> {
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      "INSERT OR REPLACE INTO store_meta (key, value) VALUES ('watch_initialized', '1')",
    );
    await db.runAsync('DELETE FROM watch_items');
    for (const item of items) {
      await db.runAsync(
        'INSERT INTO watch_items (payload) VALUES (?)',
        JSON.stringify(item),
      );
    }
  });
}

/** Trained objects with their reference photos, by name. */
export async function listTrainedObjects(): Promise<TrainedObject[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ name: string; photo_uri: string }>(
    'SELECT name, photo_uri FROM trained_photos ORDER BY ts ASC',
  );
  const byName = new Map<string, string[]>();
  for (const row of rows) {
    const list = byName.get(row.name) ?? [];
    list.push(row.photo_uri);
    byName.set(row.name, list);
  }
  return [...byName.entries()].map(([name, photoUris]) => ({
    name,
    photoUris,
  }));
}

export async function addTrainedPhoto(
  name: string,
  photoUri: string,
  ts: number,
): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    'INSERT INTO trained_photos (name, photo_uri, ts) VALUES (?, ?, ?)',
    name,
    photoUri,
    ts,
  );
}

/** Removes a trained object; returns its photo URIs for file cleanup. */
export async function removeTrainedObject(name: string): Promise<string[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ photo_uri: string }>(
    'SELECT photo_uri FROM trained_photos WHERE name = ?',
    name,
  );
  await db.runAsync('DELETE FROM trained_photos WHERE name = ?', name);
  return rows.map((r) => r.photo_uri);
}

/** Validates one stored alert payload. Returns null when unusable. */
export function parseAlertItem(raw: unknown): ScenarioAlert | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const item = raw as Record<string, unknown>;
  if (
    typeof item.id !== 'string' ||
    typeof item.ts !== 'number' ||
    typeof item.message !== 'string'
  ) {
    return null;
  }
  return { id: item.id, ts: item.ts, message: item.message };
}

/** Persisted scenario alerts (newest first as stored). */
export async function loadAlerts(): Promise<ScenarioAlert[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ payload: string }>(
    'SELECT payload FROM alerts ORDER BY id ASC',
  );
  return rows
    .map((row) => {
      try {
        return parseAlertItem(JSON.parse(row.payload) as unknown);
      } catch {
        return null;
      }
    })
    .filter((a): a is ScenarioAlert => a !== null);
}

export async function saveAlerts(alerts: ScenarioAlert[]): Promise<void> {
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    await db.runAsync('DELETE FROM alerts');
    for (const alert of alerts) {
      await db.runAsync(
        'INSERT INTO alerts (payload) VALUES (?)',
        JSON.stringify(alert),
      );
    }
  });
}
