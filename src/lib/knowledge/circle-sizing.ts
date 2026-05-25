export type CircleSizingTier = 'establishing' | 'familiar' | 'solid' | 'mastery';

const TIER_RANGES_DESKTOP: Record<CircleSizingTier, { min: number; max: number }> = {
  establishing: { min: 18, max: 28 },
  familiar: { min: 32, max: 48 },
  solid: { min: 156, max: 216 },
  mastery: { min: 304, max: 384 },
};

const TIER_RANGES_MOBILE: Record<CircleSizingTier, { min: number; max: number }> = {
  establishing: { min: 15, max: 22 },
  familiar: { min: 26, max: 38 },
  solid: { min: 126, max: 168 },
  mastery: { min: 240, max: 304 },
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
