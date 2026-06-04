/**
 * Pure mapping from a Haiku vetting verdict to the Question table's
 * publicStatus / publicEligibilityScore / publicEligibilityReason columns.
 * Lives separate from vet-question.ts so it can be smoke-tested without
 * pulling in the Anthropic SDK.
 */

// Which dimension caused a rejection. Only 'safety' is a hard block (see
// verdictToBlockedVisibility); the rest stay public-pool-eligibility signals
// that remain shareable to friends.
export type VetRejectionKind = 'factual' | 'safety' | 'quality' | 'answer_leaked';

export type VetVerdict =
  | { status: 'approved'; score: number; reason: string }
  | { status: 'rejected'; score: number; reason: string; rejectionKind: VetRejectionKind }
  | { status: 'needs_review'; score: number | null; reason: string };

export function verdictToPublicStatus(verdict: VetVerdict): {
  publicStatus: 'eligible_pending' | 'rejected' | 'not_scored';
  publicEligibilityScore: number | null;
  publicEligibilityReason: string;
} {
  switch (verdict.status) {
    case 'approved':
      return {
        publicStatus: 'eligible_pending',
        publicEligibilityScore: verdict.score,
        publicEligibilityReason: verdict.reason,
      };
    case 'rejected':
      return {
        publicStatus: 'rejected',
        publicEligibilityScore: verdict.score,
        publicEligibilityReason: verdict.reason,
      };
    case 'needs_review':
      return {
        publicStatus: 'not_scored',
        publicEligibilityScore: verdict.score,
        publicEligibilityReason: verdict.reason,
      };
  }
}

/**
 * Safety-failed questions (slurs, harassment, sexual content involving minors,
 * doxxing) must be hard-blocked from every surface, not merely kept out of the
 * public pool: the harm is to the recipient and friend-trust is not a defense.
 * We map them to visibility = 'blocked', a terminal state excluded by
 * questionVisibilityPredicate and every bank/send/game read path, so the
 * question can never reach a recipient or be re-shared — even by its author,
 * and even if it remains in the author's bank. publicStatus is independently
 * still set to 'rejected' by verdictToPublicStatus.
 *
 * Factual / quality / answer-leaked rejections are deliberately NOT blocked:
 * they remain publicStatus-only signals and stay shareable to friends.
 */
export function verdictToBlockedVisibility(verdict: VetVerdict): 'blocked' | null {
  return verdict.status === 'rejected' && verdict.rejectionKind === 'safety' ? 'blocked' : null;
}
