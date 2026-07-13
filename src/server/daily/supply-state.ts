/**
 * Soft/provisional finiteness state machine (D-SUPPLY-FINITENESS-01 #4).
 *
 * Classifies each domain's SUPPLY STATE by reconciling observed generation
 * yield (the dry-round counter) against the corpus-grounded size estimate
 * (DomainDepthEstimate.estimated_questions, #3). Pure and derived AT READ TIME —
 * no stored state to go stale; the DB persists only the raw observations
 * (consecutive_dry_rounds, last_yield_at).
 *
 * The four arrows (agreed with Josh, 2026-07-07):
 *  - not dry, realized <  estimate → `filling`        (normal; keep generating)
 *  - not dry, realized >= estimate → `raise_estimate` (still yielding past the
 *      seed — the estimate was too low; co-calibration corrects it UPWARD)
 *  - dry,     realized ≈  estimate → `soft_finite`    (believed complete;
 *      resting + re-probeable — NEVER a tombstone)
 *  - dry,     realized ≪  estimate → `discrepancy`    (the generator quit far
 *      short of a trusted corpus size — a supply problem, NOT completion;
 *      surfaces in the weekly email + admin dashboard, never auto-finalizes)
 *
 * Confidence gate: `discrepancy` requires a HIGH-confidence resolution — a
 * low/medium-confidence estimate can rest a domain (soft_finite) but can never
 * fire the alarm off a possibly-wrong anchor. Unsized domains (bespoke/depth
 * fallback) are `unsized` and never alarm.
 *
 * "Dry" = K consecutive generation rounds where the domain was OFFERED to fresh
 * generation and zero rows survived the gates. Deliberately provisional: the
 * palette sampler and the model's own domain choice make single observations
 * noisy, so K absorbs noise and soft_finite stays re-probeable by design.
 */

export type SupplyState =
  | 'unsized'
  | 'filling'
  | 'raise_estimate'
  | 'soft_finite'
  | 'discrepancy';

function numEnv(name: string, fallback: number): number {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}

/** Consecutive zero-yield offered rounds before a domain reads as dry. */
export const dryRoundsThreshold = (): number => Math.round(numEnv('SUPPLY_DRY_ROUNDS_K', 3));

/** realized/estimate ratio at or above which a dry domain reads as complete. */
export const nearCompleteRatio = (): number => numEnv('SUPPLY_NEAR_COMPLETE_RATIO', 0.7);

/**
 * Worst-case servable bank rows at or above which a domain reads as STOCKED —
 * and a stocked domain is never dry, whatever its counter says. The dry-round
 * counter is written only by the per-user JIT generation path; the nightly
 * backfill and bank serving supply a domain without touching it (the 2026-07-13
 * false-alarm email: 10 "dry" domains that the backfill had restocked that same
 * morning). Kept in lockstep with the backfill's BUFFER_FLOOR default: report
 * says stocked ⟺ the backfill's own gate says stocked.
 */
export const stockedFloor = (): number => Math.round(numEnv('SUPPLY_STOCKED_FLOOR', 10));

export interface SupplyObservation {
  /** Distinct facts actually generated for the domain (bank-wide). */
  realized: number;
  /** Corpus-grounded size estimate; null = unsized (bespoke/depth fallback). */
  estimatedQuestions: number | null;
  /** Resolution confidence from the size estimator ('high' | 'medium' | 'low' | null). */
  confidence: string | null;
  /** Consecutive offered-but-zero-yield generation rounds. */
  consecutiveDryRounds: number;
  /**
   * Worst-case SERVABLE bank stock (have − largest single non-system owner),
   * the same number the backfill's "already stocked" gate uses. Optional so
   * callers without a stock read keep the pure counter-driven behavior.
   */
  servableStock?: number | null;
}

export function classifySupplyState(
  observation: SupplyObservation,
  opts?: { dryK?: number; nearRatio?: number; stockedFloor?: number },
): SupplyState {
  const { realized, estimatedQuestions, confidence, consecutiveDryRounds } = observation;
  if (estimatedQuestions == null || estimatedQuestions <= 0) return 'unsized';

  // A stocked bank overrides the dry counter: the counter only sees the JIT
  // path, so a domain the backfill keeps stocked would otherwise read dry
  // forever (its counter can climb but nothing on the serving path resets it).
  const stocked =
    observation.servableStock != null &&
    observation.servableStock >= (opts?.stockedFloor ?? stockedFloor());
  const dry = !stocked && consecutiveDryRounds >= (opts?.dryK ?? dryRoundsThreshold());
  if (!dry) {
    return realized >= estimatedQuestions ? 'raise_estimate' : 'filling';
  }

  if (realized >= (opts?.nearRatio ?? nearCompleteRatio()) * estimatedQuestions) {
    return 'soft_finite';
  }
  // Dry far short of the estimate. Only a trusted anchor may alarm.
  return confidence === 'high' ? 'discrepancy' : 'soft_finite';
}
