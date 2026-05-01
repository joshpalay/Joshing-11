import type { MasteryTier } from '@/types/db';

/** PRD §8.32 — minimum points to enter each tier (establishing is default below familiar). */
export const TIER_THRESHOLD_POINTS: Record<MasteryTier, number> = {
  establishing: 0,
  familiar: 500,
  solid: 1500,
  mastery: 3500,
};

/**
 * Tier from points alone — does not apply the Mastery creator-share gate (use `effectiveTier`).
 */
export function resolveTier(points: number): MasteryTier {
  if (points >= TIER_THRESHOLD_POINTS.mastery) return 'mastery';
  if (points >= TIER_THRESHOLD_POINTS.solid) return 'solid';
  if (points >= TIER_THRESHOLD_POINTS.familiar) return 'familiar';
  return 'establishing';
}

export function getTierForPoints(points: number): MasteryTier {
  return resolveTier(points);
}

/**
 * PRD §8.32 — Mastery requires ≥20% of domain points from author_credit (creator earnings),
 * and (v10.24 update) at least two distinct authored questions contributing that credit.
 */
export function effectiveTier(
  totalPoints: number,
  authorCreditPointsInDomain: number,
  authorCreditDistinctQuestionCount = Number.POSITIVE_INFINITY
): MasteryTier {
  if (totalPoints < TIER_THRESHOLD_POINTS.familiar) return 'establishing';
  if (totalPoints < TIER_THRESHOLD_POINTS.solid) return 'familiar';
  if (totalPoints < TIER_THRESHOLD_POINTS.mastery) return 'solid';
  const share = totalPoints > 0 ? authorCreditPointsInDomain / totalPoints : 0;
  if (share < 0.2) {
    return 'solid';
  }
  if (authorCreditDistinctQuestionCount < 2) {
    return 'solid';
  }
  return 'mastery';
}

export function getMasteryTierThresholds(): Record<MasteryTier, number> {
  return { ...TIER_THRESHOLD_POINTS };
}
