// Verification tier-gating switch (B4 Phase 3, PRD-D-5 §6).
//
// Turns the B1 selection-layer tier filters from "capability" into live
// enforcement — BEHIND A FLAG, OFF BY DEFAULT (Drift Risk 1). With the flag off,
// every serving surface logs what it WOULD filter (and the candidate counts) but
// serves exactly today's set. Only after the per-surface eligible pools are
// confirmed healthy (the Phase 3 approval gate) does an operator flip the flag.
//
// §6 surface eligibility:
//   self-practice (Daily Five)   → tier ≥ machine_verified (everything but unverified)
//   friend-facing / Convergence  → human_validated OR author_confirmed
//   house (editorial, D9 public) → human_validated OR author_confirmed (author_confirmed in practice)

function boolEnv(name: string, fallback: boolean): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  if (raw === undefined || raw === '') return fallback;
  return raw === 'true' || raw === '1' || raw === 'yes' || raw === 'on';
}

/** Master enforcement switch. OFF by default — shadow-log only until flipped. */
export function isTierGatingEnabled(): boolean {
  return boolEnv('VERIFICATION_TIER_GATING_ENABLED', false);
}

export type TrustTier = 'unverified' | 'machine_verified' | 'human_validated' | 'author_confirmed';

/** Self-practice floor: anything that has earned at least machine_verified. */
export const SELF_PRACTICE_TIERS: readonly TrustTier[] = [
  'machine_verified',
  'human_validated',
  'author_confirmed',
];

/** Friend-facing / Convergence / house: human-validated or author-asserted. */
export const FRIEND_FACING_TIERS: readonly TrustTier[] = ['human_validated', 'author_confirmed'];

export interface TierGateResult<T> {
  /** Rows to actually serve: filtered when enforcing, unchanged when shadowing. */
  rows: T[];
  /** Whether enforcement was on for this call. */
  enforced: boolean;
  /** How many candidates fall below the surface's tier bar. */
  wouldFilter: number;
  /** Candidates considered. */
  candidateCount: number;
}

/**
 * Apply (or shadow-evaluate) a surface's tier bar over candidate rows.
 *
 * Enforcing → returns only eligible rows. Shadowing (flag off) → returns ALL rows
 * unchanged so live behavior is byte-identical to today, but logs the would-filter
 * count so we can measure impact before flipping. Either way it logs when any
 * candidate is below the bar, tagged with the surface for the Phase 3 report.
 */
export function applyTierGate<T>(
  surface: string,
  rows: T[],
  tierOf: (row: T) => TrustTier,
  allowed: readonly TrustTier[],
): TierGateResult<T> {
  const enforced = isTierGatingEnabled();
  const kept = rows.filter((row) => allowed.includes(tierOf(row)));
  const wouldFilter = rows.length - kept.length;

  if (wouldFilter > 0) {
    console.info('[verification-gating]', {
      surface,
      enforced,
      candidateCount: rows.length,
      eligible: kept.length,
      wouldFilter,
      allowed,
    });
  }

  return {
    rows: enforced ? kept : rows,
    enforced,
    wouldFilter,
    candidateCount: rows.length,
  };
}
