import { and, eq, gt, isNull, ne } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';

import { db, generatedQuestions, questions } from '@/server/db';
import { isCronAuthorized } from '@/server/auth/cron';
import { runWithConcurrency } from '@/server/lib/concurrency';
import { prefilterForVerification } from '@/server/quality/verification-prefilter';
import {
  verdictToGeneratedPatch,
  verdictToQuestionPatch,
  verifyQuestion,
  type VerificationVerdict,
} from '@/server/quality/verify-question';

export const dynamic = 'force-dynamic';
// Each row may make a Sonnet call plus an occasional web search; mirror the
// vet-questions ceiling so a batch completes instead of being platform-killed.
export const maxDuration = 300;

const BATCH_SIZE = 25; // per store
// One below the 5-cap DB pool (see src/server/db/index.ts), matching VET_CONCURRENCY.
// Each worker holds an LLM (and maybe a web-search) call in flight.
const VERIFY_CONCURRENCY = 4;

type PendingRow = {
  id: string;
  questionText: string;
  answer: string;
  explanation: string | null;
  canonicalSubcategory: string | null;
  broadCategory: string | null;
};

type Tally = { scanned: number; skipped: number; ok: number; demoted: number; unverifiable: number; failed: number };

function emptyTally(scanned: number): Tally {
  return { scanned, skipped: 0, ok: 0, demoted: 0, unverifiable: 0, failed: 0 };
}

/**
 * Batch verification sweep (B-QUESTION-QUALITY-AGENTS-01 Phase 3). Demote-only,
 * batch-only — NEVER a write-time gate, NEVER overwrites an author's answer.
 *
 * Sweeps both question stores for rows not yet stamped (verified_at IS NULL):
 *   - Question        — eligible, not blocked, not deleted; a demote sets
 *                       publicStatus = 'needs_review'.
 *   - GeneratedQuestion — not already suppressed, not expired; a demote sets
 *                       is_duplicate = true (the only suppress flag the bank honors).
 * Per row: pure pre-filter (Phase 2) decides skip vs verify; verify runs the
 * grounded verifier (knowledge-first, web fallback). Every outcome stamps
 * verified_at + verification_verdict so the row is never re-processed. A verifier
 * FAILURE (null) leaves the row unstamped so the next sweep retries it (fail-open).
 */
export async function GET(request: NextRequest) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const now = new Date();

  const [pendingQuestions, pendingGenerated] = await Promise.all([
    db
      .select({
        id: questions.id,
        questionText: questions.questionText,
        answer: questions.answerText,
        explanation: questions.factualExplanation,
        canonicalSubcategory: questions.canonicalSubcategory,
        broadCategory: questions.broadCategory,
      })
      .from(questions)
      .where(and(
        isNull(questions.verifiedAt),
        ne(questions.visibility, 'blocked'),
        isNull(questions.deletedAt),
      ))
      .limit(BATCH_SIZE),
    db
      .select({
        id: generatedQuestions.id,
        questionText: generatedQuestions.questionText,
        answer: generatedQuestions.answer,
        explanation: generatedQuestions.explainer,
        canonicalSubcategory: generatedQuestions.canonicalSubcategory,
        broadCategory: generatedQuestions.broadCategory,
      })
      .from(generatedQuestions)
      .where(and(
        isNull(generatedQuestions.verifiedAt),
        eq(generatedQuestions.isDuplicate, false),
        gt(generatedQuestions.expiresAt, now),
      ))
      .limit(BATCH_SIZE),
  ]);

  const questionTally = emptyTally(pendingQuestions.length);
  const generatedTally = emptyTally(pendingGenerated.length);

  // Resolve a row to a verdict, then apply the store-appropriate patch. Returns
  // the verdict tally key, or 'failed' (left unstamped → retried next sweep).
  async function resolveVerdict(row: PendingRow): Promise<VerificationVerdict | 'failed'> {
    const decision = prefilterForVerification({
      questionText: row.questionText,
      answer: row.answer,
      explanation: row.explanation,
    });
    if (!decision.needsVerification) return 'skipped';

    const result = await verifyQuestion({
      questionText: row.questionText,
      answer: row.answer,
      explanation: row.explanation,
      canonicalSubcategory: row.canonicalSubcategory,
      broadCategory: row.broadCategory,
      dimensions: decision.dimensions,
    });
    if (!result) return 'failed'; // fail-open: no stamp
    return result.outcome;
  }

  function tally(into: Tally, verdict: VerificationVerdict | 'failed') {
    if (verdict === 'failed') into.failed += 1;
    else into[verdict] += 1;
  }

  await runWithConcurrency(pendingQuestions, VERIFY_CONCURRENCY, async (row) => {
    try {
      const verdict = await resolveVerdict(row);
      if (verdict === 'failed') {
        questionTally.failed += 1;
        return;
      }
      await db.update(questions).set(verdictToQuestionPatch(verdict, now)).where(eq(questions.id, row.id));
      tally(questionTally, verdict);
    } catch (error) {
      questionTally.failed += 1;
      console.warn('[cron/batch-verify-questions] Question row failed', {
        questionId: row.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  await runWithConcurrency(pendingGenerated, VERIFY_CONCURRENCY, async (row) => {
    try {
      const verdict = await resolveVerdict(row);
      if (verdict === 'failed') {
        generatedTally.failed += 1;
        return;
      }
      await db
        .update(generatedQuestions)
        .set(verdictToGeneratedPatch(verdict, now))
        .where(eq(generatedQuestions.id, row.id));
      tally(generatedTally, verdict);
    } catch (error) {
      generatedTally.failed += 1;
      console.warn('[cron/batch-verify-questions] GeneratedQuestion row failed', {
        generatedQuestionId: row.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  return NextResponse.json({ question: questionTally, generated: generatedTally });
}
