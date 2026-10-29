import { describe, expect, it } from '@jest/globals';
import {
  clampIntervalSeconds,
  DEFAULT_INTERVAL_SECONDS,
  MAX_INTERVAL_SECONDS,
  MIN_INTERVAL_SECONDS,
  pickPictureSize,
} from '../config';

describe('clampIntervalSeconds', () => {
  it('defaults to 1 second from the spec', () => {
    expect(DEFAULT_INTERVAL_SECONDS).toBe(1);
  });

  it('clamps below the minimum', () => {
    expect(clampIntervalSeconds(0)).toBe(MIN_INTERVAL_SECONDS);
  });

  it('clamps above the 10 minute maximum', () => {
    expect(clampIntervalSeconds(9999)).toBe(MAX_INTERVAL_SECONDS);
    expect(MAX_INTERVAL_SECONDS).toBe(600);
  });

  it('passes valid values through', () => {
    expect(clampIntervalSeconds(45)).toBe(45);
  });

  it('falls back to the default for non-finite input', () => {
    expect(clampIntervalSeconds(Number.NaN)).toBe(DEFAULT_INTERVAL_SECONDS);
  });
});

describe('pickPictureSize', () => {
  it('picks the smallest size that still reads text (≈720p floor)', () => {
    expect(
      pickPictureSize(['4032x3024', '1920x1080', '1280x720', '640x480']),
    ).toBe('1280x720');
  });

  it('takes the largest available when nothing reaches the floor', () => {
    expect(pickPictureSize(['640x480', '1024x768'])).toBe('1024x768');
  });

  it('returns undefined for no usable sizes', () => {
    expect(pickPictureSize([])).toBeUndefined();
    expect(pickPictureSize(['unknown'])).toBeUndefined();
  });
});
