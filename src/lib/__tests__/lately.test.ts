import { describe, expect, it } from 'vitest';

import {
  assignCaption,
  bucketMoments,
  formatMomentTime,
  partitionPinnedRequests,
  THEY_GOT_YOU_CAPTIONS,
  YOU_GOT_THEM_CAPTIONS,
} from '@/lib/lately';
import type { LatelyMoment } from '@/server/db/queries/lately';

function moment(overrides: Partial<LatelyMoment> & { answeredAt: Date }): LatelyMoment {
  return {
    momentId: 'm-1',
    dir: 'they_got_you',
    friendId: 'u-1',
    friendName: 'Robyn',
    friendFirstName: 'Robyn',
    questionId: 'q-1',
    questionText: 'q?',
    category: 'a category',
    gameTitle: 'asterisk',
    ...overrides,
  };
}

describe('assignCaption', () => {
  function expandPool(pool: readonly string[], name: string): Set<string> {
    return new Set(pool.map((t) => t.replace('{NAME}', name.toUpperCase())));
  }

  it('picks from the they_got_you pool for that direction', () => {
    const pool = expandPool(THEY_GOT_YOU_CAPTIONS, 'Robyn');
    expect(pool.has(assignCaption('any-id', 'they_got_you', 'Robyn'))).toBe(true);
  });

  it('picks from the you_got_them pool for that direction', () => {
    const pool = expandPool(YOU_GOT_THEM_CAPTIONS, 'Jamie');
    expect(pool.has(assignCaption('any-id', 'you_got_them', 'Jamie'))).toBe(true);
  });

  it('substitutes the friend first name (uppercased) for the {NAME} token', () => {
    // Find an id that hashes to the {NAME} template in the they_got_you pool.
    const target = THEY_GOT_YOU_CAPTIONS.indexOf('{NAME} GOT IT');
    expect(target).toBeGreaterThanOrEqual(0);
    for (let i = 0; i < 100; i++) {
      const id = `probe-${i}`;
      const result = assignCaption(id, 'they_got_you', 'Robyn');
      if (result === 'ROBYN GOT IT') return; // pass
    }
    throw new Error('Never sampled the {NAME} template');
  });

  it('is deterministic across calls for the same momentId + direction', () => {
    expect(assignCaption('stable-id', 'they_got_you', 'Robyn')).toBe(
      assignCaption('stable-id', 'they_got_you', 'Robyn'),
    );
  });

  it('distributes across the pool over many ids', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 30; i++) {
      seen.add(assignCaption(`probe-${i}`, 'they_got_you', 'Robyn'));
    }
    expect(seen.size).toBeGreaterThanOrEqual(3);
  });
});

describe('bucketMoments', () => {
  const tz = 'America/New_York';
  const now = new Date('2026-05-23T20:00:00.000Z'); // 4pm ET

  it('places same-day moments in TODAY', () => {
    const m = moment({ answeredAt: new Date('2026-05-23T18:14:00.000Z') });
    const buckets = bucketMoments([m], tz, now);
    expect(buckets).toHaveLength(1);
    expect(buckets[0].label).toBe('TODAY');
    expect(buckets[0].items).toEqual([m]);
  });

  it('places previous-day moments in YESTERDAY', () => {
    const m = moment({ momentId: 'm-2', answeredAt: new Date('2026-05-22T20:00:00.000Z') });
    const buckets = bucketMoments([m], tz, now);
    expect(buckets).toHaveLength(1);
    expect(buckets[0].label).toBe('YESTERDAY');
  });

  it('places 2–7-day-old moments in EARLIER THIS WEEK', () => {
    const m = moment({ momentId: 'm-3', answeredAt: new Date('2026-05-19T20:00:00.000Z') });
    const buckets = bucketMoments([m], tz, now);
    expect(buckets).toHaveLength(1);
    expect(buckets[0].label).toBe('EARLIER THIS WEEK');
  });

  it('drops moments older than 7 days', () => {
    const m = moment({ momentId: 'm-4', answeredAt: new Date('2026-05-10T20:00:00.000Z') });
    const buckets = bucketMoments([m], tz, now);
    expect(buckets).toHaveLength(0);
  });

  it('orders buckets TODAY → YESTERDAY → EARLIER and only includes buckets with items', () => {
    const today = moment({ momentId: 't', answeredAt: new Date('2026-05-23T18:00:00.000Z') });
    const earlier = moment({ momentId: 'e', answeredAt: new Date('2026-05-20T18:00:00.000Z') });
    const buckets = bucketMoments([today, earlier], tz, now);
    expect(buckets.map((b) => b.label)).toEqual(['TODAY', 'EARLIER THIS WEEK']);
  });
});

describe('formatMomentTime', () => {
  const tz = 'America/New_York';

  it('renders 12-hour time for TODAY', () => {
    const out = formatMomentTime(new Date('2026-05-23T18:14:00.000Z'), 'TODAY', tz);
    expect(out).toMatch(/2:14\s?PM/);
  });

  it('renders weekday + 24-hour time for EARLIER THIS WEEK', () => {
    const out = formatMomentTime(new Date('2026-05-19T13:20:00.000Z'), 'EARLIER THIS WEEK', tz);
    expect(out).toMatch(/^TUE\s+9:20$/);
  });
});

describe('partitionPinnedRequests', () => {
  type Row = { id: string; sortAt: Date; action?: { kind: string } | null };
  const req = (id: string, sortAt: string): Row => ({
    id,
    sortAt: new Date(sortAt),
    action: { kind: 'friend_request' },
  });
  const other = (id: string, sortAt: string, kind?: string): Row => ({
    id,
    sortAt: new Date(sortAt),
    action: kind ? { kind } : null,
  });

  it('pins only rows carrying the friend_request action', () => {
    const { pinned, rest } = partitionPinnedRequests([
      req('r1', '2026-05-20T10:00:00.000Z'),
      other('m1', '2026-05-23T10:00:00.000Z'),
      other('l1', '2026-05-22T10:00:00.000Z', 'link'),
    ]);
    expect(pinned.map((i) => i.id)).toEqual(['r1']);
    expect(rest.map((i) => i.id)).toEqual(['m1', 'l1']);
  });

  it('orders pinned requests newest-first regardless of incoming order', () => {
    const { pinned } = partitionPinnedRequests([
      req('old', '2026-05-18T10:00:00.000Z'),
      req('new', '2026-05-24T10:00:00.000Z'),
      req('mid', '2026-05-21T10:00:00.000Z'),
    ]);
    expect(pinned.map((i) => i.id)).toEqual(['new', 'mid', 'old']);
  });

  it('keeps the non-pinned rows in their incoming (prominence) order', () => {
    const incoming = [
      other('a', '2026-05-20T10:00:00.000Z'),
      other('b', '2026-05-24T10:00:00.000Z'),
    ];
    const { rest } = partitionPinnedRequests(incoming);
    // Not re-sorted by recency — 'a' stays first even though 'b' is newer.
    expect(rest.map((i) => i.id)).toEqual(['a', 'b']);
  });
});
