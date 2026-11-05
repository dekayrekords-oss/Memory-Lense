import { describe, expect, it } from '@jest/globals';
import {
  assembleClip,
  byteChangeScore,
  FrameTrigger,
  selectClipFrames,
  type TimedFrame,
} from '../fastCapture';

describe('byteChangeScore', () => {
  it('is 0 for identical frames and grows with difference', () => {
    const a = new Uint8Array([10, 20, 30, 40]);
    expect(byteChangeScore(a, new Uint8Array([10, 20, 30, 40]))).toBe(0);
    const changed = byteChangeScore(a, new Uint8Array([250, 20, 30, 40]));
    expect(changed).toBeGreaterThan(0.2);
    expect(changed).toBeLessThanOrEqual(1);
  });

  it('handles empty and different-length frames', () => {
    expect(byteChangeScore(new Uint8Array(), new Uint8Array([1]))).toBe(0);
    const score = byteChangeScore(
      new Uint8Array([0, 0]),
      new Uint8Array([255, 255, 255, 255]),
    );
    expect(score).toBeGreaterThan(0.9);
  });
});

describe('FrameTrigger', () => {
  it('fires on a spike above threshold, then cools down', () => {
    const trigger = new FrameTrigger({ threshold: 0.2, cooldownMs: 1000 });
    expect(trigger.observe(0.1, 0)).toBe(false);
    expect(trigger.observe(0.5, 100)).toBe(true);
    expect(trigger.observe(0.9, 500)).toBe(false); // still cooling down
    expect(trigger.observe(0.9, 1200)).toBe(true);
  });

  it('never fires below threshold', () => {
    const trigger = new FrameTrigger({ threshold: 0.5, cooldownMs: 0 });
    expect(trigger.observe(0.49, 0)).toBe(false);
    expect(trigger.observe(0.1, 10_000)).toBe(false);
  });
});

describe('assembleClip', () => {
  const frames: TimedFrame<string>[] = [
    { ts: 0, value: 'a' },
    { ts: 100, value: 'b' },
    { ts: 200, value: 'c' },
    { ts: 300, value: 'd' },
    { ts: 400, value: 'e' },
  ];

  it('keeps frames inside the pre/post window around the trigger', () => {
    const clip = assembleClip(frames, 200, 150, 150);
    expect(clip.map((f) => f.value)).toEqual(['b', 'c', 'd']);
  });

  it('clamps at buffer edges', () => {
    const clip = assembleClip(frames, 0, 500, 150);
    expect(clip.map((f) => f.value)).toEqual(['a', 'b']);
  });
});

describe('selectClipFrames', () => {
  const frames: TimedFrame<string>[] = [
    { ts: 0, value: 'a' },
    { ts: 100, value: 'b' },
    { ts: 200, value: 'c' },
    { ts: 300, value: 'd' },
    { ts: 400, value: 'e' },
    { ts: 500, value: 'f' },
  ];

  it('returns small clips whole', () => {
    expect(selectClipFrames(frames.slice(0, 2), 100, 4)).toHaveLength(2);
  });

  it('always keeps pre, trigger, and post frames in time order', () => {
    const selected = selectClipFrames(frames, 200, 3);
    expect(selected.map((f) => f.value)).toEqual(['a', 'c', 'f']);
  });

  it('fills extra slots by spread, never duplicating', () => {
    const selected = selectClipFrames(frames, 200, 4);
    expect(selected).toHaveLength(4);
    const values = selected.map((f) => f.value);
    expect(new Set(values).size).toBe(4);
    expect(values).toContain('a');
    expect(values).toContain('c');
    expect(values).toContain('f');
    const times = selected.map((f) => f.ts);
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });

  it('degenerates gracefully for tiny budgets', () => {
    expect(selectClipFrames(frames, 200, 1).map((f) => f.value)).toEqual([
      'c',
    ]);
    expect(selectClipFrames(frames, 200, 0)).toEqual([]);
    expect(selectClipFrames([], 200, 4)).toEqual([]);
  });
});
