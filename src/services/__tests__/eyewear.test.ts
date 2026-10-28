import { describe, expect, it, jest } from '@jest/globals';
import {
  createMetaFrameSource,
  EyewearProfileResolver,
  GENERIC_PRESETS,
  profileForUrl,
} from '../eyewear';
import type { MetaDatService } from '../metaDAT';

describe('profileForUrl', () => {
  it('routes ws/wss to stream and http(s) to snapshot', () => {
    expect(profileForUrl('ws://h/frames').transport).toBe('stream');
    expect(profileForUrl('wss://h/frames').transport).toBe('stream');
    expect(profileForUrl('http://h/frame.jpg').transport).toBe('snapshot');
  });

  it('labels generic bridges generically', () => {
    expect(profileForUrl('ws://h/f').label).toContain('Generic');
    expect(GENERIC_PRESETS.length).toBeGreaterThan(0);
  });
});

describe('EyewearProfileResolver', () => {
  it('resolves Meta first, generic bridge second, simulation last', () => {
    const r = new EyewearProfileResolver();
    const order = r.resolve({ metaAvailable: false, url: 'ws://h/f' });
    expect(order.map((p) => p.id)).toEqual(['generic', 'simulation']);
    const withMeta = r.resolve({ metaAvailable: true, url: '' });
    expect(withMeta[0].id).toBe('meta');
  });
});

const fakeMeta = (frames: Uint8Array[]): MetaDatService => ({
  status: async () => ({
    available: true,
    reason: null,
    modules: [],
    experimental: [],
  }),
  configure: async () => true,
  register: async () => {},
  checkPermission: async () => 'granted' as const,
  listDevices: async () => [{ id: 'd1', name: 'Mock', kind: 'mock' as const }],
  connect: async () => {},
  startCameraStream: async (_cfg, onFrame) => {
    for (const f of frames) onFrame(f);
  },
  stopCameraStream: async () => {},
  capturePhoto: async () => ({ base64: 'AA', mimeType: 'image/jpeg' }),
  showText: async () => {},
  startSpeech: async () => {},
  getDeviceState: async () => ({ batteryPercent: 50, connected: true }),
});

describe('createMetaFrameSource', () => {
  it('serves the latest streamed frame as a photo file', async () => {
    const writeFrame = jest.fn(
      async (_b: Uint8Array, _ts: number) => 'file:///cache/frames/m.jpg',
    );
    const source = createMetaFrameSource(
      fakeMeta([new Uint8Array([9, 9])]),
      { writeFrame },
    );
    expect(source.kind).toBe('meta');
    await source.start?.();
    await expect(source.takePhoto()).resolves.toBe('file:///cache/frames/m.jpg');
    expect(writeFrame.mock.calls[0][0]).toEqual(new Uint8Array([9, 9]));
    await source.stop?.();
  });

  it('returns null before the first frame arrives', async () => {
    const source = createMetaFrameSource(fakeMeta([]), {
      writeFrame: async () => 'file:///x.jpg',
    });
    await expect(source.takePhoto()).resolves.toBeNull();
  });
});
