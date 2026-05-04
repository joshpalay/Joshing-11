export type CircleSizingTier = 'establishing' | 'familiar' | 'solid' | 'mastery';

const TIER_RANGES_DESKTOP: Record<CircleSizingTier, { min: number; max: number }> = {
  establishing: { min: 18, max: 28 },
  familiar: { min: 32, max: 48 },
  solid: { min: 52, max: 72 },
  mastery: { min: 76, max: 96 },
};

const TIER_RANGES_MOBILE: Record<CircleSizingTier, { min: number; max: number }> = {
  establishing: { min: 15, max: 22 },
  familiar: { min: 26, max: 38 },
  solid: { min: 42, max: 56 },
  mastery: { min: 60, max: 76 },
};

export function getDomainCircleSize(
  tier: CircleSizingTier,
  pointsInTier: number,
  maxPointsInTier: number,
  isMobile = false,
): number {
  const ranges = isMobile ? TIER_RANGES_MOBILE : TIER_RANGES_DESKTOP;
  const range = ranges[tier];
  const t = maxPointsInTier > 0 ? Math.min(1, Math.max(0, pointsInTier / maxPointsInTier)) : 0;
  return Math.round(range.min + t * (range.max - range.min));
}
