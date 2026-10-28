import { describe, expect, it } from '@jest/globals';
import {
  dayStartMs,
  eventsOnDay,
  exportMemoriesAsText,
  keptPhotoRefs,
  selectExpiredPhotos,
  selectPhotosToEvict,
  wipeDaySelection,
} from '../retention';
import type { MemoryEvent } from '../types';

function event(partial: Partial<MemoryEvent>): MemoryEvent {
  return {
    id: 1,
    ts: 1_700_000_000_000,
    kind: 'scene',
    caption: '',
    objects: [],
    tags: [],
    photoUri: null,
    ...partial,
  };
}

// Noon local on two adjacent days, so day boundaries never depend on UTC.
function noon(dayOffset: number): number {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  return d.getTime() + dayOffset * 24 * 60 * 60 * 1000;
}

describe('dayStartMs / eventsOnDay', () => {
  it('groups events by local day', () => {
    const today = noon(0);
    const yesterday = noon(-1);
    const events = [
      event({ id: 1, ts: today }),
      event({ id: 2, ts: today + 60_000 }),
      event({ id: 3, ts: yesterday }),
    ];
    expect(eventsOnDay(events, today).map((e) => e.id)).toEqual([1, 2]);
    expect(dayStartMs(today + 3_600_000)).toBe(dayStartMs(today));
  });
});

describe('wipeDaySelection', () => {
  it('selects only that day’s rows and their photos', () => {
    const today = noon(0);
    const events = [
      event({ id: 1, ts: today, photoUri: 'file:///a.jpg' }),
      event({ id: 2, ts: today + 1, photoUri: null }),
      event({ id: 3, ts: noon(-1), photoUri: 'file:///old.jpg' }),
    ];
    expect(wipeDaySelection(events, today)).toEqual({
      ids: [1, 2],
      photoUris: ['file:///a.jpg'],
    });
  });
});

describe('keptPhotoRefs / selectPhotosToEvict', () => {
  const events = [
    event({ id: 1, ts: 1000, photoUri: 'file:///old.jpg' }),
    event({ id: 2, ts: 2000, photoUri: null }),
    event({ id: 3, ts: 3000, photoUri: 'file:///new.jpg' }),
  ];

  it('lists kept photos oldest first', () => {
    expect(keptPhotoRefs(events)).toEqual([
      { uri: 'file:///old.jpg', ts: 1000 },
      { uri: 'file:///new.jpg', ts: 3000 },
    ]);
  });

  it('evicts oldest first down to the quota', () => {
    expect(selectPhotosToEvict(keptPhotoRefs(events), 1)).toEqual([
      'file:///old.jpg',
    ]);
  });

  it('evicts nothing when already within quota', () => {
    expect(selectPhotosToEvict(keptPhotoRefs(events), 2)).toEqual([]);
    expect(selectPhotosToEvict(keptPhotoRefs(events), 99)).toEqual([]);
  });

  it('handles an empty library and a zero quota', () => {
    expect(selectPhotosToEvict([], 10)).toEqual([]);
    expect(selectPhotosToEvict(keptPhotoRefs(events), 0)).toEqual([
      'file:///old.jpg',
      'file:///new.jpg',
    ]);
  });
});

describe('selectExpiredPhotos', () => {
  it('selects photos older than the max age, oldest first', () => {
    const photos = [
      { uri: 'file:///a.jpg', ts: 1000 },
      { uri: 'file:///b.jpg', ts: 2000 },
      { uri: 'file:///c.jpg', ts: 9000 },
    ];
    expect(selectExpiredPhotos(photos, 10_000, 5_000)).toEqual([
      'file:///a.jpg',
      'file:///b.jpg',
    ]);
    expect(selectExpiredPhotos(photos, 10_000, 60_000)).toEqual([]);
  });
});

describe('exportMemoriesAsText', () => {
  it('exports oldest first with photo status', () => {
    const events = [
      event({ id: 2, ts: 2000, caption: 'Second', photoUri: 'file:///b.jpg' }),
      event({ id: 1, ts: 1000, caption: 'First', photoUri: null }),
      event({ id: 3, ts: 3000, kind: 'privacy-stop', caption: 'Stopped' }),
    ];
    const text = exportMemoriesAsText(events, (ts) => `t${ts}`);
    expect(text).toBe(
      [
        '- [t1000] First (text only)',
        '- [t2000] Second (photo kept)',
        '- [t3000] Stopped (privacy stop, no photo kept)',
      ].join('\n'),
    );
  });

  it('reports an empty memory store', () => {
    expect(exportMemoriesAsText([])).toBe('No memories yet.');
  });
});
