import { describe, expect, it, jest } from '@jest/globals';
import {
  FrameStream,
  isStreamUrl,
  RingBuffer,
  type StreamSocket,
} from '../frameStream';

describe('isStreamUrl', () => {
  it('treats ws(s) URLs as streams and http(s) as snapshots', () => {
    expect(isStreamUrl('ws://192.168.1.20:9000/frames')).toBe(true);
    expect(isStreamUrl('wss://robot.local/frames')).toBe(true);
    expect(isStreamUrl('http://192.168.1.20:9000/frame.jpg')).toBe(false);
    expect(isStreamUrl('https://cam/frame.jpg')).toBe(false);
  });

  it('trims whitespace and ignores case', () => {
    expect(isStreamUrl('  WS://host/frames ')).toBe(true);
    expect(isStreamUrl('')).toBe(false);
  });
});

describe('RingBuffer', () => {
  it('keeps insertion order in snapshots', () => {
    const ring = new RingBuffer<string>({ maxFrames: 10, maxAgeMs: 60_000 });
    ring.push(100, 'a');
    ring.push(200, 'b');
    expect(ring.snapshot(300)).toEqual([
      { ts: 100, value: 'a' },
      { ts: 200, value: 'b' },
    ]);
  });

  it('evicts oldest frames past the count cap', () => {
    const ring = new RingBuffer<string>({ maxFrames: 2, maxAgeMs: 60_000 });
    ring.push(100, 'a');
    ring.push(200, 'b');
    ring.push(300, 'c');
    expect(ring.snapshot(400).map((f) => f.value)).toEqual(['b', 'c']);
  });

  it('drops frames older than the age window', () => {
    const ring = new RingBuffer<string>({ maxFrames: 10, maxAgeMs: 1000 });
    ring.push(0, 'old');
    ring.push(900, 'new');
    expect(ring.snapshot(1500).map((f) => f.value)).toEqual(['new']);
  });

  it('clears everything', () => {
    const ring = new RingBuffer<string>({ maxFrames: 10, maxAgeMs: 60_000 });
    ring.push(100, 'a');
    ring.clear();
    expect(ring.snapshot(200)).toEqual([]);
  });
});

function mockSocket(): StreamSocket & {
  emit: (data: ArrayBuffer | string) => void;
  fail: (message: string) => void;
  closed: () => boolean;
} {
  let closed = false;
  const socket = {
    binaryType: '',
    onmessage: null as (((event: { data: unknown }) => void) | null),
    onerror: null as (((event: { message?: string }) => void) | null),
    onclose: null as ((() => void) | null),
    close: jest.fn(() => {
      closed = true;
    }),
    emit(data: ArrayBuffer | string) {
      socket.onmessage?.({ data });
    },
    fail(message: string) {
      socket.onerror?.({ message });
    },
    closed: () => closed,
  };
  return socket;
}

describe('FrameStream', () => {
  it('delivers binary messages as frames and requests arraybuffer', async () => {
    const socket = mockSocket();
    const onFrame = jest.fn();
    const stream = new FrameStream('ws://host/frames', {
      createSocket: () => socket,
      onFrame,
      onError: () => {},
    });
    stream.start();
    expect(socket.binaryType).toBe('arraybuffer');
    const bytes = new Uint8Array([1, 2, 3]);
    socket.emit(bytes.buffer as ArrayBuffer);
    await Promise.resolve();
    expect(onFrame).toHaveBeenCalledTimes(1);
    expect(onFrame.mock.calls[0][0]).toBeInstanceOf(Uint8Array);
    expect(Array.from(onFrame.mock.calls[0][0] as Uint8Array)).toEqual([1, 2, 3]);
    stream.stop();
  });

  it('ignores text messages (protocol chatter, not frames)', async () => {
    const socket = mockSocket();
    const onFrame = jest.fn();
    const onError = jest.fn();
    const stream = new FrameStream('ws://host/frames', {
      createSocket: () => socket,
      onFrame,
      onError,
    });
    stream.start();
    socket.emit('hello');
    await Promise.resolve();
    expect(onFrame).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
    stream.stop();
  });

  it('reports socket errors and stops', () => {
    const socket = mockSocket();
    const onError = jest.fn();
    const stream = new FrameStream('ws://host/frames', {
      createSocket: () => socket,
      onFrame: () => {},
      onError,
    });
    stream.start();
    expect(stream.running).toBe(true);
    socket.fail('connection refused');
    expect(onError).toHaveBeenCalledWith(
      expect.stringContaining('connection refused'),
    );
    expect(stream.running).toBe(false);
  });

  it('closes the socket on stop and reports disconnects as errors', () => {
    const socket = mockSocket();
    const onError = jest.fn();
    const stream = new FrameStream('ws://host/frames', {
      createSocket: () => socket,
      onFrame: () => {},
      onError,
    });
    stream.start();
    stream.stop();
    expect(socket.closed()).toBe(true);
    expect(stream.running).toBe(false);
    // A close that arrives on its own (server drop) must surface, not go
    // silently blind — the UI stops with a visible error like fetch failures.
    const socket2 = mockSocket();
    const stream2 = new FrameStream('ws://host/frames', {
      createSocket: () => socket2,
      onFrame: () => {},
      onError,
    });
    stream2.start();
    socket2.onclose?.();
    expect(onError).toHaveBeenCalledWith(expect.stringContaining('closed'));
    expect(stream2.running).toBe(false);
  });

  it('start is idempotent', () => {
    const createSocket = jest.fn(() => mockSocket());
    const stream = new FrameStream('ws://host/frames', {
      createSocket: createSocket as unknown as () => StreamSocket,
      onFrame: () => {},
      onError: () => {},
    });
    stream.start();
    stream.start();
    expect(createSocket).toHaveBeenCalledTimes(1);
    stream.stop();
  });
});
