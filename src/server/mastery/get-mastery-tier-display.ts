import type { MasteryTier } from '@/types/db';
import { resolveTier, TIER_THRESHOLD_POINTS } from '@/server/mastery/tiers';

export type MasteryTierDisplay = {
  tier: MasteryTier;
  progressWithinTier: number;
};

const ORDER: MasteryTier[] = ['establishing', 'familiar', 'solid', 'mastery'];

export function getMasteryTierDisplay(masteryPoints: number): MasteryTierDisplay {
  const safePoints = Number.isFinite(masteryPoints) ? masteryPoints : 0;
  const clampedPoints = Math.max(0, safePoints);
  const tier = resolveTier(clampedPoints);
  if (tier === 'mastery') {
    return { tier, progressWithinTier: 1 };
  }

  const floor = TIER_THRESHOLD_POINTS[tier];
  const nextTier = ORDER[ORDER.indexOf(tier) + 1]!;
  const ceiling = TIER_THRESHOLD_POINTS[nextTier];
  const span = Math.max(1, ceiling - floor);
  const progressWithinTier = Math.max(0, Math.min(1, (clampedPoints - floor) / span));

  return { tier, progressWithinTier };
}
