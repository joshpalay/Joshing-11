import { and, eq, isNull } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';

import { db, questions } from '@/server/db';
import { verdictToPublicStatus, vetQuestion } from '@/server/llm/vet-question';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const BATCH_SIZE = 25;

function isAuthorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET ?? process.env.VERCEL_CRON_SECRET;
  if (!secret) return true;
  const authHeader = request.headers.get('authorization');
  return authHeader === `Bearer ${secret}`;
}

/**
 * Sweeps `Question` rows that are still at `publicStatus = 'not_scored'`
 * (the default) and re-runs the Haiku vetter. The submit route also vets
 * inline; this cron catches the cases where the inline call hit a Haiku
 * error or returned `factual: 'unknown'`.
 */
export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const pending = await db
    .select({
      id: questions.id,
      questionText: questions.questionText,
      answerText: questions.answerText,
      acceptedAlternatives: questions.acceptedAlternatives,
      factualExplanation: questions.factualExplanation,
      broadCategory: questions.broadCategory,
      canonicalSubcategory: questions.canonicalSubcategory,
    })
    .from(questions)
    .where(and(
      eq(questions.publicStatus, 'not_scored'),
      eq(questions.visibility, 'public'),
      isNull(questions.deletedAt),
    ))
    .limit(BATCH_SIZE);

  const results = {
    scanned: pending.length,
    approved: 0,
    rejected: 0,
    deferred: 0,
    failed: 0,
  };

  for (const row of pending) {
    try {
      const verdict = await vetQuestion({
        questionText: row.questionText,
        answer: row.answerText,
        alternateAnswers: row.acceptedAlternatives ?? [],
        explanation: row.factualExplanation,
        broadCategory: row.broadCategory,
        canonicalSubcategory: row.canonicalSubcategory,
      });
      const scoring = verdictToPublicStatus(verdict);

      // Skip the update when we'd just re-write 'not_scored' with the same
      // null score — the row was already in that state and nothing changed.
      // Storing the reason still helps observability, so write when reason
      // moved.
      const noChange = scoring.publicStatus === 'not_scored' && scoring.publicEligibilityScore === null;
      if (!noChange) {
        await db
          .update(questions)
          .set({
            publicStatus: scoring.publicStatus,
            publicEligibilityScore: scoring.publicEligibilityScore,
            publicEligibilityReason: scoring.publicEligibilityReason,
            updatedAt: new Date(),
          })
          .where(eq(questions.id, row.id));
      }

      if (scoring.publicStatus === 'eligible_pending') results.approved += 1;
      else if (scoring.publicStatus === 'rejected') results.rejected += 1;
      else results.deferred += 1;
    } catch (error) {
      results.failed += 1;
      console.warn('[cron/vet-questions] question failed', {
        questionId: row.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return NextResponse.json(results);
}
