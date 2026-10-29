import { describe, expect, it } from '@jest/globals';
import { evaluatePrivacy } from '../privacy';
import type { VisionResult } from '../types';

function result(partial: Partial<VisionResult>): VisionResult {
  return { caption: 'A room', objects: [], tags: [], importance: 0, ...partial };
}

describe('evaluatePrivacy', () => {
  it('blocks restroom tags and names the trigger', () => {
    const verdict = evaluatePrivacy(result({ tags: ['restroom'] }));
    expect(verdict.blocked).toBe(true);
    expect(verdict.reason).toBe('privacy tag: restroom');
  });

  it('blocks nudity words in the caption', () => {
    expect(
      evaluatePrivacy(result({ caption: 'A nude figure' })).blocked,
    ).toBe(true);
  });

  it('does not stop for a private place merely mentioned', () => {
    const verdict = evaluatePrivacy(
      result({ caption: 'A roll of toilet paper on the kitchen counter' }),
    );
    expect(verdict.blocked).toBe(false);
    expect(verdict.mention).toContain('toilet');
  });

  it('does not match parts of words (toiletry is not toilet)', () => {
    const verdict = evaluatePrivacy(
      result({ caption: 'A toiletry bag by the door' }),
    );
    expect(verdict.blocked).toBe(false);
    expect(verdict.mention).toBeNull();
  });

  it('allows ordinary scenes', () => {
    const verdict = evaluatePrivacy(
      result({ caption: 'Keys on the dining table', tags: ['indoor'] }),
    );
    expect(verdict.blocked).toBe(false);
    expect(verdict.reason).toBeNull();
    expect(verdict.mention).toBeNull();
  });
});
