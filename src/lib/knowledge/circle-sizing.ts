export type CircleSizingTier = 'establishing' | 'familiar' | 'solid' | 'mastery';

// Two sizing scales, because the two knowledge surfaces want opposite things:
//
//  • getDomainCircleSize — a CONTINUOUS, caller-bounded scale for the progression
//    *grid* (ProgressionLandscape), whose tier columns are only ~100-190px wide.
//    The four tiers occupy contiguous bands of a single 0→1 axis (each tier's top
//    == the next tier's floor → no jump), and the caller passes the diameter
//    bounds so a circle can never overflow its column. This is the original C8 fix
//    for the grid, where the old absolute ranges blew past the column width.
//
//  • getPortraitCircleSize — the original DRAMATIC per-tier ranges for the knowledge
//    *portrait* (PortraitCircles), which is a free-wrapping hero showcase, not a
//    grid. Big mastery circles are the point there ("size = depth"), so it keeps
//    the large, intentionally non-continuous ranges (establishing barely visible,
//    mastery up to 384px). The portrait never overflowed — it just wraps — so it
//    was wrong to shrink it; this restores it.
const TIER_BANDS: Record<CircleSizingTier, readonly [number, number]> = {
  establishing: [0, 0.18],
  familiar: [0.18, 0.42],
  solid: [0.42, 0.7],
  mastery: [0.7, 1],
};

export type CircleSizeBounds = {
  /** Smallest circle — a domain sitting at the floor of `establishing`. */
  minDiameter?: number;
  /** Largest circle — bound this to the column/container so circles never overflow. */
  maxDiameter?: number;
};

const DEFAULT_MIN_DIAMETER = 22;
const DEFAULT_MAX_DIAMETER = 132;

export function getDomainCircleSize(
  tier: CircleSizingTier,
  pointsInTier: number,
  maxPointsInTier: number,
  bounds: CircleSizeBounds = {},
): number {
  const minDiameter = bounds.minDiameter ?? DEFAULT_MIN_DIAMETER;
  const maxDiameter = bounds.maxDiameter ?? DEFAULT_MAX_DIAMETER;
  const [bandLo, bandHi] = TIER_BANDS[tier];
  const t = maxPointsInTier > 0 ? Math.min(1, Math.max(0, pointsInTier / maxPointsInTier)) : 0;
  const progress = bandLo + t * (bandHi - bandLo);
  return Math.round(minDiameter + progress * (maxDiameter - minDiameter));
}

// The portrait's large, dramatic per-tier diameters. Intentionally non-continuous
// (a familiar domain tops out at 40px; a solid domain starts at 156px) — the
// portrait is a hero showcase where the size jump between casual and serious
// domains is the visual story, and it free-wraps so big circles never overflow.
const PORTRAIT_TIER_RANGES: Record<CircleSizingTier, { min: number; max: number }> = {
  establishing: { min: 18, max: 28 },
  familiar: { min: 28, max: 40 },
  solid: { min: 156, max: 216 },
  mastery: { min: 304, max: 384 },
};

export function getPortraitCircleSize(
  tier: CircleSizingTier,
  pointsInTier: number,
  maxPointsInTier: number,
): number {
  const range = PORTRAIT_TIER_RANGES[tier];
  const t = maxPointsInTier > 0 ? Math.min(1, Math.max(0, pointsInTier / maxPointsInTier)) : 0;
  return Math.round(range.min + t * (range.max - range.min));
}
