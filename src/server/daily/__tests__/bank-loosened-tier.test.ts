import { afterEach, beforeAll, describe, expect, it } from 'vitest';

// LOOSENED difficulty rule (Josh, 2026-10-03; diagnosis/bank-difficulty-loosening.md).
// When the ±1 ladder finds nothing, a build may take a capped number of bank
// picks from the tiers the ladder skipped — never below the domain's floor —
// and each one is flagged loosened on its bank attempt.
//
// generate-questions imports @/server/db at load; dummy URL + dynamic import is
// the repo convention for testing its pure exports.
let bankTierLadder: typeof import('@/server/daily/generate-questions').bankTierLadder;
let bankLooseTiers: typeof import('@/server/daily/generate-questions').bankLooseTiers;
let bankLooseTierMaxPerBuild: typeof import('@/server/daily/generate-questions').bankLooseTierMaxPerBuild;
let buildContext: typeof import('@/server/daily/build-context');

beforeAll(async () => {
  process.env.DATABASE_URL ??= 'postgres://user:pass@localhost:5432/joshing_test';
  ({ bankTierLadder, bankLooseTiers, bankLooseTierMaxPerBuild } = await import(
    '@/server/daily/generate-questions'
  ));
  buildContext = await import('@/server/daily/build-context');
});

afterEach(() => {
  delete process.env.BANK_LOOSE_TIER_MAX_PER_BUILD;
});

describe('bankLooseTiers', () => {
  it('reaches the tier two steps down when the floor allows it (the Wagner case)', () => {
    const ladder = bankTierLadder('specialist', 'accessible');
    expect(ladder).toEqual(['specialist', 'moderate']);
    expect(bankLooseTiers('specialist', 'accessible', ladder)).toEqual(['accessible']);
  });

  it('never goes below the floor', () => {
    const ladder = bankTierLadder('specialist', 'moderate');
    expect(bankLooseTiers('specialist', 'moderate', ladder)).toEqual([]);
  });

  it('may reach two steps UP — harder is never condescending', () => {
    const ladder = bankTierLadder('accessible', 'accessible');
    expect(ladder).toEqual(['accessible', 'moderate']);
    expect(bankLooseTiers('accessible', 'accessible', ladder)).toEqual(['specialist']);
  });

  it('adds nothing when the ±1 ladder already covers every tier', () => {
    const ladder = bankTierLadder('moderate', 'accessible');
    expect(bankLooseTiers('moderate', 'accessible', ladder)).toEqual([]);
  });
});

describe('bankLooseTierMaxPerBuild', () => {
  it('defaults to one loosened pick per build', () => {
    expect(bankLooseTierMaxPerBuild()).toBe(1);
  });

  it('0 restores the strict rule', () => {
    process.env.BANK_LOOSE_TIER_MAX_PER_BUILD = '0';
    expect(bankLooseTierMaxPerBuild()).toBe(0);
  });

  it('ignores garbage rather than loosening further', () => {
    process.env.BANK_LOOSE_TIER_MAX_PER_BUILD = 'lots';
    expect(bankLooseTierMaxPerBuild()).toBe(1);
  });
});

describe('loosened-pick counter', () => {
  it('is null outside a build, so nothing is loosened without a cap to count against', () => {
    expect(buildContext.loosenedBankPicksSoFar()).toBeNull();
  });

  it('counts per build and starts fresh for the next one', async () => {
    await buildContext.runInBuildContext('user-1', async () => {
      expect(buildContext.loosenedBankPicksSoFar()).toBe(0);
      buildContext.noteLoosenedBankPick();
      expect(buildContext.loosenedBankPicksSoFar()).toBe(1);
    });
    await buildContext.runInBuildContext('user-1', async () => {
      expect(buildContext.loosenedBankPicksSoFar()).toBe(0);
    });
  });
});
