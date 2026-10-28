import { describe, expect, it } from '@jest/globals';
import {
  answerWhere,
  checklistProgress,
  evaluateScenarios,
  findLastSeen,
  scenarioTrackedNames,
} from '../scenarios';
import type { MemoryEvent, Scenario } from '../types';

const T0 = 1_700_000_000_000;

function event(partial: Partial<MemoryEvent>): MemoryEvent {
  return {
    id: 1,
    ts: T0,
    kind: 'scene',
    caption: '',
    objects: [],
    tags: [],
    photoUri: null,
    ...partial,
  };
}

const EXIT_CHECK: Scenario = {
  id: 'exit-keys',
  kind: 'exit-check',
  object: 'keys',
  label: "Don't let me leave without my keys",
  windowMinutes: 60,
};

describe('findLastSeen / answerWhere', () => {
  const events = [
    event({
      id: 1,
      ts: T0,
      caption: 'Keys on the dining table',
      objects: [{ name: 'keys', place: 'dining table', confidence: 0.95 }],
    }),
    event({ id: 2, ts: T0 + 60_000, caption: 'Empty hallway' }),
  ];

  it('finds the last sighting', () => {
    expect(findLastSeen(events, 'keys')?.id).toBe(1);
  });

  it('answers where in natural language', () => {
    const text = answerWhere(events, 'keys', () => '6:02 PM');
    expect(text).toBe('I saw your keys on the dining table at 6:02 PM.');
  });

  it('admits when the object was never seen', () => {
    expect(answerWhere(events, 'passport')).toContain("haven't seen");
  });
});

describe('evaluateScenarios', () => {
  it('alerts when leaving without the required object', () => {
    const events = [
      event({ id: 7, ts: T0, caption: 'Front door', tags: ['exit', 'front-door'] }),
    ];
    const alerts = evaluateScenarios(events, [EXIT_CHECK], T0);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].message).toContain('keys');
  });

  it('stays quiet when the object was seen before leaving', () => {
    const events = [
      event({
        id: 1,
        ts: T0,
        objects: [{ name: 'keys', place: 'hook', confidence: 0.9 }],
      }),
      event({ id: 2, ts: T0 + 5 * 60_000, tags: ['exit'] }),
    ];
    expect(evaluateScenarios(events, [EXIT_CHECK], T0)).toHaveLength(0);
  });

  it('alerts when the sighting is older than the window', () => {
    const events = [
      event({
        id: 1,
        ts: T0,
        objects: [{ name: 'keys', place: 'hook', confidence: 0.9 }],
      }),
      event({ id: 2, ts: T0 + 3 * 60 * 60_000, tags: ['car-door'] }),
    ];
    expect(evaluateScenarios(events, [EXIT_CHECK], T0)).toHaveLength(1);
  });
});

const REQUIREMENT_TEETH: Scenario = {
  id: 'req-teeth',
  kind: 'requirement',
  requirement: 'brushed teeth',
  label: "Don't let me leave before I've brushed my teeth",
  windowMinutes: 120,
};

describe('requirement scenarios', () => {
  it('is satisfied by a matching vision tag (action evidence)', () => {
    const events = [
      event({ id: 1, ts: T0, tags: ['bathroom', 'brushed-teeth'] }),
      event({ id: 2, ts: T0 + 10 * 60_000, tags: ['exit'] }),
    ];
    expect(evaluateScenarios(events, [REQUIREMENT_TEETH], T0)).toHaveLength(0);
  });

  it('alerts when the action was never evidenced', () => {
    const events = [
      event({ id: 7, ts: T0, caption: 'Front door', tags: ['exit'] }),
    ];
    const alerts = evaluateScenarios(events, [REQUIREMENT_TEETH], T0);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].message).toContain('brushed teeth');
  });

  it('is satisfied by an object sighting for object requirements', () => {
    const req: Scenario = {
      id: 'req-keys',
      kind: 'requirement',
      requirement: 'keys',
      label: 'Need keys',
      windowMinutes: 60,
    };
    const events = [
      event({
        id: 1,
        ts: T0,
        objects: [{ name: 'keys', place: 'hook', confidence: 0.9 }],
      }),
      event({ id: 2, ts: T0 + 5 * 60_000, tags: ['exit'] }),
    ];
    expect(evaluateScenarios(events, [req], T0)).toHaveLength(0);
  });
});

const GIG_KIT: Scenario = {
  id: 'gig',
  kind: 'checklist',
  title: 'Gig kit',
  items: ['guitar', 'cable'],
  label: 'Gig kit',
};

describe('checklist scenarios', () => {
  it('tracks seen and held progress per item', () => {
    const events = [
      event({
        id: 1,
        ts: T0,
        objects: [{ name: 'guitar', place: 'hand', confidence: 0.9 }],
      }),
      event({
        id: 2,
        ts: T0 + 60_000,
        objects: [{ name: 'cable', place: 'table', confidence: 0.9 }],
      }),
    ];
    const progress = checklistProgress(events, GIG_KIT);
    expect(progress[0]).toMatchObject({ item: 'guitar', seen: true, held: true });
    expect(progress[1]).toMatchObject({ item: 'cable', seen: true, held: false });
  });

  it('alerts per missing item on exit', () => {
    const events = [
      event({ id: 9, ts: T0, tags: ['exit', 'front-door'] }),
    ];
    const alerts = evaluateScenarios(events, [GIG_KIT], T0);
    expect(alerts).toHaveLength(2);
    expect(alerts.map((a) => a.message).join(' ')).toContain('guitar');
  });

  it('alerts that an item never made it to the cart at checkout', () => {
    const events = [
      event({
        id: 1,
        ts: T0,
        objects: [{ name: 'guitar', place: 'cart', confidence: 0.9 }],
      }),
      event({ id: 2, ts: T0 + 60_000, tags: ['checkout'] }),
    ];
    const alerts = evaluateScenarios(events, [GIG_KIT], T0);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].message).toContain('cable');
    expect(alerts[0].message).toContain('cart');
  });
});

describe('scenarioTrackedNames', () => {
  it('collects names from every scenario kind', () => {
    const names = scenarioTrackedNames([
      EXIT_CHECK,
      REQUIREMENT_TEETH,
      GIG_KIT,
      { id: 'r', kind: 'remember-object', object: 'wallet', label: 'Track' },
    ]);
    expect(names).toEqual(
      expect.arrayContaining(['keys', 'brushed teeth', 'guitar', 'cable', 'wallet']),
    );
  });
});
