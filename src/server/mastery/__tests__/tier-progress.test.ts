import { describe, expect, it } from 'vitest';
import {
  getMasteryTierProgress,
  getTierBandWidthForPortraitBars,
  portraitScoreBarRatio,
  progressWithinCurrentTier,
} from '@/server/mastery/tier-progress';
import { getMasteryTierThresholds } from '@/server/mastery/tiers';

describe('tier progress', () => {
  it('progressWithinCurrentTier is half at midpoint of establishing band', () => {
    expect(progressWithinCurrentTier(0)).toBe(0);
    expect(progressWithinCurrentTier(250)).toBeCloseTo(0.5, 5);
    expect(progressWithinCurrentTier(500)).toBe(0);
    expect(progressWithinCurrentTier(1000)).toBeCloseTo(0.5, 5);
  });

  it('getMasteryTierProgress reports points to next tier', () => {
    const p = getMasteryTierProgress(250);
    expect(p.tier).toBe('establishing');
    expect(p.nextTier).toBe('familiar');
    expect(p.pointsToNext).toBe(250);
    expect(p.barFillRatio).toBeCloseTo(0.5, 5);
  });

  it('getMasteryTierProgress at top band has no next tier', () => {
    const p = getMasteryTierProgress(5000);
    expect(p.tier).toBe('mastery');
    expect(p.nextTier).toBe(null);
    expect(p.pointsToNext).toBe(null);
    expect(p.barFillRatio).toBe(1);
  });

  it('portrait bars use band width for current tier', () => {
    const t = getMasteryTierThresholds();
    expect(getTierBandWidthForPortraitBars('establishing', t)).toBe(500);
    expect(getTierBandWidthForPortraitBars('familiar', t)).toBe(1000);
    expect(getTierBandWidthForPortraitBars('solid', t)).toBe(2000);
    expect(getTierBandWidthForPortraitBars('mastery', t)).toBe(2000);
    expect(portraitScoreBarRatio(250, 'establishing', t)).toBeCloseTo(0.5, 5);
  });
});
