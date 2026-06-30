/**
 * Nightly batch-verification sweep (D-QUESTION-QUALITY-AGENTS-01).
 *
 * Sweeps Question rows that have not yet been batch-verified (verifiedAt IS NULL),
 * applies the pre-filter, then runs a Haiku verification pass checking for:
 *   B-i: false/incorrect premises in the question text
 *   B-ii: wrong-attribute answers (adjacent-fact answers)
 *
 * Decision A authority: if the verifier is confident of an error, flips the
 * question's publicStatus back to 'not_scored' (pulls from circulation for human
 * review) and stamps verificationVerdict = 'demoted'. All other outcomes stamp
 * the row as verified without touching publicStatus. A demote never auto-corrects
 * an answer; it surfaces the question to the owner/admin for manual inspection.
 *
 * Each question is processed once ever — verifiedAt is a lifetime stamp; this
 * sweep never re-processes a stamped row. Telemetry is automatic via
 * loggedMessagesCreate → recordLlmUsage (scope 'batch-verify').
 */
import { NextRequest, NextResponse } from 'next/server';

import { isCronAuthorized } from '@/server/auth/cron';
import { getPendingVerificationBatch, stampVerification } from '@/server/db/queries/batch-verify';
import { runWithConcurrency } from '@/server/lib/concurrency';
import { batchVerifyQuestion, prefilterQuestion } from '@/server/llm/batch-verify';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const BATCH_SIZE = 25;
// 4 concurrent LLM calls; stay one below the 5-cap DB pool (each worker also
// does one DB write per question). Matches vet-questions concurrency.
const VERIFY_CONCURRENCY = 4;

export async function GET(request: NextRequest) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const pending = await getPendingVerificationBatch(BATCH_SIZE);

  const results = {
    scanned: pending.length,
    skipped: 0,
    verified_ok: 0,
    verified_volatile: 0,
    demoted: 0,
    unverifiable: 0,
    failed: 0,
  };

  await runWithConcurrency(pending, VERIFY_CONCURRENCY, async (row) => {
    try {
      const prefilter = prefilterQuestion({
        questionText: row.questionText,
        questionType: row.questionType,
      });

      if (prefilter === 'skip') {
        await stampVerification({ questionId: row.id, verdict: 'skipped' });
        results.skipped += 1;
        return;
      }

      const bvResult = await batchVerifyQuestion({
        questionText: row.questionText,
        answerText: row.answerText,
        alternateAnswers: row.acceptedAlternatives,
        explanation: row.factualExplanation,
        broadCategory: row.broadCategory,
        canonicalSubcategory: row.canonicalSubcategory,
      });

      if (bvResult.verdict === 'error') {
        // LLM error — leave verifiedAt unset so the next sweep can retry.
        results.failed += 1;
        console.warn('[cron/batch-verify-questions] llm_error', {
          questionId: row.id,
          reason: bvResult.reason,
        });
        return;
      }

      if (bvResult.verdict === 'demote') {
        // Decision A: only demote if the question is currently eligible (in
        // circulation). A question already at 'rejected' or 'not_scored' gains
        // nothing from a status flip.
        const isEligible = row.publicStatus === 'eligible_pending';
        await stampVerification({
          questionId: row.id,
          verdict: 'demoted',
          demoteToNeedsReview: isEligible,
        });
        results.demoted += 1;
        console.info('[cron/batch-verify-questions] demoted', {
          questionId: row.id,
          wasEligible: isEligible,
          reason: bvResult.reason,
        });
        return;
      }

      const dbVerdict = bvResult.verdict === 'unverifiable' ? 'unverifiable' : 'ok';
      await stampVerification({ questionId: row.id, verdict: dbVerdict });

      if (bvResult.verdict === 'unverifiable') {
        results.unverifiable += 1;
      } else if (prefilter === 'volatile') {
        results.verified_volatile += 1;
      } else {
        results.verified_ok += 1;
      }
    } catch (error) {
      results.failed += 1;
      console.warn('[cron/batch-verify-questions] question_failed', {
        questionId: row.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  return NextResponse.json(results);
}
