import { describe, expect, it } from '@jest/globals';
import { evaluatePrivacy } from '../privacy';
import type { VisionResult } from '../types';

function result(partial: Partial<VisionResult>): VisionResult {
  return { caption: 'A room', objects: [], tags: [], importance: 0, ...partial };
}

describe('evaluatePrivacy', () => {
  it('blocks restroom tags', () => {
    expect(evaluatePrivacy(result({ tags: ['restroom'] })).blocked).toBe(true);
  });

  it('blocks nudity words in the caption', () => {
    expect(
      evaluatePrivacy(result({ caption: 'A nude figure' })).blocked,
    ).toBe(true);
  });

  it('allows ordinary scenes', () => {
    const verdict = evaluatePrivacy(
      result({ caption: 'Keys on the dining table', tags: ['indoor'] }),
    );
    expect(verdict.blocked).toBe(false);
    expect(verdict.reason).toBeNull();
  });
});
