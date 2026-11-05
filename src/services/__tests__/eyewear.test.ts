import { describe, expect, it, jest } from '@jest/globals';
import {
  createMetaFrameSource,
  ensureMetaBluetoothPermissions,
  eyewearPreviewState,
  EyewearProfileResolver,
  GENERIC_PRESETS,
  META_BLUETOOTH_PERMISSIONS,
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

describe('eyewearPreviewState', () => {
  it('waits when no frame has arrived yet', () => {
    expect(eyewearPreviewState(false, null)).toBe('waiting');
    expect(eyewearPreviewState(false, 0)).toBe('waiting');
  });

  it('is live while frames are fresh', () => {
    expect(eyewearPreviewState(true, 0)).toBe('live');
    expect(eyewearPreviewState(true, 9_999)).toBe('live');
  });

  it('goes stale when the feed pauses', () => {
    expect(eyewearPreviewState(true, 10_001)).toBe('stale');
    expect(eyewearPreviewState(true, 60_000)).toBe('stale');
  });
});

describe('ensureMetaBluetoothPermissions', () => {
  it('requests every DAT Bluetooth permission and passes when all granted', async () => {
    const requested: string[][] = [];
    const granted = await ensureMetaBluetoothPermissions(async (perms) => {
      requested.push(perms);
      return Object.fromEntries(perms.map((p) => [p, true]));
    });
    expect(granted).toBe(true);
    expect(requested).toEqual([[...META_BLUETOOTH_PERMISSIONS]]);
  });

  it('fails closed when any Bluetooth permission is denied', async () => {
    const granted = await ensureMetaBluetoothPermissions(async (perms) =>
      Object.fromEntries(perms.map((p) => [p, false])),
    );
    expect(granted).toBe(false);
  });

  it('fails closed when a grant entry is missing', async () => {
    const granted = await ensureMetaBluetoothPermissions(async () => ({}));
    expect(granted).toBe(false);
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
  requestPermission: async () => 'granted' as const,
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
  it('connects to the first device before streaming', async () => {
    const meta = fakeMeta([]);
    const connect = jest.fn(meta.connect);
    const source = createMetaFrameSource(
      { ...meta, connect },
      { writeFrame: async () => 'file:///x.jpg' },
    );
    await source.start?.();
    expect(connect).toHaveBeenCalledWith('d1');
  });

  it('asks for glasses camera permission when not yet granted', async () => {
    const base = fakeMeta([]);
    const requestPermission = jest.fn(
      async (_kind: string) => 'granted' as const,
    );
    const source = createMetaFrameSource(
      {
        ...base,
        checkPermission: async () => 'denied' as const,
        requestPermission,
      },
      { writeFrame: async () => 'file:///x.jpg' },
    );
    await source.start?.();
    expect(requestPermission).toHaveBeenCalledWith('camera');
  });

  it('refuses to stream when glasses camera permission stays denied', async () => {
    const base = fakeMeta([]);
    const startCameraStream = jest.fn(base.startCameraStream);
    const source = createMetaFrameSource(
      {
        ...base,
        checkPermission: async () => 'denied' as const,
        requestPermission: async () => 'denied' as const,
        startCameraStream,
      },
      { writeFrame: async () => 'file:///x.jpg' },
    );
    await expect(source.start?.()).rejects.toThrow(/permission/i);
    expect(startCameraStream).not.toHaveBeenCalled();
  });

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

describe('Meta source retry + staleness (bug-hunt regressions)', () => {
  it('a failed start stays retryable instead of latching started', async () => {
    let attempts = 0;
    const meta = fakeMeta([]);
    const flaky: MetaDatService = {
      ...meta,
      connect: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error('NO_ELIGIBLE_DEVICE');
      },
    };
    const source = createMetaFrameSource(flaky);
    await expect(source.start?.()).rejects.toThrow('NO_ELIGIBLE_DEVICE');
    await expect(source.start?.()).resolves.toBeUndefined();
    expect(attempts).toBe(2);
  });

  it('never serves a frozen frame as a current photo', async () => {
    const meta = fakeMeta([new Uint8Array([1, 2, 3])]);
    const source = createMetaFrameSource(meta);
    await source.start?.();
    const fresh = await source.takePhoto();
    expect(fresh).not.toBeNull();
    jest.useFakeTimers();
    jest.setSystemTime(Date.now() + 60_000);
    try {
      await expect(source.takePhoto()).resolves.toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });
});
