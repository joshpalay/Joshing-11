import { describe, expect, it } from 'vitest';

import {
  empiricalDifficultyTier,
  resolveEffectiveDifficulty,
} from '@/server/daily/empirical-difficulty';

describe('empiricalDifficultyTier', () => {
  it('maps high rate → accessible, mid → moderate, low → specialist', () => {
    expect(empiricalDifficultyTier(0.9)).toBe('accessible');
    expect(empiricalDifficultyTier(0.7)).toBe('accessible'); // boundary inclusive
    expect(empiricalDifficultyTier(0.6)).toBe('moderate');
    expect(empiricalDifficultyTier(0.45)).toBe('moderate'); // boundary inclusive
    expect(empiricalDifficultyTier(0.2)).toBe('specialist');
    expect(empiricalDifficultyTier(0)).toBe('specialist');
  });
});

describe('resolveEffectiveDifficulty (D11)', () => {
  const MIN = 5;

  it('keeps the model estimate below the sample threshold', () => {
    const r = resolveEffectiveDifficulty({
      estimate: 'specialist',
      empiricalRate: 0.95,
      nAnswered: 4, // not enough play yet
      minSamples: MIN,
    });
    expect(r).toEqual({ difficulty: 'specialist', source: 'estimate' });
  });

  it('overrides with the measured rate once enough humans have played', () => {
    // A "specialist"-estimated question almost everyone nails is really accessible.
    const r = resolveEffectiveDifficulty({
      estimate: 'specialist',
      empiricalRate: 0.85,
      nAnswered: 12,
      minSamples: MIN,
    });
    expect(r).toEqual({ difficulty: 'accessible', source: 'empirical' });
  });

  it('CHECKPOINT: a measured rate that diverges from the estimate resolves by the measured rate', () => {
    // Estimated accessible, but nobody actually gets it → resolves specialist.
    const r = resolveEffectiveDifficulty({
      estimate: 'accessible',
      empiricalRate: 0.1,
      nAnswered: 10,
      minSamples: MIN,
    });
    expect(r.source).toBe('empirical');
    expect(r.difficulty).toBe('specialist');
    expect(r.difficulty).not.toBe('accessible'); // the estimate did NOT win
  });

  it('falls back to the estimate when there is no empirical rate', () => {
    expect(
      resolveEffectiveDifficulty({ estimate: 'moderate', empiricalRate: null, nAnswered: 99, minSamples: MIN }),
    ).toEqual({ difficulty: 'moderate', source: 'estimate' });
  });

  it('defaults a missing/invalid estimate to moderate', () => {
    expect(
      resolveEffectiveDifficulty({ estimate: null, empiricalRate: null, nAnswered: 0, minSamples: MIN }).difficulty,
    ).toBe('moderate');
  });
});
