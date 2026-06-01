import type { MasteryTier } from '@/types/db';
import { getMasteryTierThresholds, resolveTier } from '@/server/mastery/tiers';

const ORDER: MasteryTier[] = ['establishing', 'familiar', 'solid', 'mastery'];

/**
 * Progress within the current tier band, 0–1. Mastery tier returns 1.
 */
export function progressWithinCurrentTier(points: number): number {
  const tier = resolveTier(points);
  const thresholds = getMasteryTierThresholds();
  const floor = thresholds[tier];
  const idx = ORDER.indexOf(tier);
  const nextTier = idx >= 0 && idx < ORDER.length - 1 ? ORDER[idx + 1] : null;
  if (!nextTier) {
    return 1;
  }
  const ceiling = thresholds[nextTier];
  const span = ceiling - floor;
  if (span <= 0) return 0;
  const clamped = Math.min(Math.max(points, floor), ceiling);
  return (clamped - floor) / span;
}

export type MasteryTierProgress = {
  tier: MasteryTier;
  nextTier: MasteryTier | null;
  pointsToNext: number | null;
  barFillRatio: number;
};

/**
 * Mastery bar fill and copy inputs from total mastery points (establishing → familiar → solid → mastery).
 */
export function getMasteryTierProgress(points: number): MasteryTierProgress {
  const thresholds = getMasteryTierThresholds();
  const tier = resolveTier(points);
  const idx = ORDER.indexOf(tier);
  const nextTier = idx >= 0 && idx < ORDER.length - 1 ? ORDER[idx + 1]! : null;
  const ceiling = nextTier ? thresholds[nextTier] : null;
  const pointsToNext = ceiling != null ? Math.max(0, Math.ceil(ceiling - points)) : null;
  return {
    tier,
    nextTier,
    pointsToNext,
    barFillRatio: progressWithinCurrentTier(points),
  };
}

/**
 * Width of the current mastery band (or last band for mastery), used to scale portrait created/answered
 * weights on the same tier-relative track as the mastery bar.
 */
export function getTierBandWidthForPortraitBars(
  tier: MasteryTier,
  thresholds: Record<MasteryTier, number>,
): number {
  const idx = ORDER.indexOf(tier);
  if (tier === 'mastery') {
    return Math.max(1, thresholds.mastery - thresholds.solid);
  }
  const next = ORDER[idx + 1]!;
  return Math.max(1, thresholds[next] - thresholds[tier]);
}

export function portraitScoreBarRatio(
  score: number,
  tier: MasteryTier,
  thresholds: Record<MasteryTier, number>,
): number {
  const w = getTierBandWidthForPortraitBars(tier, thresholds);
  if (w <= 0) return 0;
  return Math.max(0, Math.min(1, score / w));
}

export function formatTierLabel(t: MasteryTier): string {
  return t.charAt(0).toUpperCase() + t.slice(1);
}
