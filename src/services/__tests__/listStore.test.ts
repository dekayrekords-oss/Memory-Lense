import { describe, expect, it } from '@jest/globals';
import { parseAlertItem, parseWatchItem } from '../listStore';

describe('parseWatchItem', () => {
  it('round-trips each scenario kind', () => {
    expect(
      parseWatchItem({
        id: 'a',
        kind: 'remember-object',
        object: 'keys',
        label: 'Track my keys',
      }),
    ).toMatchObject({ kind: 'remember-object', object: 'keys' });
    expect(
      parseWatchItem({
        id: 'b',
        kind: 'exit-check',
        object: 'phone',
        label: 'x',
        windowMinutes: 30,
      }),
    ).toMatchObject({ kind: 'exit-check', windowMinutes: 30 });
    expect(
      parseWatchItem({
        id: 'c',
        kind: 'requirement',
        requirement: 'took meds',
        label: 'x',
      }),
    ).toMatchObject({ kind: 'requirement', windowMinutes: 120 });
    expect(
      parseWatchItem({
        id: 'd',
        kind: 'checklist',
        title: 'Gig kit',
        items: ['guitar', 42, 'cable'],
        label: 'Gig kit',
      }),
    ).toEqual({
      id: 'd',
      kind: 'checklist',
      title: 'Gig kit',
      items: ['guitar', 'cable'],
      label: 'Gig kit',
    });
  });

  it('defaults missing windows and rejects junk', () => {
    expect(
      parseWatchItem({ id: 'e', kind: 'exit-check', object: 'keys', label: 'x' }),
    ).toMatchObject({ windowMinutes: 60 });
    expect(parseWatchItem(null)).toBeNull();
    expect(parseWatchItem('keys')).toBeNull();
    expect(parseWatchItem({ kind: 'nope', id: 'x', label: 'y' })).toBeNull();
    expect(
      parseWatchItem({ kind: 'remember-object', id: 'x', label: 'y' }),
    ).toBeNull();
  });
});

describe('parseAlertItem', () => {
  it('keeps valid alerts and rejects junk', () => {
    expect(parseAlertItem({ id: 'a', ts: 5, message: 'keys!' })).toEqual({
      id: 'a',
      ts: 5,
      message: 'keys!',
    });
    expect(parseAlertItem({ id: 'a', ts: '5', message: 'x' })).toBeNull();
    expect(parseAlertItem(null)).toBeNull();
  });
});
