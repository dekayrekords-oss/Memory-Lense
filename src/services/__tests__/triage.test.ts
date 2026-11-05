import { describe, expect, it } from '@jest/globals';
import { decideTriage, normalizeName, sceneSignature } from '../triage';
import type { MemoryEvent, VisionResult } from '../types';

const NOW = 1_000_000;

function vision(partial: Partial<VisionResult>): VisionResult {
  return {
    caption: 'Keys on the dining table',
    objects: [{ name: 'keys', place: 'dining table', confidence: 0.9 }],
    tags: ['indoor'],
    importance: 0.2,
    ...partial,
  };
}

function event(partial: Partial<MemoryEvent>): MemoryEvent {
  return {
    id: 1,
    ts: NOW - 1000,
    kind: 'scene',
    caption: 'Keys on the dining table',
    objects: [{ name: 'keys', place: 'dining table', confidence: 0.9 }],
    tags: ['indoor'],
    photoUri: null,
    ...partial,
  };
}

describe('normalizeName', () => {
  it('lowercases and singularizes simple plurals', () => {
    expect(normalizeName(' Keys ')).toBe('key');
    expect(normalizeName('wallet')).toBe('wallet');
  });
});

describe('sceneSignature', () => {
  it('is stable across object order and case', () => {
    const a = vision({});
    const b = vision({
      objects: [{ name: 'Keys', place: null, confidence: 0.5 }],
    });
    expect(sceneSignature(a)).toBe(sceneSignature(b));
  });
});

describe('decideTriage', () => {
  it('deletes duplicates inside the dedupe window', () => {
    const decision = decideTriage(vision({}), [event({})], [], NOW);
    expect(decision.action).toBe('delete');
  });

  it('keeps frames containing a tracked object', () => {
    const decision = decideTriage(vision({}), [], ['keys'], NOW);
    expect(decision.action).toBe('keep');
  });

  it('keeps high-importance frames', () => {
    const decision = decideTriage(
      vision({ caption: 'Sunset over the lake', objects: [], importance: 0.9 }),
      [],
      [],
      NOW,
    );
    expect(decision.action).toBe('keep');
  });

  it('stores unimportant frames as text only', () => {
    const decision = decideTriage(
      vision({ caption: 'Empty hallway', objects: [], importance: 0.1 }),
      [],
      [],
      NOW,
    );
    expect(decision.action).toBe('text-only');
  });

  it('does not treat old identical scenes as duplicates', () => {
    const decision = decideTriage(
      vision({ importance: 0.1 }),
      [event({ ts: NOW - 10 * 60_000 })],
      [],
      NOW,
    );
    expect(decision.action).not.toBe('delete');
  });
});
