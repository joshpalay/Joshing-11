import { desc, eq } from 'drizzle-orm';

import { db, gradeDisputes, questions } from '@/server/db';

// B-13.4 — minimal review queue for GradeDispute rows. Every recheck route
// writes one of these; nothing read them back before this, so a dispute that
// didn't auto-resolve (accept) sat invisibly forever. This surfaces the
// 'pending' backlog for a human to act on.

export type PendingGradeDispute = {
  id: string;
  questionId: string;
  questionText: string | null;
  canonicalAnswer: string;
  submittedAnswer: string;
  surface: string | null;
  // "Argue your point" (B-ARGUE-01): the player's own optional case, verbatim.
  // Null for a plain recheck (no argument typed) and for every row written
  // before this shipped.
  playerArgument: string | null;
  reviewDecision: string | null;
  reviewReason: string | null;
  acceptedAlternative: string | null;
  createdAt: Date;
  // The question's own creatorId — null means house/editorial (no author to
  // route feedback to) OR the dispute's questionId didn't resolve to a
  // canonical Question row (a rare persist-failure fallback; see the recheck
  // routes' "disputeQuestionId" comments). Both cases land in this one queue.
  questionCreatorId: string | null;
};

/**
 * 'disputed' (canonical_disputed) rows are the highest-priority signal — the
 * reviewer already confirmed the question itself is broken, not just "a
 * player disagrees" — so surface them first regardless of recency.
 */
export function sortPendingDisputesByPriority<T extends { reviewDecision: string | null; createdAt: Date }>(
  rows: T[],
): T[] {
  return [...rows].sort((a, b) => {
    const aPriority = a.reviewDecision === 'canonical_disputed' ? 0 : 1;
    const bPriority = b.reviewDecision === 'canonical_disputed' ? 0 : 1;
    if (aPriority !== bPriority) return aPriority - bPriority;
    return b.createdAt.getTime() - a.createdAt.getTime();
  });
}

export async function getPendingGradeDisputesForReview(limit = 200): Promise<PendingGradeDispute[]> {
  const rows = await db
    .select({
      id: gradeDisputes.id,
      questionId: gradeDisputes.questionId,
      questionText: gradeDisputes.questionText,
      canonicalAnswer: gradeDisputes.canonicalAnswer,
      submittedAnswer: gradeDisputes.submittedAnswer,
      surface: gradeDisputes.surface,
      playerArgument: gradeDisputes.playerArgument,
      reviewDecision: gradeDisputes.reviewDecision,
      reviewReason: gradeDisputes.reviewReason,
      acceptedAlternative: gradeDisputes.acceptedAlternative,
      createdAt: gradeDisputes.createdAt,
      questionCreatorId: questions.creatorId,
    })
    .from(gradeDisputes)
    .leftJoin(questions, eq(gradeDisputes.questionId, questions.id))
    .where(eq(gradeDisputes.status, 'pending'))
    .orderBy(desc(gradeDisputes.createdAt))
    .limit(limit);

  return sortPendingDisputesByPriority(rows);
}

export type GradeDisputeResolution = 'reviewed' | 'dismissed';

export async function resolveGradeDispute(id: string, status: GradeDisputeResolution): Promise<void> {
  await db
    .update(gradeDisputes)
    .set({ status, reviewedAt: new Date() })
    .where(eq(gradeDisputes.id, id));
}
