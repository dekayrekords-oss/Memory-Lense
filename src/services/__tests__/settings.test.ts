import { describe, expect, it } from '@jest/globals';
import { DEFAULT_SETTINGS, parseSettings } from '../settings';

describe('parseSettings', () => {
  it('returns defaults for junk input', () => {
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings('nope')).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings([1, 2])).toEqual(DEFAULT_SETTINGS);
  });

  it('keeps valid stored values and trims the backend URL', () => {
    const parsed = parseSettings({
      visionApiUrl: '  http://192.168.1.20:8787/analyze  ',
      captureIntervalSeconds: 30,
      muteCameraSounds: false,
    });
    expect(parsed.visionApiUrl).toBe('http://192.168.1.20:8787/analyze');
    expect(parsed.captureIntervalSeconds).toBe(30);
    expect(parsed.muteCameraSounds).toBe(false);
  });

  it('migrates a stored backend URL to the backend source', () => {
    expect(
      parseSettings({ visionApiUrl: 'http://192.168.1.20:8787/analyze' })
        .visionSource,
    ).toBe('backend');
    expect(parseSettings({ visionApiUrl: '' }).visionSource).toBe(
      DEFAULT_SETTINGS.visionSource,
    );
  });

  it('keeps provider configs and local model state, drops junk', () => {
    const parsed = parseSettings({
      visionSource: 'cloud',
      cloudProviderId: 'openrouter',
      providerConfigs: {
        openrouter: { apiKey: 'k', model: 'm', baseUrl: 'https://x' },
        broken: 'nope',
        partial: { apiKey: 42 },
      },
      localModel: {
        modelId: 'smolvlm-500m',
        remoteVersion: 'r1',
        downloadedVersion: 'd1',
        lastUpdateCheckTs: 123,
      },
    });
    expect(parsed.visionSource).toBe('cloud');
    expect(parsed.cloudProviderId).toBe('openrouter');
    expect(parsed.providerConfigs.openrouter).toEqual({
      apiKey: 'k',
      model: 'm',
      baseUrl: 'https://x',
    });
    expect(parsed.providerConfigs.broken).toBeUndefined();
    expect(parsed.providerConfigs.partial.apiKey).toBe('');
    expect(parsed.localModel).toEqual({
      modelId: 'smolvlm-500m',
      remoteVersion: 'r1',
      downloadedVersion: 'd1',
      lastUpdateCheckTs: 123,
    });
    expect(parseSettings({ visionSource: 'banana' }).visionSource).toBe(
      DEFAULT_SETTINGS.visionSource,
    );
    expect(parseSettings({ localModel: 'junk' }).localModel).toEqual(
      DEFAULT_SETTINGS.localModel,
    );
  });

  it('falls back per-field instead of failing wholesale', () => {
    const parsed = parseSettings({
      visionApiUrl: 42,
      captureIntervalSeconds: 'fast',
      muteCameraSounds: 'yes',
    });
    expect(parsed).toEqual(DEFAULT_SETTINGS);
  });

  it('clamps the capture interval into the supported range', () => {
    expect(parseSettings({ captureIntervalSeconds: 0 }).captureIntervalSeconds).toBe(1);
    expect(parseSettings({ captureIntervalSeconds: 99999 }).captureIntervalSeconds).toBe(600);
  });
});
