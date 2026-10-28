import type { VisionResult } from '../types';
import type { VisionProvider } from './provider';

// Deterministic offline "day" used until a real vision endpoint is
// configured. It exercises every Memory mode behavior: tracked-object
// sighting, duplicate suppression, exit-without-keys alert, privacy stop.

const SCRIPT: VisionResult[] = [
  {
    caption: 'Empty kitchen counter',
    objects: [],
    tags: ['indoor', 'kitchen'],
    importance: 0.1,
  },
  {
    // Leaving before keys were ever seen — the default exit-check
    // scenario must alert here.
    caption: 'Front door, leaving the house',
    objects: [],
    tags: ['exit', 'front-door'],
    importance: 0.3,
  },
  {
    caption: 'Keys on the dining table',
    objects: [{ name: 'keys', place: 'dining table', confidence: 0.96 }],
    tags: ['indoor', 'dining-room'],
    importance: 0.95,
  },
  {
    // Same scene again — triage must treat this as a duplicate.
    caption: 'Keys on the dining table',
    objects: [{ name: 'keys', place: 'dining table', confidence: 0.95 }],
    tags: ['indoor', 'dining-room'],
    importance: 0.95,
  },
  {
    caption: 'Wallet on the couch',
    objects: [{ name: 'wallet', place: 'couch', confidence: 0.9 }],
    tags: ['indoor', 'living-room'],
    importance: 0.8,
  },
  {
    caption: 'Living room, television on',
    objects: [],
    tags: ['indoor', 'living-room'],
    importance: 0.2,
  },
  {
    // Privacy gate demo — capture must stop and no photo may be kept.
    caption: 'Restroom doorway',
    objects: [],
    tags: ['restroom'],
    importance: 0,
  },
];

export class MockVisionProvider implements VisionProvider {
  private index = 0;

  async analyze(_photoUri: string | null): Promise<VisionResult> {
    const result = SCRIPT[this.index % SCRIPT.length];
    this.index += 1;
    return result;
  }
}
