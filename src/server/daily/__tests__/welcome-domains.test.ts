import { describe, expect, it } from 'vitest';

import { selectWelcomeDomains, WELCOME_WINDOW_DAYS } from '@/server/daily/welcome-domains';

const NOW = new Date('2026-10-01T17:00:00Z');
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000);

describe('selectWelcomeDomains', () => {
  it('leads with newly added, not-yet-asked areas, newest first', () => {
    const declared = [
      { domain: 'Modern Art', declaredAt: daysAgo(6) },
      { domain: 'Franz Kafka', declaredAt: daysAgo(0.5) },
      { domain: '1980s Cartoons', declaredAt: daysAgo(0.4) },
    ];
    const eligible = ['Beethoven', 'Modern Art', 'Franz Kafka', '1980s Cartoons'];
    expect(selectWelcomeDomains(declared, eligible, new Map(), NOW)).toEqual([
      '1980s Cartoons',
      'Franz Kafka',
    ]);
  });

  it('skips areas already asked this week, older than the window, or not eligible', () => {
    const declared = [
      { domain: 'Popular Movies', declaredAt: daysAgo(1) }, // already asked
      { domain: 'Western Music Theory', declaredAt: daysAgo(WELCOME_WINDOW_DAYS + 1) }, // too old
      { domain: 'Piano Music', declaredAt: daysAgo(2) }, // resting → not eligible
      { domain: 'Modern Art', declaredAt: daysAgo(3) },
    ];
    const eligible = ['Popular Movies', 'Western Music Theory', 'Modern Art'];
    const recent = new Map([['popular movies', 2]]);
    expect(selectWelcomeDomains(declared, eligible, recent, NOW)).toEqual(['Modern Art']);
  });

  it('returns the knowledge-base spelling and respects max', () => {
    const declared = [{ domain: "1990’s Television Shows", declaredAt: daysAgo(1) }];
    const eligible = ["1990's Television Shows"];
    expect(selectWelcomeDomains(declared, eligible, new Map(), NOW)).toEqual([
      "1990's Television Shows",
    ]);
    expect(selectWelcomeDomains(declared, eligible, new Map(), NOW, 0)).toEqual([]);
  });
});
