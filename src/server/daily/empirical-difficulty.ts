// D11 — empirical correct-rate overrides the model's difficulty_estimate and
// feeds B2's calibration (PRD-D-5 §5.2 D11 / §7 / B4 Phase 5).
//
// The model's difficulty_estimate is a guess made at generation time. Once enough
// humans have actually played a question, the MEASURED correct rate is ground
// truth: a "specialist" question 80% of players nail is really accessible; a
// "moderate" one almost nobody gets is really specialist. The pool teaches the
// floor what is actually easy — the loop that makes the floor self-correcting.
//
// This is the per-question override. The resolved tier is written to
// Question.calibrated_difficulty (the value serving + base-points already read),
// so the correction flows into points and difficulty matching automatically.

export type DifficultyTier = 'accessible' | 'moderate' | 'specialist';

function numEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** Real human plays required before measured rate is trusted to override the
 *  model's estimate (§7). Below this, the estimate stands. */
export function empiricalMinSamples(): number {
  return Math.max(1, Math.round(numEnv('EMPIRICAL_DIFFICULTY_MIN_SAMPLES', 5)));
}

// Rate → tier cut points, aligned with the generator's per-tier target rates
// (accessible ≈ 0.78, moderate ≈ 0.62, enthusiast/specialist ≈ 0.50): a question
// most players get is accessible; one few get is specialist.
function accessibleMinRate(): number {
  return numEnv('EMPIRICAL_DIFFICULTY_ACCESSIBLE_MIN_RATE', 0.7);
}
function moderateMinRate(): number {
  return numEnv('EMPIRICAL_DIFFICULTY_MODERATE_MIN_RATE', 0.45);
}

function toTier(value: string | null | undefined): DifficultyTier {
  return value === 'accessible' || value === 'moderate' || value === 'specialist' ? value : 'moderate';
}

/** Map a measured correct rate (0..1) to a difficulty tier. */
export function empiricalDifficultyTier(
  rate: number,
  accessibleMin: number = accessibleMinRate(),
  moderateMin: number = moderateMinRate(),
): DifficultyTier {
  if (rate >= accessibleMin) return 'accessible';
  if (rate >= moderateMin) return 'moderate';
  return 'specialist';
}

export interface EffectiveDifficulty {
  difficulty: DifficultyTier;
  /** Which signal won — measured play vs the model's estimate. */
  source: 'empirical' | 'estimate';
}

/**
 * D11 resolution: the measured rate overrides the model's estimate once at least
 * `minSamples` humans have played; otherwise the estimate stands. Pure.
 */
export function resolveEffectiveDifficulty(args: {
  estimate: string | null | undefined;
  empiricalRate: number | null | undefined;
  nAnswered: number;
  minSamples?: number;
}): EffectiveDifficulty {
  const minSamples = args.minSamples ?? empiricalMinSamples();
  if (args.empiricalRate != null && Number.isFinite(args.empiricalRate) && args.nAnswered >= minSamples) {
    return { difficulty: empiricalDifficultyTier(args.empiricalRate), source: 'empirical' };
  }
  return { difficulty: toTier(args.estimate), source: 'estimate' };
}
