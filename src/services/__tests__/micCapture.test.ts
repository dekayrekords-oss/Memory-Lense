import { describe, expect, it, jest } from '@jest/globals';
import { MicSession, type MicRecorderAdapter } from '../micCapture';
import type { MemoryEvent } from '../types';

function fakeRecorder(): MicRecorderAdapter & {
  starts: () => number;
} {
  let starts = 0;
  return {
    start: jest.fn(async () => {
      starts += 1;
    }),
    stop: jest.fn(async () => ({
      uri: `file:///cache/note-${starts}.m4a`,
      durationMs: 1200,
    })),
    starts: () => starts,
  };
}

function harness(transcript: string) {
  const stored: Omit<MemoryEvent, 'id'>[] = [];
  const deleted: string[] = [];
  const session = new MicSession({
    recorder: fakeRecorder(),
    transcribe: async () => transcript,
    store: async (e) => {
      stored.push(e);
      return { ...e, id: stored.length };
    },
    deleteAudio: (uri) => {
      deleted.push(uri);
    },
    sleep: async () => {},
    now: () => 1_700_000_000_000,
  });
  return { session, stored, deleted };
}

describe('MicSession voice notes', () => {
  it('keeps the audio with its transcript', async () => {
    const { session, stored, deleted } = harness('remember to buy milk');
    await session.startNote();
    const event = await session.stopNote();
    expect(event?.kind).toBe('audio');
    expect(event?.caption).toBe('remember to buy milk');
    expect(event?.audioUri).toContain('note-1');
    expect(stored).toHaveLength(1);
    expect(deleted).toEqual([]);
  });

  it('keeps the note even without a transcript', async () => {
    const { session } = harness('');
    await session.startNote();
    const event = await session.stopNote();
    expect(event?.caption).toContain('Voice note');
    expect(event?.audioUri).not.toBeNull();
  });

  it('ignores stop without start', async () => {
    const { session, stored } = harness('x');
    await expect(session.stopNote()).resolves.toBeNull();
    expect(stored).toHaveLength(0);
  });
});

describe('MicSession ambient samples', () => {
  it('stores heard speech as text and deletes the audio', async () => {
    const { session, stored, deleted } = harness('keys are on the table');
    const event = await session.sampleAmbientOnce(10);
    expect(event?.kind).toBe('audio');
    expect(event?.caption).toBe('keys are on the table');
    expect(event?.audioUri).toBeNull();
    expect(stored).toHaveLength(1);
    expect(deleted).toHaveLength(1);
  });

  it('drops silent samples without storing anything', async () => {
    const { session, stored, deleted } = harness('   ');
    await expect(session.sampleAmbientOnce(10)).resolves.toBeNull();
    expect(stored).toHaveLength(0);
    expect(deleted).toHaveLength(1);
  });
});
