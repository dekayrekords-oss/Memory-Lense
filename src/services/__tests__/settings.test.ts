import { describe, expect, it } from '@jest/globals';
import { DEFAULT_SETTINGS, parseSettings } from '../settings';

describe('parseSettings', () => {
  it('returns defaults for junk input', () => {
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings('nope')).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings([1, 2])).toEqual(DEFAULT_SETTINGS);
  });

  it('keeps valid stored values and trims the backend URL', () => {
    expect(
      parseSettings({
        visionApiUrl: '  http://192.168.1.20:8787/analyze  ',
        captureIntervalSeconds: 30,
        muteCameraSounds: false,
      }),
    ).toEqual({
      visionApiUrl: 'http://192.168.1.20:8787/analyze',
      captureIntervalSeconds: 30,
      muteCameraSounds: false,
    });
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
