/**
 * D-MISSED-RETURN-01 — returning missed questions to the Daily Five.
 *
 * The framing, which governs everything here: this is NOT remediation and must
 * never read as it. A return asks "did what your friend taught you stick?", and
 * getting it right the second time is itself a connection event — arguably a
 * stronger one than the original miss. Copy that reads as a quiz retake, a
 * correction, or a deficiency is a canon violation (§1).
 *
 * This module is PURE — constants, the flag, and the ranking rule. The database
 * side lives in `@/server/db/queries/missed-return`, and the dismiss state in
 * `@/server/db/queries/missed-return-dismissed`.
 */

/** R5 — minimum days between sightings of the same question. A FLOOR, not a schedule. */
export const MISSED_RETURN_COOLDOWN_DAYS = Math.max(
  0,
  Number(process.env.MISSED_RETURN_COOLDOWN_DAYS ?? 7),
);

/**
 * R7 — lifetime cap of returns per (player, question). A question missed four
 * times isn't teaching anything; the honest move is to let it go.
 * Counted for the WRONG scope only (§2).
 */
export const MISSED_RETURN_LIFETIME_CAP = Math.max(
  0,
  Number(process.env.MISSED_RETURN_LIFETIME_CAP ?? 3),
);

/**
 * R2 — at most ONE return per session. Never 2: at five questions, two returns
 * is 40% recycled, which is a curriculum rather than a grace note.
 */
export const MISSED_RETURN_PER_SESSION_CAP = 1;

/**
 * Feature flag, OFF by default (§9 Phase 4 flips it). Every read path is gated
 * on this so the feature is fully dark until the copy pass lands — §6 is explicit
 * that the copy IS the feature here, not polish on top of it.
 */
export function isMissedReturnEnabled(): boolean {
  return process.env.MISSED_RETURN_ENABLED === '1';
}

/**
 * The two scopes are NOT treated identically (§2), because an expired question
 * has never been seen:
 *
 *   wrong   — a return. Marked as one ("from March 4"), never disguised as new
 *             (R9). Scores at RECOVERY_STATE_WEIGHT. Counts toward the 3-cap.
 *   expired — a first ask, arriving late. NO return framing, no "again" label.
 *             Scores at CATCHUP_SURFACE_WEIGHT. Does NOT count toward the cap.
 */
export type ReturnScope = 'wrong' | 'expired';

export type ReturnCandidate = {
  questionId: string;
  scope: ReturnScope;
  /** When the player last saw it — the wrong answer, or the queue date it expired on. */
  lastSeenAt: Date;
  /** Returns served so far (wrong scope only; expired first appearances don't count). */
  returnCount: number;
};

/**
 * R8 + §2 — ranking. Expired before wrong ("unseen beats re-seen"), and within
 * each, longest-since-last-seen first so the backlog DRAINS rather than the same
 * two questions cycling.
 *
 * Pure and total: ties break on questionId so a build is deterministic given the
 * same candidate set.
 */
export function rankReturnCandidates(candidates: readonly ReturnCandidate[]): ReturnCandidate[] {
  const scopeRank = (scope: ReturnScope) => (scope === 'expired' ? 0 : 1);
  return [...candidates].sort((a, b) => {
    const byScope = scopeRank(a.scope) - scopeRank(b.scope);
    if (byScope !== 0) return byScope;
    const byAge = a.lastSeenAt.getTime() - b.lastSeenAt.getTime(); // oldest first
    if (byAge !== 0) return byAge;
    return a.questionId.localeCompare(b.questionId);
  });
}

/**
 * The whole selection rule: rank, then take the session cap (R2). Serve-time, not
 * render-time — §8.5 is explicit that a queue able to hold two return slots while
 * the UI shows one will leak the second somewhere eventually.
 */
export function selectReturnCandidates(
  candidates: readonly ReturnCandidate[],
): ReturnCandidate[] {
  return rankReturnCandidates(candidates).slice(0, MISSED_RETURN_PER_SESSION_CAP);
}
