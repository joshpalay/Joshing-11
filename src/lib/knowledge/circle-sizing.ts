export type CircleSizingTier = 'establishing' | 'familiar' | 'solid' | 'mastery';

// One continuous scale for every knowledge circle (design audit C8).
//
// Previously each tier had its own absolute px range with large gaps between them
// (familiar maxed at 48px, then solid *started* at 156px; solid maxed at 216px,
// mastery started at 304px and ran to 384px) — so circle size jumped
// discontinuously at tier boundaries and the biggest circles overflowed their
// column. Now the four tiers occupy *contiguous* bands of a single 0→1 progression
// axis: each tier's upper bound is the next tier's lower bound, so a domain at the
// top of one tier is the same size as one just entering the next. Within a tier,
// size still interpolates by pointsInTier / maxPointsInTier.
//
// Absolute pixels are no longer baked in here — the caller passes the diameter
// bounds for its own layout via `bounds`, which is how the scale stays
// "column-bounded": a tight grid cell passes a small maxDiameter, a roomy portrait
// passes a larger one, and circles never overflow either container.
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
