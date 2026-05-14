import { describe, expect, it } from 'vitest';
import {
  effectiveTier,
  getMasteryTierThresholds,
  resolveTier,
  TIER_THRESHOLD_POINTS,
} from '@/server/mastery/tiers';

describe('mastery tiers', () => {
  it('uses PRD §8.32 fixed thresholds (no env overrides)', () => {
    expect(getMasteryTierThresholds()).toEqual(TIER_THRESHOLD_POINTS);
  });

  it('resolveTier maps point totals (naive — ignores creator gate)', () => {
    expect(resolveTier(0)).toBe('establishing');
    expect(resolveTier(99)).toBe('establishing');
    expect(resolveTier(100)).toBe('familiar');
    expect(resolveTier(999)).toBe('familiar');
    expect(resolveTier(1000)).toBe('solid');
    expect(resolveTier(1999)).toBe('solid');
    expect(resolveTier(2000)).toBe('mastery');
  });

  it('effectiveTier applies the Mastery creator-share gate at 2000+', () => {
    expect(effectiveTier(2500, 499)).toBe('solid'); // 499/2500 < 20%
    expect(effectiveTier(2500, 500)).toBe('mastery'); // exactly 20%
    expect(effectiveTier(1999, 0)).toBe('solid');
  });

  it('effectiveTier requires creator credit from multiple distinct questions for Mastery', () => {
    expect(effectiveTier(2500, 1000, 1)).toBe('solid');
    expect(effectiveTier(2500, 1000, 2)).toBe('mastery');
  });
});
