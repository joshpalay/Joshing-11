import { describe, expect, it } from 'vitest';

import {
  getDomainCircleSize,
  getPortraitCircleSize,
  type CircleSizingTier,
} from './circle-sizing';

const BOUNDS = { minDiameter: 18, maxDiameter: 120 } as const;

describe('getDomainCircleSize', () => {
  it('never exceeds the caller-provided max diameter', () => {
    const tiers: CircleSizingTier[] = ['establishing', 'familiar', 'solid', 'mastery'];
    for (const tier of tiers) {
      // points == max → top of the tier's band
      const size = getDomainCircleSize(tier, 100, 100, BOUNDS);
      expect(size).toBeLessThanOrEqual(BOUNDS.maxDiameter);
      expect(size).toBeGreaterThanOrEqual(BOUNDS.minDiameter);
    }
  });

  it('hits the max diameter only at the top of mastery', () => {
    expect(getDomainCircleSize('mastery', 100, 100, BOUNDS)).toBe(BOUNDS.maxDiameter);
    expect(getDomainCircleSize('establishing', 0, 100, BOUNDS)).toBe(BOUNDS.minDiameter);
  });

  it('is continuous across tier boundaries (top of a tier == floor of the next)', () => {
    // A domain maxed within its tier should be the same size as one just entering
    // the next tier — no discontinuous jump.
    const topOfFamiliar = getDomainCircleSize('familiar', 100, 100, BOUNDS);
    const floorOfSolid = getDomainCircleSize('solid', 0, 100, BOUNDS);
    expect(topOfFamiliar).toBe(floorOfSolid);

    const topOfSolid = getDomainCircleSize('solid', 100, 100, BOUNDS);
    const floorOfMastery = getDomainCircleSize('mastery', 0, 100, BOUNDS);
    expect(topOfSolid).toBe(floorOfMastery);

    const topOfEstablishing = getDomainCircleSize('establishing', 100, 100, BOUNDS);
    const floorOfFamiliar = getDomainCircleSize('familiar', 0, 100, BOUNDS);
    expect(topOfEstablishing).toBe(floorOfFamiliar);
  });

  it('grows monotonically with points within a tier', () => {
    const low = getDomainCircleSize('solid', 10, 100, BOUNDS);
    const mid = getDomainCircleSize('solid', 50, 100, BOUNDS);
    const high = getDomainCircleSize('solid', 90, 100, BOUNDS);
    expect(low).toBeLessThan(mid);
    expect(mid).toBeLessThan(high);
  });

  it('treats a zero/missing max as the tier floor (no divide-by-zero)', () => {
    expect(getDomainCircleSize('mastery', 5, 0, BOUNDS)).toBe(
      getDomainCircleSize('mastery', 0, 100, BOUNDS),
    );
  });
});

describe('getPortraitCircleSize', () => {
  it('keeps the large, dramatic per-tier diameters for the hero portrait', () => {
    // Mastery domains are intentionally big (304-384px) — the portrait free-wraps
    // and the size jump between tiers is the point.
    expect(getPortraitCircleSize('mastery', 100, 100)).toBe(384);
    expect(getPortraitCircleSize('mastery', 0, 100)).toBe(304);
    expect(getPortraitCircleSize('solid', 100, 100)).toBe(216);
    expect(getPortraitCircleSize('familiar', 100, 100)).toBe(48);
    expect(getPortraitCircleSize('establishing', 0, 100)).toBe(18);
  });

  it('grows with points within a tier', () => {
    expect(getPortraitCircleSize('mastery', 50, 100)).toBeGreaterThan(
      getPortraitCircleSize('mastery', 0, 100),
    );
  });
});
