import { describe, expect, it, jest } from '@jest/globals';
import {
  DAY_MS,
  fetchRemoteModelVersion,
  isUpdateAvailable,
  LOCAL_MODELS,
  localModelById,
  shouldCheckForUpdate,
} from '../localModel';

describe('local model catalog', () => {
  it('offers small downloadable vision models', () => {
    expect(LOCAL_MODELS.length).toBeGreaterThanOrEqual(2);
    for (const model of LOCAL_MODELS) {
      expect(model.approxSizeMB).toBeLessThan(1000);
      expect(model.files.length).toBeGreaterThanOrEqual(1);
      expect(model.repo).toContain('/');
    }
    expect(localModelById('nope').id).toBe(LOCAL_MODELS[0].id);
  });
});

describe('shouldCheckForUpdate (once a day)', () => {
  const now = 1_700_000_000_000;
  it('checks when never checked or a day has passed', () => {
    expect(shouldCheckForUpdate(0, now)).toBe(true);
    expect(shouldCheckForUpdate(now - DAY_MS, now)).toBe(true);
    expect(shouldCheckForUpdate(now - DAY_MS - 1, now)).toBe(true);
  });
  it('does not check twice in one day', () => {
    expect(shouldCheckForUpdate(now - 1000, now)).toBe(false);
    expect(shouldCheckForUpdate(now - DAY_MS + 1000, now)).toBe(false);
    expect(shouldCheckForUpdate(Number.NaN, now)).toBe(true);
  });
});

describe('isUpdateAvailable', () => {
  it('only when downloaded and remote differs', () => {
    expect(
      isUpdateAvailable({ remoteVersion: 'b', downloadedVersion: 'a' }),
    ).toBe(true);
    expect(
      isUpdateAvailable({ remoteVersion: 'a', downloadedVersion: 'a' }),
    ).toBe(false);
    expect(
      isUpdateAvailable({ remoteVersion: 'a', downloadedVersion: '' }),
    ).toBe(false);
  });
});

describe('fetchRemoteModelVersion', () => {
  it('reads the sha from the Hugging Face API', async () => {
    const fetchFn = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ sha: 'abc123' }),
    })) as unknown as typeof fetch;
    await expect(
      fetchRemoteModelVersion(LOCAL_MODELS[0], fetchFn),
    ).resolves.toBe('abc123');
  });

  it('throws on HTTP failure or a shapeless response', async () => {
    const bad = jest.fn(async () => ({
      ok: false,
      status: 503,
      json: async () => ({}),
    })) as unknown as typeof fetch;
    await expect(
      fetchRemoteModelVersion(LOCAL_MODELS[0], bad),
    ).rejects.toThrow(/503/);
    const shapeless = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({}),
    })) as unknown as typeof fetch;
    await expect(
      fetchRemoteModelVersion(LOCAL_MODELS[0], shapeless),
    ).rejects.toThrow(/no version/);
  });
});
