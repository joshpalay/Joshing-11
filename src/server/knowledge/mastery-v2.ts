/**
 * Mastery v2 — the pure kernel (points-threshold model; see
 * docs/thinking/MASTERY-MODEL-v2.md "Final model").
 *
 * Every node carries a mastery threshold in POINTS. Mastery is one formula
 * everywhere:
 *   progress = earned points / threshold   (clamped to [0, 1])
 *   mastered = earned points ≥ 75% of threshold
 * The only leaf/parent difference is WHOSE points roll up (a leaf's own vs a
 * parent's descendant sum) and whether it FREEZES — none of which lives here.
 *
 * Pure and deterministic — no I/O. (This replaces the depth-WEIGHT kernel:
 * `leafBar`/`parentCoverage`/`node_weight` and the two calibration constants are
 * gone; the per-node number is now a points threshold directly.)
 */

/** Spec: mastered at ≥ 75% of the threshold, identically for leaf and parent. */
export const MASTERY_FRACTION = 0.75;

/**
 * Default points threshold for a node with no seeded value. Deliberately high so
 * an unseeded node under-promises rather than handing out cheap mastery.
 */
export const DEFAULT_MASTERY_THRESHOLD = 1000;

/** Fraction of the threshold earned, clamped to [0, 1]. A non-positive threshold → 0. */
export function masteryProgress(points: number, threshold: number): number {
  if (!Number.isFinite(threshold) || threshold <= 0) return 0;
  const fraction = points / threshold;
  return fraction <= 0 ? 0 : fraction >= 1 ? 1 : fraction;
}

/** Mastered when earned points reach the 75% bar of a positive threshold. */
export function isMastered(points: number, threshold: number): boolean {
  return Number.isFinite(threshold) && threshold > 0 && points >= MASTERY_FRACTION * threshold;
}
