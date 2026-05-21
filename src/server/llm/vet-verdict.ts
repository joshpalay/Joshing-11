/**
 * Pure mapping from a Haiku vetting verdict to the Question table's
 * publicStatus / publicEligibilityScore / publicEligibilityReason columns.
 * Lives separate from vet-question.ts so it can be smoke-tested without
 * pulling in the Anthropic SDK.
 */

export type VetVerdict =
  | { status: 'approved'; score: number; reason: string }
  | { status: 'rejected'; score: number; reason: string }
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
