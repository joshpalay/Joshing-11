/**
 * Mastery Model v2 — Phase 1: the PURE math core.
 *
 * Spec: docs/thinking/MASTERY-MODEL-v2.md. This module is deliberately WIRED TO
 * NOTHING — no DB, no imports with side effects, no flag reads, no surfaces. It
 * is the deterministic kernel the later phases build on (depth seeding, the
 * recompute engine, the read-surface wiring). Everything here is unit-tested and
 * reversible; nothing it computes is persisted or shown yet.
 *
 * The v2 grain split (spec decision 3):
 *   - LEAF mastery is a demonstrated fact — points ≥ the leaf's bar. Permanent
 *     (frozen) in the wired phases; here it is just the pure predicate.
 *   - PARENT mastery is live COVERAGE of its leaves — the depth-weighted share of
 *     the parent's material that sits in mastered/progressed leaves. It can rise
 *     or fall as the map grows (spec decision 4). No freeze at this grain.
 *
 * Two quantities the spec is careful to keep distinct (refinement #2):
 *   - "depth" elsewhere in the app = a QUESTION COUNT ("37 Qs", `depthByKey`).
 *   - a node's WEIGHT here = a topic-size / breadth proxy (Wikidata child-count
 *     or an LLM depth score, seeded in Phase 2). Never conflate the two.
 */

/** Spec decision 4: a parent is mastered at ≥ 75% depth-weighted coverage. */
export const PARENT_MASTERY_COVERAGE = 0.75;

/**
 * Maps a node's WEIGHT (breadth proxy, e.g. Wikidata child-count or an LLM 1–10
 * score) to a points bar for the leaf. CALIBRATION-PENDING: Phase 0 (2026-07-04)
 * showed live points are small (avg ~101, 1 player above 1000 of 212), so this
 * constant must be tuned against real distributions when the model is wired
 * (Phase 5/6) — otherwise "mastery" stays unreachable. Kept as a named, override-
 * able default so callers/tests pin it explicitly rather than depending on it.
 */
export const DEFAULT_POINTS_PER_WEIGHT = 100;

function clamp01(x: number): number {
  if (!Number.isFinite(x) || x <= 0) return 0;
  return x >= 1 ? 1 : x;
}

/**
 * A leaf's points bar = depth demand, CAPPED BY REACHABLE SUPPLY (spec decision
 * 5): you can never be required to earn more points than the domain's existing
 * questions can award, so a deep-but-thin domain stays masterable.
 *
 *   depthBar          = round(weight · pointsPerWeight)
 *   leafBar           = min(depthBar, reachableSupplyPoints)   [supply cap]
 *
 * Omit `reachableSupplyPoints` (or pass Infinity) to skip the cap — useful for
 * pure tests and for callers that haven't wired supply yet. A non-positive
 * weight yields a 0 bar (nothing to master).
 */
export function computeLeafBar(input: {
  weight: number;
  reachableSupplyPoints?: number;
  pointsPerWeight?: number;
}): number {
  const pointsPerWeight = input.pointsPerWeight ?? DEFAULT_POINTS_PER_WEIGHT;
  const weight = Number.isFinite(input.weight) && input.weight > 0 ? input.weight : 0;
  const depthBar = Math.round(weight * pointsPerWeight);
  const cap = input.reachableSupplyPoints;
  if (cap === undefined || cap === Infinity) return depthBar;
  return Math.max(0, Math.min(depthBar, cap));
}

/**
 * Leaf progress in [0, 1] — the honest fraction of the bar the player has
 * earned, clamped for display. A non-positive bar means "no bar to clear" → 0.
 */
export function leafProgress(earnedPoints: number, leafBar: number): number {
  if (!Number.isFinite(leafBar) || leafBar <= 0) return 0;
  return clamp01(earnedPoints / leafBar);
}

/**
 * Leaf mastery predicate — points at or above the bar. This is the grain that
 * becomes PERMANENT (frozen) in the wired phases; here it is pure.
 */
export function leafMastered(earnedPoints: number, leafBar: number): boolean {
  return Number.isFinite(leafBar) && leafBar > 0 && earnedPoints >= leafBar;
}

/** One leaf's contribution to its parent: its weight and its [0,1] progress. */
export type LeafContribution = { weight: number; progress: number };

export type ParentCoverage = {
  /** Depth-weighted share of the parent's material that is covered, in [0, 1]. */
  coverage: number;
  /** coverage ≥ PARENT_MASTERY_COVERAGE. Live — never frozen at this grain. */
  isMaster: boolean;
};

/**
 * Parent COVERAGE = depth-weighted share of the parent's leaves that is covered:
 *
 *   coverage = Σ_leaf( weight · contribution(progress) ) / Σ_leaf( weight )
 *
 * `contribution` (spec open-knob, smooth recommended):
 *   - 'smooth' (default): a leaf contributes its weight × its partial progress —
 *     partial progress across many leaves counts.
 *   - 'binary': a leaf contributes its full weight only once FULLY mastered
 *     (progress ≥ 1), else nothing.
 *
 * A big leaf outweighs a small one, so mastering one leaf (Hamlet) never masters
 * the parent (all of Tragedy) unless that one leaf is ≥ 75% of the weight. Empty
 * or zero-total-weight parents read as 0 coverage, not-master.
 */
export function parentCoverage(
  children: readonly LeafContribution[],
  options: { contribution?: 'smooth' | 'binary' } = {},
): ParentCoverage {
  const mode = options.contribution ?? 'smooth';
  let weightedCovered = 0;
  let totalWeight = 0;
  for (const child of children) {
    const weight = Number.isFinite(child.weight) && child.weight > 0 ? child.weight : 0;
    if (weight === 0) continue;
    totalWeight += weight;
    const progress = clamp01(child.progress);
    weightedCovered += mode === 'binary' ? (progress >= 1 ? weight : 0) : weight * progress;
  }
  const coverage = totalWeight > 0 ? weightedCovered / totalWeight : 0;
  return { coverage, isMaster: coverage >= PARENT_MASTERY_COVERAGE };
}

/** A leaf's raw inputs, before progress is derived. */
export type LeafState = { weight: number; earnedPoints: number; leafBar: number };

/**
 * Convenience: parent coverage straight from raw leaf state (weight + earned +
 * bar), deriving each leaf's progress internally. The shape the wired read path
 * will use once leaves carry a bar.
 */
export function parentCoverageFromLeaves(
  leaves: readonly LeafState[],
  options: { contribution?: 'smooth' | 'binary' } = {},
): ParentCoverage {
  return parentCoverage(
    leaves.map((l) => ({ weight: l.weight, progress: leafProgress(l.earnedPoints, l.leafBar) })),
    options,
  );
}
