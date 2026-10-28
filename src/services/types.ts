// Shared types for the Memory Lens capture pipeline.

export interface SeenObject {
  /** Normalized object name, e.g. "keys", "wallet", "phone". */
  name: string;
  /** Where the object was seen, e.g. "dining table". Null if unknown. */
  place: string | null;
  /** Model confidence 0..1. */
  confidence: number;
}

/** One AI interpretation of a captured frame. */
export interface VisionResult {
  /** Human-readable description, e.g. "Keys on the dining table". */
  caption: string;
  objects: SeenObject[];
  /**
   * Scene tags used by privacy and scenario rules.
   * Examples: "indoor", "exit", "front-door", "car-door", "restroom".
   */
  tags: string[];
  /** 0..1 — how important this frame is as a long-term memory. */
  importance: number;
}

export type PhotoAction = 'keep' | 'text-only' | 'delete';

/** Where frames come from. The engine is identical for every source. */
export type CaptureSource =
  | 'phone'
  | 'glasses'
  | 'robot'
  | 'simulation'
  | 'meta';

/** A stored memory. The physical photo exists only when photoUri is set. */
export interface MemoryEvent {
  /** Database row id, or 0 before insert. */
  id: number;
  /** Epoch milliseconds. */
  ts: number;
  kind: 'scene' | 'privacy-stop' | 'audio';
  caption: string;
  objects: SeenObject[];
  tags: string[];
  /** Kept photo location. Null means text-only memory (photo deleted). */
  photoUri: string | null;
  /** Kept audio location for mic memories. Null means text-only. */
  audioUri?: string | null;
}

export type Scenario =
  | {
      id: string;
      kind: 'remember-object';
      /** Object to track, e.g. "keys". */
      object: string;
      label: string;
    }
  | {
      id: string;
      kind: 'exit-check';
      /** Object that must be seen before leaving, e.g. "keys". */
      object: string;
      label: string;
      /** How far back (minutes) the object must have been seen. */
      windowMinutes: number;
    }
  | {
      id: string;
      kind: 'requirement';
      /**
       * Object ("keys") or action ("brushed teeth") that must be evidenced
       * before leaving. Evidence is an object sighting or a matching tag.
       */
      requirement: string;
      label: string;
      /** How far back (minutes) the evidence must have been seen. */
      windowMinutes: number;
    }
  | {
      id: string;
      kind: 'checklist';
      /** List name, e.g. "Gig kit" or "Groceries". */
      title: string;
      /** Item names; each is checked off when seen (ideally in hand/cart). */
      items: string[];
      label: string;
    };

/** Live progress for one checklist item. */
export interface ChecklistItemProgress {
  item: string;
  /** Seen in any frame. */
  seen: boolean;
  /** Seen in hand, cart, basket, or bag (place or tag evidence). */
  held: boolean;
  /** Epoch ms of the latest sighting, or null when never seen. */
  lastSeenTs: number | null;
}

/** One step of a guided build (IKEA/LEGO-style project). */
export interface ProjectStep {
  title: string;
  parts: string[];
  instruction: string;
}

/** A full guided-build plan parsed from an instruction sheet. */
export interface ProjectPlan {
  title: string;
  steps: ProjectStep[];
}

export type StepVerdict = 'complete' | 'mistake' | 'unclear';

/** Vision verdict for the current project step. Confidence is 0..1. */
export interface StepCheck {
  verdict: StepVerdict;
  detail: string;
  confidence: number;
}

export interface ScenarioAlert {
  /** Stable id so the same exit event never alerts twice. */
  id: string;
  ts: number;
  message: string;
}
