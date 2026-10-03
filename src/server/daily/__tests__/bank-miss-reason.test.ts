import { beforeAll, describe, expect, it } from 'vitest';

// queries/daily.ts imports @/server/db, which throws at module load without a
// connection string. bankMissReasonFromCounts is pure; a dummy URL plus dynamic
// import (the repo convention) keeps the unit pure.
//
// Regression for the A0 telemetry mislabel: missReason used to be
// `ladder.length > 1 ? 'tier' : 'no_stock'`, so every declared-domain miss read
// as a difficulty problem and 'fact_history' was never recorded. A 2026-10-03
// re-check of 213 misses against the bank found ~30% were answered-out topics
// and ~15% empty ones hiding under that label.
let bankMissReasonFromCounts: typeof import('@/server/db/queries/daily').bankMissReasonFromCounts;

beforeAll(async () => {
  process.env.DATABASE_URL ??= 'postgres://user:pass@localhost:5432/joshing_test';
  ({ bankMissReasonFromCounts } = await import('@/server/db/queries/daily'));
});

const HARD_LADDER = ['specialist', 'moderate'] as const;

describe('bankMissReasonFromCounts', () => {
  it('no stock at any tier is no_stock, whatever the ladder', () => {
    expect(bankMissReasonFromCounts([], HARD_LADDER)).toBe('no_stock');
    expect(
      bankMissReasonFromCounts([{ tier: 'accessible', total: 0, unanswered: 0 }], HARD_LADDER),
    ).toBe('no_stock');
  });

  it('stock the viewer has answered all of is fact_history, not tier', () => {
    expect(
      bankMissReasonFromCounts(
        [
          { tier: 'accessible', total: 4, unanswered: 0 },
          { tier: 'specialist', total: 2, unanswered: 0 },
        ],
        HARD_LADDER,
      ),
    ).toBe('fact_history');
  });

  it('unanswered stock only off the ladder is tier (the Wagner case: hard asked, only easy left)', () => {
    expect(
      bankMissReasonFromCounts(
        [
          { tier: 'accessible', total: 3, unanswered: 3 },
          { tier: 'specialist', total: 5, unanswered: 0 },
        ],
        HARD_LADDER,
      ),
    ).toBe('tier');
  });

  it('unanswered stock ON the ladder that still missed is filtered', () => {
    expect(
      bankMissReasonFromCounts([{ tier: 'moderate', total: 2, unanswered: 1 }], HARD_LADDER),
    ).toBe('filtered');
  });

  it('an exact-tier-only ladder treats adjacent stock as tier, not no_stock', () => {
    // Domains with no floor get a one-rung ladder; the old rule called every
    // such miss no_stock even when the bank held plenty one step away.
    expect(
      bankMissReasonFromCounts([{ tier: 'moderate', total: 3, unanswered: 3 }], ['accessible']),
    ).toBe('tier');
  });
});
