import { describe, expect, it, jest } from '@jest/globals';
import {
  createMetaDat,
  DAT_MODULES,
  unavailableReason,
  type MetaNativeBridge,
} from '../metaDAT';

function mockBridge(overrides: Partial<MetaNativeBridge> = {}): MetaNativeBridge {
  return {
    configure: jest.fn(async () => {}),
    startRegistration: jest.fn(async () => {}),
    checkPermission: jest.fn(async () => 'granted' as const),
    requestPermission: jest.fn(async () => 'granted' as const),
    listDevices: jest.fn(async () => [
      { id: 'mock-1', name: 'Mock Ray-Ban Display', kind: 'glasses' as const },
    ]),
    startSession: jest.fn(async () => ({ deviceId: 'mock-1' })),
    startCameraStream: jest.fn(async () => {}),
    stopCameraStream: jest.fn(async () => {}),
    capturePhoto: jest.fn(async () => ({
      base64: 'QUJD',
      mimeType: 'image/jpeg',
    })),
    showText: jest.fn(async () => {}),
    startSpeech: jest.fn(async () => {}),
    getDeviceState: jest.fn(async () => ({
      batteryPercent: 82,
      connected: true,
    })),
    ...overrides,
  };
}

describe('DAT_MODULES', () => {
  it('covers every toolkit module from Meta docs', () => {
    expect(DAT_MODULES).toEqual([
      'core',
      'camera',
      'microphone',
      'speakers',
      'display',
      'speech',
      'inputs',
      'motion',
      'deviceState',
    ]);
  });
});

describe('createMetaDat without a native bridge', () => {
  it('reports unavailable with an honest reason and never throws', async () => {
    const meta = createMetaDat(null);
    const status = await meta.status();
    expect(status.available).toBe(false);
    expect(status.reason).toContain('native module');
    await expect(meta.configure()).resolves.toBe(false);
    await expect(meta.listDevices()).resolves.toEqual([]);
  });
});

describe('createMetaDat with a native bridge', () => {
  it('configures once and reports registered capabilities', async () => {
    const bridge = mockBridge();
    const meta = createMetaDat(bridge);
    await expect(meta.configure()).resolves.toBe(true);
    await expect(meta.configure()).resolves.toBe(true);
    expect(bridge.configure).toHaveBeenCalledTimes(1);
    const status = await meta.status();
    expect(status.available).toBe(true);
    expect(status.modules).toContain('camera');
    const devices = await meta.listDevices();
    expect(devices[0].name).toContain('Ray-Ban');
  });

  it('streams frames through the bridge and captures photos', async () => {
    const bridge = mockBridge();
    const meta = createMetaDat(bridge);
    await meta.configure();
    await meta.connect('mock-1');
    const onFrame = jest.fn();
    await meta.startCameraStream(
      { fps: 15, resolution: 'medium' },
      (bytes) => onFrame(bytes),
    );
    // Simulate the bridge delivering a frame.
    const start = bridge.startCameraStream as unknown as {
      mock: { calls: unknown[][] };
    };
    const deliver = start.mock.calls[0][1] as (b: Uint8Array) => void;
    deliver(new Uint8Array([1, 2]));
    expect(onFrame).toHaveBeenCalledTimes(1);
    const photo = await meta.capturePhoto();
    expect(photo.base64).toBe('QUJD');
    await meta.stopCameraStream();
    expect(bridge.stopCameraStream).toHaveBeenCalledTimes(1);
  });

  it('surfaces bridge failures as errors, not crashes', async () => {
    const bridge = mockBridge({
      startSession: jest.fn(async () => {
        throw new Error('no device');
      }),
    });
    const meta = createMetaDat(bridge);
    await expect(meta.connect('mock-1')).rejects.toThrow(/no device/);
  });

  it('tracks bridge device state', async () => {
    const meta = createMetaDat(mockBridge());
    const state = await meta.getDeviceState();
    expect(state).toEqual({ batteryPercent: 82, connected: true });
  });
});

describe('friendlyDatError + app id gate', () => {
  it('translates NO_ELIGIBLE_DEVICE into pairing instructions', async () => {
    const bridge = mockBridge({
      startSession: jest.fn(async () => {
        throw new Error('NO_ELIGIBLE_DEVICE: No eligible device found');
      }),
    });
    const meta = createMetaDat(bridge);
    await expect(meta.connect('mock-1')).rejects.toThrow(
      /Developer Mode ON/,
    );
  });

  it('translates glasses-update session failures into update steps', async () => {
    const bridge = mockBridge({
      startCameraStream: jest.fn(async () => {
        throw new Error(
          'Meta session did not finish starting (state=STOPPED, ' +
            'last error: DAT_APP_ON_THE_GLASSES_UPDATE_REQUIRED).',
        );
      }),
    });
    const meta = createMetaDat(bridge);
    await expect(
      meta.startCameraStream({ fps: 7, resolution: 'medium' }, () => {}),
    ).rejects.toThrow(/software update/i);
  });

  it('translates device-ended sessions into a retry message', async () => {
    const bridge = mockBridge({
      startSession: jest.fn(async () => {
        throw new Error('session error SESSION_ENDED_BY_DEVICE');
      }),
    });
    const meta = createMetaDat(bridge);
    await expect(meta.connect('mock-1')).rejects.toThrow(/ended the session/);
  });

  it('runs in Developer Mode (no throw) when no Meta app id is set', async () => {
    const bridge = mockBridge();
    const meta = createMetaDat(bridge, { appIdConfigured: false });
    const status = await meta.status();
    expect(status.available).toBe(true);
    expect(status.reason).toContain('Developer Mode');
    await expect(meta.configure()).resolves.toBe(true);
    expect(bridge.configure).toHaveBeenCalled();
  });

  it('keeps unknown errors verbatim', async () => {
    const bridge = mockBridge({
      startSession: jest.fn(async () => {
        throw new Error('something odd');
      }),
    });
    await expect(createMetaDat(bridge).connect('x')).rejects.toThrow(
      'something odd',
    );
  });
});

describe('unavailableReason', () => {
  it('explains Expo Go and missing builds', () => {
    expect(unavailableReason()).toContain('development build');
  });
});
