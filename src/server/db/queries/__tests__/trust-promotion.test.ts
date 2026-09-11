import { describe, expect, it } from 'vitest';

import { decideTrustOnPlay, empiricalPlayPatch } from '@/server/db/queries/trust-promotion';

const MIN_CORRECT = 3;
const MIN_HOLDERS = 5;

describe('decideTrustOnPlay', () => {
  it('promotes machine_verified to human_validated at N=3 distinct correct', () => {
    const d = decideTrustOnPlay(
      { distinctCorrect: 3, distinctAnswerers: 4 },
      'machine_verified',
      MIN_CORRECT,
      MIN_HOLDERS,
    );
    expect(d.promoteTo).toBe('human_validated');
    expect(d.nobodyCorrectFlag).toBe(false);
  });

  it('tolerates a wrong answer in the mix (counts correct, not rate)', () => {
    // 3 correct + 2 wrong = 5 holders, still promotes.
    const d = decideTrustOnPlay(
      { distinctCorrect: 3, distinctAnswerers: 5 },
      'machine_verified',
      MIN_CORRECT,
      MIN_HOLDERS,
    );
    expect(d.promoteTo).toBe('human_validated');
  });

  it('does not promote below the threshold', () => {
    expect(
      decideTrustOnPlay({ distinctCorrect: 2, distinctAnswerers: 2 }, 'machine_verified', MIN_CORRECT, MIN_HOLDERS)
        .promoteTo,
    ).toBeNull();
  });

  it('only promotes machine_verified — never unverified or higher tiers', () => {
    for (const tier of ['unverified', 'human_validated', 'author_confirmed'] as const) {
      expect(
        decideTrustOnPlay({ distinctCorrect: 9, distinctAnswerers: 9 }, tier, MIN_CORRECT, MIN_HOLDERS).promoteTo,
      ).toBeNull();
    }
  });

  it('flags "nobody got it" at >=5 holders with zero correct', () => {
    const d = decideTrustOnPlay(
      { distinctCorrect: 0, distinctAnswerers: 5 },
      'machine_verified',
      MIN_CORRECT,
      MIN_HOLDERS,
    );
    expect(d.nobodyCorrectFlag).toBe(true);
    expect(d.promoteTo).toBeNull();
  });

  it('does not flag before enough holders have tried', () => {
    expect(
      decideTrustOnPlay({ distinctCorrect: 0, distinctAnswerers: 4 }, 'machine_verified', MIN_CORRECT, MIN_HOLDERS)
        .nobodyCorrectFlag,
    ).toBe(false);
  });

  it('clears the flag the moment one human gets it right (hard, not broken)', () => {
    const d = decideTrustOnPlay(
      { distinctCorrect: 1, distinctAnswerers: 8 },
      'human_validated',
      MIN_CORRECT,
      MIN_HOLDERS,
    );
    expect(d.nobodyCorrectFlag).toBe(false);
  });
});

// R8 (2026-09-11). GeneratedQuestion.n_answered / empirical_correct_rate were
// only ever written when a promotion, a "nobody got it" flag, or an empirical
// difficulty recompute was already in reach — thresholds of 3 and 5 distinct
// humans. At this product's scale almost every question is answered once or
// twice, so the columns stayed null on 2,161 of 2,191 live bank rows and no
// tier label could be checked against real play.
describe('empiricalPlayPatch', () => {
  it('records a SINGLE answerer — the case the old threshold exit skipped', () => {
    expect(empiricalPlayPatch({ distinctCorrect: 1, distinctAnswerers: 1 })).toEqual({
      nAnswered: 1,
      empiricalCorrectRate: 1,
    });
  });

  it('records a lone wrong answer as a measured zero, not as missing data', () => {
    expect(empiricalPlayPatch({ distinctCorrect: 0, distinctAnswerers: 1 })).toEqual({
      nAnswered: 1,
      empiricalCorrectRate: 0,
    });
  });

  it('computes the rate over distinct humans', () => {
    expect(empiricalPlayPatch({ distinctCorrect: 3, distinctAnswerers: 4 })).toEqual({
      nAnswered: 4,
      empiricalCorrectRate: 0.75,
    });
  });

  it('writes nothing when nobody has answered yet', () => {
    expect(empiricalPlayPatch({ distinctCorrect: 0, distinctAnswerers: 0 })).toBeNull();
  });

  it('is idempotent — the patch is a recompute, never an increment', () => {
    const agg = { distinctCorrect: 2, distinctAnswerers: 3 };
    expect(empiricalPlayPatch(agg)).toEqual(empiricalPlayPatch(agg));
  });
});
