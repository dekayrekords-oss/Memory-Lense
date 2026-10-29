import { clampIntervalSeconds, DEFAULT_INTERVAL_SECONDS } from './config';
import { insertEvent, listEvents } from './memoryStore';
import { deletePhoto, keepPhoto } from './photoFiles';
import { evaluatePrivacy } from './privacy';
import { evaluateScenarios, scenarioTrackedNames } from './scenarios';
import { decideTriage } from './triage';
import type { MemoryEvent, Scenario, ScenarioAlert } from './types';
import type { VisionProvider } from './vision/provider';

export type StopReason = 'user' | 'privacy' | 'error';

export interface CaptureCallbacks {
  onEvent?: (event: MemoryEvent) => void;
  onAlert?: (alert: ScenarioAlert) => void;
  onStopped?: (reason: StopReason, detail?: string) => void;
  onError?: (message: string) => void;
  /** A frame was discarded for merely mentioning a private place. */
  onPrivacySkip?: (reason: string) => void;
}

export interface CaptureEngineOptions {
  vision: VisionProvider;
  /** Returns a cache file URI, or null for a simulated frame (no file). */
  takePhoto: () => Promise<string | null>;
  getScenarios: () => Scenario[];
  callbacks?: CaptureCallbacks;
}

/**
 * Capture loop: photo -> privacy gate -> triage -> store -> scenario rules.
 * The privacy gate is absolute: a blocked frame stops the session, its
 * photo is deleted, and only a text note is recorded.
 */
export class CaptureEngine {
  private timer: ReturnType<typeof setInterval> | null = null;
  private busy = false;
  private readonly firedAlerts = new Set<string>();
  intervalSeconds = DEFAULT_INTERVAL_SECONDS;

  constructor(private readonly opts: CaptureEngineOptions) {}

  get running(): boolean {
    return this.timer !== null;
  }

  start(intervalSeconds: number = this.intervalSeconds): void {
    this.intervalSeconds = clampIntervalSeconds(intervalSeconds);
    if (this.timer) return;
    const tick = () => {
      void this.tick();
    };
    this.timer = setInterval(tick, this.intervalSeconds * 1000);
    tick();
  }

  stop(reason: StopReason = 'user', detail?: string): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
    this.opts.callbacks?.onStopped?.(reason, detail);
  }

  setIntervalSeconds(seconds: number): void {
    this.intervalSeconds = clampIntervalSeconds(seconds);
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = setInterval(() => {
        void this.tick();
      }, this.intervalSeconds * 1000);
    }
  }

  private async tick(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      const photoUri = await this.opts.takePhoto();
      const result = await this.opts.vision.analyze(photoUri);
      const now = Date.now();

      const privacy = evaluatePrivacy(result);
      if (privacy.blocked) {
        if (photoUri) deletePhoto(photoUri);
        const event = await insertEvent({
          ts: now,
          kind: 'privacy-stop',
          caption:
            `Capture stopped — private scene detected ` +
            `(${privacy.reason ?? 'privacy tag'}). No photo kept.`,
          objects: [],
          tags: [],
          photoUri: null,
        });
        this.opts.callbacks?.onEvent?.(event);
        this.stop('privacy', privacy.reason ?? undefined);
        return;
      }
      if (privacy.mention) {
        // Merely mentioned, not the scene: drop the frame, keep watching.
        if (photoUri) deletePhoto(photoUri);
        this.opts.callbacks?.onPrivacySkip?.(privacy.mention);
        return;
      }

      const scenarios = this.opts.getScenarios();
      const recent = await listEvents(50);
      const decision = decideTriage(
        result,
        recent,
        scenarioTrackedNames(scenarios),
        now,
      );
      if (decision.action === 'delete') {
        if (photoUri) deletePhoto(photoUri);
        return;
      }

      let keptUri: string | null = null;
      if (decision.action === 'keep' && photoUri) {
        keptUri = await keepPhoto(photoUri, now);
      } else if (photoUri) {
        deletePhoto(photoUri);
      }

      const event = await insertEvent({
        ts: now,
        kind: 'scene',
        caption: result.caption,
        objects: result.objects,
        tags: result.tags,
        photoUri: keptUri,
      });
      this.opts.callbacks?.onEvent?.(event);

      const history = (await listEvents(200)).sort((a, b) => a.ts - b.ts);
      for (const alert of evaluateScenarios(history, scenarios, now)) {
        if (this.firedAlerts.has(alert.id)) continue;
        this.firedAlerts.add(alert.id);
        this.opts.callbacks?.onAlert?.(alert);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.opts.callbacks?.onError?.(message);
      this.stop('error', message);
    } finally {
      this.busy = false;
    }
  }
}
