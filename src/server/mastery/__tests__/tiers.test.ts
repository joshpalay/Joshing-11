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
    expect(resolveTier(499)).toBe('establishing');
    expect(resolveTier(500)).toBe('familiar');
    expect(resolveTier(1499)).toBe('familiar');
    expect(resolveTier(1500)).toBe('solid');
    expect(resolveTier(3499)).toBe('solid');
    expect(resolveTier(3500)).toBe('mastery');
  });

  it('effectiveTier applies the Mastery creator-share gate at 3500+', () => {
    expect(effectiveTier(4000, 799)).toBe('solid'); // 799/4000 < 20%
    expect(effectiveTier(4000, 800)).toBe('mastery'); // exactly 20%
    expect(effectiveTier(3499, 0)).toBe('solid');
  });

  it('effectiveTier requires creator credit from multiple distinct questions for Mastery', () => {
    expect(effectiveTier(4000, 1000, 1)).toBe('solid');
    expect(effectiveTier(4000, 1000, 2)).toBe('mastery');
  });
});
