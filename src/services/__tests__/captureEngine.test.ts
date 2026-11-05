import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { CaptureEngine } from '../captureEngine';
import type { VisionResult } from '../types';
import type { VisionProvider } from '../vision/provider';

const inserted: unknown[] = [];

jest.mock('../memoryStore', () => ({
  insertEvent: jest.fn(async (event: unknown) => {
    inserted.push(event);
    return { ...(event as Record<string, unknown>), id: inserted.length };
  }),
  listEvents: jest.fn(async () => []),
}));

jest.mock('../photoFiles', () => ({
  deletePhoto: jest.fn(() => {}),
  keepPhoto: jest.fn(async (uri: string) => uri),
}));

const UNANALYZED: VisionResult = {
  caption: 'Frame captured — vision backend not connected',
  objects: [],
  tags: ['unanalyzed'],
  importance: 0.05,
};

function visionOf(result: VisionResult): VisionProvider {
  return { analyze: jest.fn(async () => result) };
}

async function tickOnce(engine: CaptureEngine): Promise<void> {
  engine.start(60);
  await new Promise((resolve) => setTimeout(resolve, 10));
  engine.stop();
}

describe('CaptureEngine with a real (non-simulated) source', () => {
  beforeEach(() => {
    inserted.length = 0;
  });

  it('never invents a scene when the camera produced no frame', async () => {
    const analyze = jest.fn(async () => UNANALYZED);
    const onNoFrame = jest.fn((..._args: unknown[]) => {});
    const engine = new CaptureEngine({
      vision: { analyze },
      takePhoto: async () => null,
      getScenarios: () => [],
      callbacks: { onNoFrame },
    });
    await tickOnce(engine);
    expect(analyze).not.toHaveBeenCalled();
    expect(onNoFrame).toHaveBeenCalled();
    expect(inserted).toHaveLength(0);
  });

  it('stops loudly instead of storing an unanalyzed real photo', async () => {
    const onStopped = jest.fn((..._args: unknown[]) => {});
    const engine = new CaptureEngine({
      vision: visionOf(UNANALYZED),
      takePhoto: async () => 'file:///cache/real.jpg',
      getScenarios: () => [],
      callbacks: { onStopped },
    });
    await tickOnce(engine);
    expect(inserted).toHaveLength(0);
    expect(onStopped).toHaveBeenCalledWith(
      'unanalyzed',
      expect.stringContaining('watching stopped'),
    );
    expect(engine.running).toBe(false);
  });
});

describe('CaptureEngine with the simulated source', () => {
  beforeEach(() => {
    inserted.length = 0;
  });

  it('still runs the scripted demo for null frames', async () => {
    const scripted: VisionResult = {
      caption: 'Keys on the dining table',
      objects: [{ name: 'keys', place: 'dining table', confidence: 0.9 }],
      tags: ['indoor'],
      importance: 0.8,
    };
    const engine = new CaptureEngine({
      simulated: true,
      vision: visionOf(scripted),
      takePhoto: async () => null,
      getScenarios: () => [],
    });
    await tickOnce(engine);
    expect(inserted).toHaveLength(1);
  });
});
