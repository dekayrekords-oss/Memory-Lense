import { describe, expect, it, jest } from '@jest/globals';
import {
  createHttpFrameSource,
  createPhoneSource,
  createSimulationSource,
} from '../captureSources';

describe('createSimulationSource', () => {
  it('produces frameless ticks for the mock pipeline', async () => {
    const source = createSimulationSource();
    expect(source.kind).toBe('simulation');
    await expect(source.takePhoto()).resolves.toBeNull();
  });
});

describe('createPhoneSource', () => {
  it('passes through the camera capture function', async () => {
    const take = jest.fn(async () => 'file:///cache/photo.jpg');
    const source = createPhoneSource(take);
    expect(source.kind).toBe('phone');
    await expect(source.takePhoto()).resolves.toBe('file:///cache/photo.jpg');
    expect(take).toHaveBeenCalledTimes(1);
  });
});

describe('createHttpFrameSource', () => {
  it('fetches a frame and stores it as a photo file', async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const writeFrame = jest.fn(
      async (_b: Uint8Array, _ts: number) => 'file:///cache/frames/f.jpg',
    );
    const source = createHttpFrameSource('robot', 'http://cam/frame.jpg', {
      fetchFrame: async () => bytes,
      writeFrame,
    });
    expect(source.kind).toBe('robot');
    await expect(source.takePhoto()).resolves.toBe(
      'file:///cache/frames/f.jpg',
    );
    expect(writeFrame.mock.calls[0][0]).toBe(bytes);
  });

  it('supports the glasses bridge kind', () => {
    const source = createHttpFrameSource('glasses', 'http://phone:9000/f', {
      fetchFrame: async () => new Uint8Array(),
      writeFrame: async () => 'file:///x.jpg',
    });
    expect(source.kind).toBe('glasses');
    expect(source.label).toContain('generic');
  });

  it('propagates fetch failures so the engine can stop with an error', async () => {
    const source = createHttpFrameSource('robot', 'http://cam/frame.jpg', {
      fetchFrame: async () => {
        throw new Error('camera unreachable: 503');
      },
      writeFrame: async () => 'file:///x.jpg',
    });
    await expect(source.takePhoto()).rejects.toThrow(/unreachable/);
  });
});
