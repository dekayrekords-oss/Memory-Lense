import { describe, expect, it } from '@jest/globals';
import {
  clampIntervalSeconds,
  DEFAULT_INTERVAL_SECONDS,
  MAX_INTERVAL_SECONDS,
  MIN_INTERVAL_SECONDS,
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
