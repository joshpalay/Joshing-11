import { describe, expect, it } from 'vitest';

import { assignCaption, bucketMoments, formatMomentTime } from '@/lib/lately';
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
    gameId: 'g-1',
    gameTitle: 'asterisk',
    ...overrides,
  };
}

describe('assignCaption', () => {
  it('returns a caption from the they_got_you pool when dir is they_got_you', () => {
    const pool = new Set([
      'THEY KNEW YOU',
      'ROBYN GOT IT',
      'THEY SAW IT',
      'A MATCH',
      'ON YOUR FREQUENCY',
    ]);
    const caption = assignCaption('any-id', 'they_got_you', 'Robyn');
    expect(pool.has(caption)).toBe(true);
  });

  it('returns a caption from the you_got_them pool when dir is you_got_them', () => {
    const pool = new Set([
      'YOU KNEW THEM',
      'YOU SAW IT',
      'YOU NAILED IT',
      'A MATCH',
      'ON THEIR FREQUENCY',
    ]);
    const caption = assignCaption('any-id', 'you_got_them', 'Robyn');
    expect(pool.has(caption)).toBe(true);
  });

  it('is deterministic across calls', () => {
    expect(assignCaption('stable-id', 'they_got_you', 'Robyn'))
      .toBe(assignCaption('stable-id', 'they_got_you', 'Robyn'));
  });

  it('substitutes the friend first name (uppercase) into the {NAME} slot', () => {
    // Find an id that lands on the {NAME} template (pool index 1).
    let id = 'x';
    for (let i = 0; i < 200; i++) {
      const c = assignCaption(`probe-${i}`, 'they_got_you', 'jamie');
      if (c === 'JAMIE GOT IT') {
        id = `probe-${i}`;
        break;
      }
    }
    expect(assignCaption(id, 'they_got_you', 'jamie')).toBe('JAMIE GOT IT');
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
