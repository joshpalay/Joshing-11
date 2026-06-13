import { describe, expect, it } from 'vitest';

import {
  type DomainAggregateRow,
  deriveExpandingDomains,
  mergeDomainStats,
} from '@/server/db/queries/knowledge';

// These cover the pure JS side of the SQL-aggregation refactor: the per-domain
// GROUP BY rows are merged by domainKey() (which SQL can't replicate) before the
// page consumes them. The DB-side FILTER/GROUP BY math is exercised by the live
// query; here we pin the merge + momentum semantics.

const DAY = 24 * 60 * 60 * 1000;
const ago = (days: number) => new Date(Date.now() - days * DAY);

function aggregate(overrides: Partial<DomainAggregateRow> & { canonicalSubcategory: string }): DomainAggregateRow {
  return {
    answered: 0,
    correct: 0,
    lastAnsweredAt: null,
    demonstrated: false,
    firstAt: null,
    latestAt: null,
    recentAnswered: 0,
    recentPoints: 0,
    wrongAnswers: 0,
    socialEvents: 0,
    savedEvents: 0,
    ...overrides,
  };
}

describe('mergeDomainStats', () => {
  it('folds rows that share a domainKey, summing counts and taking the latest activity', () => {
    const older = ago(5);
    const newer = ago(1);
    const { statsByDomain } = mergeDomainStats([
      aggregate({ canonicalSubcategory: 'Jazz', answered: 3, correct: 2, lastAnsweredAt: older }),
      aggregate({ canonicalSubcategory: 'jazz', answered: 1, correct: 1, lastAnsweredAt: newer }),
    ]);

    expect(statsByDomain.size).toBe(1);
    const stats = statsByDomain.get('jazz');
    expect(stats).toMatchObject({ answered: 4, correct: 3 });
    expect(stats?.lastActivityAt?.getTime()).toBe(newer.getTime());
  });

  it('omits domains with no answered events but still records demonstrated', () => {
    const { statsByDomain, demonstratedDomains, demonstratedLabels } = mergeDomainStats([
      aggregate({ canonicalSubcategory: 'Heraldry', answered: 0, demonstrated: true }),
    ]);

    expect(statsByDomain.has('heraldry')).toBe(false);
    expect(demonstratedDomains.has('heraldry')).toBe(true);
    expect(demonstratedLabels.get('heraldry')).toBe('Heraldry');
  });

  it('coerces string counts from pg', () => {
    const { statsByDomain } = mergeDomainStats([
      aggregate({
        canonicalSubcategory: 'Opera',
        answered: '5' as unknown as number,
        correct: '4' as unknown as number,
      }),
    ]);
    expect(statsByDomain.get('opera')).toMatchObject({ answered: 5, correct: 4 });
  });
});

describe('deriveExpandingDomains', () => {
  it('scores a freshly-opened domain as a new discovery', () => {
    const [top] = deriveExpandingDomains([
      aggregate({
        canonicalSubcategory: 'Weimar Cinema',
        firstAt: ago(1),
        latestAt: ago(1),
        recentAnswered: 2,
        recentPoints: 12,
      }),
    ]);
    expect(top.domain).toBe('Weimar Cinema');
    expect(top.reason).toBe('new-discovery');
    expect(top.momentumScore).toBeGreaterThan(0);
  });

  it('collapses same-key rows into one entry', () => {
    const result = deriveExpandingDomains([
      aggregate({ canonicalSubcategory: 'Bebop', firstAt: ago(2), latestAt: ago(2), recentAnswered: 1 }),
      aggregate({ canonicalSubcategory: 'bebop', firstAt: ago(40), latestAt: ago(1), recentAnswered: 1 }),
    ]);
    expect(result).toHaveLength(1);
    // firstAt folds to the older (40d ago) so novelty is off; recent activity keeps it surfaced.
    expect(result[0].reason).not.toBe('new-discovery');
    expect(result[0].momentumScore).toBeGreaterThan(0);
  });

  it('drops stale domains with no recent momentum and caps at five', () => {
    const stale = aggregate({ canonicalSubcategory: 'Dormant', firstAt: ago(120), latestAt: ago(90) });
    const live = Array.from({ length: 7 }, (_, i) =>
      aggregate({ canonicalSubcategory: `Live ${i}`, firstAt: ago(3), latestAt: ago(1), recentAnswered: 3 }),
    );
    const result = deriveExpandingDomains([stale, ...live]);
    expect(result.length).toBe(5);
    expect(result.some((d) => d.domain === 'Dormant')).toBe(false);
  });
});
