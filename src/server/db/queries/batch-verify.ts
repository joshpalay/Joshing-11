/**
 * DB read/write layer for the nightly batch-verification sweep
 * (D-QUESTION-QUALITY-AGENTS-01). Separated from the route so the queries
 * are independently testable and the route stays thin.
 */
import { and, eq, isNull } from 'drizzle-orm';

import { db, questions } from '@/server/db';

export type VerificationCandidate = {
  id: string;
  questionText: string;
  answerText: string;
  acceptedAlternatives: string[];
  factualExplanation: string | null;
  broadCategory: string | null;
  canonicalSubcategory: string | null;
  questionType: string | null;
  publicStatus: string;
};

/**
 * Fetch up to `limit` questions that have not yet been batch-verified.
 * Excludes deleted rows. Mirrors the vet-questions pattern.
 */
export async function getPendingVerificationBatch(limit: number): Promise<VerificationCandidate[]> {
  return db
    .select({
      id: questions.id,
      questionText: questions.questionText,
      answerText: questions.answerText,
      acceptedAlternatives: questions.acceptedAlternatives,
      factualExplanation: questions.factualExplanation,
      broadCategory: questions.broadCategory,
      canonicalSubcategory: questions.canonicalSubcategory,
      questionType: questions.questionType,
      publicStatus: questions.publicStatus,
    })
    .from(questions)
    .where(and(
      isNull(questions.verifiedAt),
      isNull(questions.deletedAt),
    ))
    .limit(limit);
}

/**
 * Stamp a question as verified. When demoteToNeedsReview is true, also flips
 * publicStatus → 'not_scored' (Decision A: demote-only authority).
 *
 * 'needs_review' is not in publicStatusEnum. The safe equivalent is 'not_scored',
 * which pulls the question from the eligible pool and queues it for a human or
 * the vet-questions sweep to revisit. We never flip a question that is already
 * 'rejected' — that would be a backward status regression with no benefit.
 */
export async function stampVerification(params: {
  questionId: string;
  verdict: 'ok' | 'demoted' | 'unverifiable' | 'skipped';
  demoteToNeedsReview?: boolean;
}): Promise<void> {
  const now = new Date();
  await db
    .update(questions)
    .set({
      verifiedAt: now,
      verificationVerdict: params.verdict,
      ...(params.demoteToNeedsReview ? { publicStatus: 'not_scored' as const } : {}),
      updatedAt: now,
    })
    .where(eq(questions.id, params.questionId));
}
