import { describe, expect, it } from 'vitest';

import { groupItemsByRecency } from '@/components/feed/visual';

const NOW = Date.parse('2026-05-17T18:00:00.000Z');

function itemAt(id: string, msAgo: number): { id: string; source_event_at: string } {
  return { id, source_event_at: new Date(NOW - msAgo).toISOString() };
}

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

describe('groupItemsByRecency', () => {
  it('returns empty array for empty input', () => {
    expect(groupItemsByRecency([], NOW)).toEqual([]);
  });

  it('emits a single short-tail group for one fresh item', () => {
    const groups = groupItemsByRecency([itemAt('a', HOUR)], NOW);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.key).toBe('past-few-hours');
    expect(groups[0]!.items.map((i) => i.id)).toEqual(['a']);
  });

  it('groups the spec example into Today / This week / Past few weeks', () => {
    const items = [
      ...Array.from({ length: 7 }, (_, i) => itemAt(`today-${i}`, 6 * HOUR + i * HOUR)),
      ...Array.from({ length: 5 }, (_, i) => itemAt(`week-${i}`, 2 * DAY + i * DAY)),
      ...Array.from({ length: 3 }, (_, i) => itemAt(`old-${i}`, 20 * DAY + i * HOUR)),
    ];

    const groups = groupItemsByRecency(items, NOW);

    expect(groups.map((g) => ({ key: g.key, count: g.items.length }))).toEqual([
      { key: 'today', count: 7 },
      { key: 'this-week', count: 5 },
      { key: 'past-few-weeks', count: 3 },
    ]);
  });

  it('puts very old items in Older', () => {
    const items = Array.from({ length: 10 }, (_, i) => itemAt(`x-${i}`, 100 * DAY + i * HOUR));
    const groups = groupItemsByRecency(items, NOW);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.key).toBe('older');
    expect(groups[0]!.items).toHaveLength(10);
  });

  it('emits one Past few hours group when all items fit there', () => {
    const items = Array.from({ length: 6 }, (_, i) =>
      itemAt(`fresh-${i}`, (i + 1) * 10 * 60 * 1000),
    );
    const groups = groupItemsByRecency(items, NOW);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.key).toBe('past-few-hours');
    expect(groups[0]!.items).toHaveLength(6);
  });

  it('lands invalid timestamps in Older', () => {
    const items = [
      { id: 'good', source_event_at: new Date(NOW - HOUR).toISOString() },
      { id: 'bad', source_event_at: 'not-a-date' },
    ];
    const groups = groupItemsByRecency(items, NOW);
    const badGroup = groups.find((g) => g.items.some((i) => i.id === 'bad'));
    expect(badGroup?.key).toBe('older');
  });

  it('is idempotent when older items are appended (earlier groups stay identical)', () => {
    const fresh = [
      ...Array.from({ length: 7 }, (_, i) => itemAt(`today-${i}`, 6 * HOUR + i * HOUR)),
      ...Array.from({ length: 5 }, (_, i) => itemAt(`week-${i}`, 2 * DAY + i * DAY)),
    ];
    const before = groupItemsByRecency(fresh, NOW);
    const after = groupItemsByRecency(
      [...fresh, ...Array.from({ length: 3 }, (_, i) => itemAt(`old-${i}`, 20 * DAY + i * HOUR))],
      NOW,
    );

    expect(
      after.slice(0, before.length).map((g) => ({ key: g.key, ids: g.items.map((i) => i.id) })),
    ).toEqual(before.map((g) => ({ key: g.key, ids: g.items.map((i) => i.id) })));
    expect(after[after.length - 1]!.key).toBe('past-few-weeks');
  });
});
