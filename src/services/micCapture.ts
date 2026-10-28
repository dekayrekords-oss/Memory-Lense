import type { MemoryEvent } from './types';

// Mic-only mode: no camera. Two capture paths, one privacy rule borrowed
// from photos — ambient audio is transcribed to text and then deleted;
// only deliberate voice notes keep their audio file.
//
// - voice notes: tap to record, tap to stop; kept with transcript
// - ambient: rolling short samples while armed; silent samples vanish

export interface MicRecording {
  uri: string;
  durationMs: number;
}

export interface MicRecorderAdapter {
  start(): Promise<void>;
  stop(): Promise<MicRecording>;
}

export interface MicDeps {
  recorder: MicRecorderAdapter;
  /** Transcript for a recording, '' when unavailable or silent. */
  transcribe: (uri: string) => Promise<string>;
  store: (event: Omit<MemoryEvent, 'id'>) => Promise<MemoryEvent>;
  deleteAudio: (uri: string) => void;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

export class MicSession {
  private recording = false;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;

  constructor(private readonly deps: MicDeps) {
    this.sleep =
      deps.sleep ??
      ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.now = deps.now ?? Date.now;
  }

  get isRecording(): boolean {
    return this.recording;
  }

  async startNote(): Promise<void> {
    if (this.recording) return;
    await this.deps.recorder.start();
    this.recording = true;
  }

  /** Stops a voice note, transcribes it, and keeps the audio. */
  async stopNote(): Promise<MemoryEvent | null> {
    if (!this.recording) return null;
    this.recording = false;
    const recording = await this.deps.recorder.stop();
    let text = '';
    try {
      text = (await this.deps.transcribe(recording.uri)).trim();
    } catch {
      text = '';
    }
    return this.deps.store({
      ts: this.now(),
      kind: 'audio',
      caption: text || 'Voice note (no transcript)',
      objects: [],
      tags: ['audio', 'voice-note'],
      photoUri: null,
      audioUri: recording.uri,
    });
  }

  /**
   * One ambient sample: record, transcribe, keep only heard speech as a
   * text memory. The audio file is always deleted afterwards.
   */
  async sampleAmbientOnce(sampleMs: number): Promise<MemoryEvent | null> {
    if (this.recording) return null;
    this.recording = true;
    let recording: MicRecording;
    try {
      await this.deps.recorder.start();
      await this.sleep(sampleMs);
      recording = await this.deps.recorder.stop();
    } finally {
      this.recording = false;
    }
    let text = '';
    try {
      text = (await this.deps.transcribe(recording.uri)).trim();
    } catch {
      text = '';
    }
    this.deps.deleteAudio(recording.uri);
    if (!text) return null;
    return this.deps.store({
      ts: this.now(),
      kind: 'audio',
      caption: text,
      objects: [],
      tags: ['audio', 'ambient'],
      photoUri: null,
      audioUri: null,
    });
  }
}
