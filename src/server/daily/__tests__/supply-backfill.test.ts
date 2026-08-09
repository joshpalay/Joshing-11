import { describe, expect, it } from 'vitest';

import { buildPlan, selectWithinBudget } from '@/server/daily/supply-backfill';

// buildPlan is the pure, demand-weighted planning core of the supply backfill.
// These exercise the Layer 4 correctness fix: the buffer is gated on WORST-CASE
// SERVABLE stock (have − own_max), not total inventory, so a domain one heavy
// player mined out (the bank excludes a viewer's own rows) is backfilled instead
// of reading as "stocked" to everyone but them.

const cfg = { daysRunway: 14, bufferFloor: 10, batchCap: 20 };

// A DomainRow literal (the type is module-private; the shape is asserted here).
// Defaults to DRY (consecutive_dry_rounds 5) so the servable-stock tests exercise
// the buffer path; the proven-demand gate is covered explicitly below.
function row(overrides: Partial<Parameters<typeof buildPlan>[0][number]>) {
  return {
    domain_key: 'd',
    sample_label: 'D',
    fandom_host: null,
    effective_est: 1200,
    have: 0,
    own_max: 0,
    consecutive_dry_rounds: 5,
    ...overrides,
  };
}

describe('buildPlan — worst-case servable stock (Layer 4)', () => {
  it('backfills a single-heavy-user domain the total-inventory model called "stocked" (Zelda: TotK)', () => {
    // have 16 but one player owns 13 → they are served only 3. Target 14 (14d × 1
    // interested). Old logic: 16 ≥ 14 → skip. New logic: servable 3 < 14 → batch.
    const [plan] = buildPlan(
      [row({ domain_key: 'zelda', sample_label: 'Zelda: TotK', effective_est: 1200, have: 16, own_max: 13, fandom_host: 'zelda.fandom.com' })],
      new Map([['zelda', 1]]),
      cfg,
    );
    expect(plan.skipReason).toBeNull();
    // gap = 14 − 3 = 11; batch = ceil(11 / 0.85) = 13 (< batchCap 20).
    expect(plan.batch).toBe(13);
    expect(plan.ground).toBe(true); // fandom_host set → grounded generation
    expect(plan.have).toBe(16); // display still shows total inventory
  });

  it('treats own_max = have (one owner) as zero servable → full-buffer batch', () => {
    const [plan] = buildPlan(
      [row({ domain_key: 'solo', have: 8, own_max: 8, effective_est: 500 })],
      new Map([['solo', 1]]),
      cfg,
    );
    // servable 0 → gap 14 → batch = ceil(14 / 0.85) = 17.
    expect(plan.batch).toBe(17);
    expect(plan.skipReason).toBeNull();
  });

  it('still skips a genuinely well-stocked domain (servable ≥ target)', () => {
    const [plan] = buildPlan(
      [row({ domain_key: 'rich', have: 30, own_max: 2, effective_est: 500 })],
      new Map([['rich', 1]]),
      cfg,
    );
    // servable 28 ≥ target 14 → skip, message names servable (not total).
    expect(plan.batch).toBe(0);
    expect(plan.skipReason).toContain('servable 28');
  });

  it('scales the buffer with demand across multiple interested users', () => {
    const [plan] = buildPlan(
      [row({ domain_key: 'pop', have: 30, own_max: 6, effective_est: 500 })],
      new Map([['pop', 3]]),
      cfg,
    );
    // target = clamp(14 × 3, 10, 500) = 42; servable = 24; gap 18 → batch = min(20, 22) = 20.
    expect(plan.batch).toBe(20);
  });

  it('skips a domain with no demand regardless of stock', () => {
    const [plan] = buildPlan([row({ domain_key: 'nobody', have: 0, own_max: 0 })], new Map(), cfg);
    expect(plan.batch).toBe(0);
    expect(plan.skipReason).toBe('no demand (0 declared interests)');
  });

  it('skips an unsized domain (no estimate) even with demand', () => {
    const [plan] = buildPlan(
      [row({ domain_key: 'unsized', effective_est: null, have: 0, own_max: 0 })],
      new Map([['unsized', 5]]),
      cfg,
    );
    expect(plan.batch).toBe(0);
    expect(plan.skipReason).toBe('no estimate');
  });
});

describe('buildPlan — proven-demand (dry) gate (default on)', () => {
  it('skips a declared-but-not-exhausted domain when onlyDry (default)', () => {
    // Servable-short (would get a batch) but never run dry → not worth spend.
    const [plan] = buildPlan(
      [row({ domain_key: 'declared', have: 0, own_max: 0, consecutive_dry_rounds: 0 })],
      new Map([['declared', 1]]),
      cfg, // onlyDry defaults true, dryK defaults 3
    );
    expect(plan.batch).toBe(0);
    expect(plan.skipReason).toContain('not exhausted');
  });

  it('backfills the same domain in predictive mode (onlyDry=false)', () => {
    const [plan] = buildPlan(
      [row({ domain_key: 'declared', have: 0, own_max: 0, consecutive_dry_rounds: 0 })],
      new Map([['declared', 1]]),
      { ...cfg, onlyDry: false },
    );
    expect(plan.batch).toBeGreaterThan(0);
    expect(plan.skipReason).toBeNull();
  });

  it('backfills a proven-dry domain even under the default gate (Zelda: TotK)', () => {
    const [plan] = buildPlan(
      [row({ domain_key: 'zelda', have: 16, own_max: 13, effective_est: 1200, consecutive_dry_rounds: 4, fandom_host: 'zelda.fandom.com' })],
      new Map([['zelda', 1]]),
      cfg,
    );
    expect(plan.skipReason).toBeNull();
    expect(plan.batch).toBe(13);
  });

  it('respects a custom dryK threshold', () => {
    const [plan] = buildPlan(
      [row({ domain_key: 'edge', have: 0, own_max: 0, consecutive_dry_rounds: 2 })],
      new Map([['edge', 1]]),
      { ...cfg, dryK: 2 },
    );
    expect(plan.skipReason).toBeNull();
    expect(plan.batch).toBeGreaterThan(0);
  });
});

// Nightly spend pacing (2026-08-07, Josh): the backfill should fill the bank
// over more nights at a chosen daily cost rather than in one burst when the
// flag flips. selectWithinBudget is the pure selection half of that.
describe('selectWithinBudget — nightly spend pacing', () => {
  const plan = (label: string, estCostUsd: number) =>
    ({ label, estCostUsd } as unknown as Parameters<typeof selectWithinBudget>[0][number]);

  it('takes domains neediest-first while the running total fits', () => {
    const out = selectWithinBudget(
      [plan('a', 0.2), plan('b', 0.2), plan('c', 0.2)],
      0.5,
    );
    expect(out.map((p) => p.label)).toEqual(['a', 'b']);
  });

  it('always takes the first domain even when it alone busts the budget', () => {
    // Otherwise an expensive domain is skipped every night forever and the
    // backfill reports itself healthy while making zero progress.
    const out = selectWithinBudget([plan('huge', 5), plan('cheap', 0.01)], 0.5);
    expect(out.map((p) => p.label)).toEqual(['huge']);
  });

  it('stops at the first domain that does not fit rather than cherry-picking cheaper ones behind it', () => {
    // Plans arrive sorted by NEED. Skipping past 'b' to fit 'c' would quietly
    // invert that priority and starve costly-but-genuinely-dry domains.
    const out = selectWithinBudget([plan('a', 0.3), plan('b', 0.4), plan('c', 0.01)], 0.5);
    expect(out.map((p) => p.label)).toEqual(['a']);
  });

  it('is a pass-through when the budget is null, zero, or negative', () => {
    const plans = [plan('a', 9), plan('b', 9)];
    for (const budget of [null, 0, -1]) {
      expect(selectWithinBudget(plans, budget).length).toBe(2);
    }
  });
});
