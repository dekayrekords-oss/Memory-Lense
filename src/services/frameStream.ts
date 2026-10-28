import type { TimedFrame } from './fastCapture';

// Streaming frame ingest for Fast Capture.
//
// Transport note: the master plan preferred MJPEG-over-HTTP, but React
// Native's fetch has no streaming response body (it buffers the whole
// response, so an infinite multipart stream never resolves). WebSocket
// binary messages are the working stream transport here: each binary
// message is one complete JPEG frame; text messages are ignored.
// Snapshot polling (http/https URLs) stays as the fallback.

/** ws:// and wss:// URLs stream; anything else is snapshot-polled. */
export function isStreamUrl(rawUrl: string): boolean {
  const url = rawUrl.trim().toLowerCase();
  return url.startsWith('ws://') || url.startsWith('wss://');
}

export interface RingBufferConfig {
  /** Hard cap on held frames — bounds memory at any stream rate. */
  maxFrames: number;
  /** Frames older than this (relative to the read time) are dropped. */
  maxAgeMs: number;
}

/** Bounded rolling window over a frame stream. Oldest evicted first. */
export class RingBuffer<T> {
  private frames: TimedFrame<T>[] = [];

  constructor(private readonly config: RingBufferConfig) {}

  push(ts: number, value: T): void {
    this.frames.push({ ts, value });
    while (this.frames.length > this.config.maxFrames) {
      this.frames.shift();
    }
  }

  /** Frames within the age window, oldest first. */
  snapshot(now: number): TimedFrame<T>[] {
    const cutoff = now - this.config.maxAgeMs;
    return this.frames.filter((f) => f.ts >= cutoff);
  }

  clear(): void {
    this.frames = [];
  }
}

/**
 * Minimal socket surface FrameStream needs. React Native's WebSocket
 * satisfies it at runtime (binaryType exists in WebSocket.js but is
 * missing from RN's types, so the app casts at the boundary).
 */
export interface StreamSocket {
  binaryType: string;
  onmessage: (((event: { data: unknown }) => void) | null);
  onerror: (((event: { message?: string }) => void) | null);
  onclose: ((() => void) | null);
  close(): void;
}

export interface FrameStreamOptions {
  createSocket: (url: string) => StreamSocket;
  /** One complete JPEG frame per call. */
  onFrame: (bytes: Uint8Array) => void;
  /** Fatal stream problem — the UI stops with this message. */
  onError: (message: string) => void;
}

/**
 * One JPEG frame per WebSocket binary message. Failures and server-side
 * closes surface through onError so capture never goes silently blind —
 * the same contract as the snapshot-polling path.
 */
export class FrameStream {
  private socket: StreamSocket | null = null;
  private stopped = false;

  constructor(
    private readonly url: string,
    private readonly opts: FrameStreamOptions,
  ) {}

  get running(): boolean {
    return this.socket !== null && !this.stopped;
  }

  start(): void {
    if (this.socket) return;
    this.stopped = false;
    const socket = this.opts.createSocket(this.url);
    this.socket = socket;
    try {
      socket.binaryType = 'arraybuffer';
    } catch {
      // Socket implementations that lack binaryType still deliver messages.
    }
    socket.onmessage = (event) => {
      if (this.stopped) return;
      const { data } = event;
      if (data instanceof ArrayBuffer) {
        this.opts.onFrame(new Uint8Array(data));
      }
      // Text/Blob chatter is not a frame — ignore it.
    };
    socket.onerror = (event) => {
      if (this.stopped) return;
      this.fail(
        typeof event?.message === 'string' && event.message
          ? `frame stream failed: ${event.message}`
          : 'frame stream failed',
      );
    };
    socket.onclose = () => {
      if (this.stopped) return;
      this.fail('frame stream closed by the server');
    };
  }

  stop(): void {
    this.stopped = true;
    const socket = this.socket;
    this.socket = null;
    if (!socket) return;
    socket.onmessage = null;
    socket.onerror = null;
    socket.onclose = null;
    try {
      socket.close();
    } catch {
      // Already closed — stopping is best-effort by design.
    }
  }

  private fail(message: string): void {
    this.stop();
    this.opts.onError(message);
  }
}
