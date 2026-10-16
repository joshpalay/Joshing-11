/**
 * Batch-API mode for the /api/cron/vet-questions sweep (VET_QUESTIONS_BATCH_ENABLED,
 * default OFF → the original synchronous sweep). Same request, same verdict
 * mapping, same safety hard-block; only the transport changes, at 50% token cost.
 *
 * Only the nightly SWEEP is batched. The inline vet on question create, the
 * crafter keep path and admin craft stay synchronous — a person is waiting.
 *
 * Latency: the cron runs at 07:00 (harvest + submit) and again at 08:30
 * (harvest). A safety-fail first caught by the sweep is therefore applied about
 * 1.5h later than today in the common case, and at worst the next morning if
 * the batch runs long. Results are applied only to rows still 'not_scored' and
 * not blocked or deleted, so a row that changed meanwhile is left alone.
 */
import { and, eq, isNull, ne } from 'drizzle-orm';

import { extractTextContent, getAnthropicClient } from '@/lib/llm';
import { db, questions } from '@/server/db';
import {
  harvestCronBatches,
  isFlagOn,
  mayCronBatchSubmit,
  submitCronBatch,
  type CronHarvestSummary,
} from '@/server/llm/cron-batch';
import { buildVetRequestParams, parseVetResponse } from '@/server/llm/vet-question';
import { verdictToBlockedVisibility, verdictToPublicStatus, type VetVerdict } from '@/server/llm/vet-verdict';

export function isVetBatchEnabled(): boolean {
  return isFlagOn('VET_QUESTIONS_BATCH_ENABLED');
}

const SUBMIT_LIMIT = 25; // same per-day scan as the sync sweep
const CUSTOM_ID_PREFIX = 'v_';

export type VetTally = { approved: number; rejected: number; deferred: number; skipped: number; failed: number };

/** Apply one verdict, but only if the row is still awaiting a vet. Returns what happened. */
export async function applyVetVerdict(questionId: string, verdict: VetVerdict): Promise<keyof VetTally> {
  const scoring = verdictToPublicStatus(verdict);
  const blockedVisibility = verdictToBlockedVisibility(verdict);
  const updated = await db
    .update(questions)
    .set({
      publicStatus: scoring.publicStatus,
      publicEligibilityScore: scoring.publicEligibilityScore,
      publicEligibilityReason: scoring.publicEligibilityReason,
      ...(blockedVisibility ? { visibility: blockedVisibility } : {}),
      updatedAt: new Date(),
    })
    .where(and(
      eq(questions.id, questionId),
      eq(questions.publicStatus, 'not_scored'),
      ne(questions.visibility, 'blocked'),
      isNull(questions.deletedAt),
    ))
    .returning({ id: questions.id });
  if (updated.length === 0) return 'skipped';
  if (scoring.publicStatus === 'eligible_pending') return 'approved';
  if (scoring.publicStatus === 'rejected') return 'rejected';
  return 'deferred';
}

/** `submit: false` is the later harvest-only pass (vet-questions/harvest). */
export async function runVetBatchSweep(now: Date, opts: { submit: boolean } = { submit: true }): Promise<{
  mode: 'batch';
  error?: string;
  harvest?: CronHarvestSummary & { applied: VetTally };
  submit?: { scanned: number; batch: { providerBatchId: string; requestCount: number } | null; skippedReason: string | null };
}> {
  const client = getAnthropicClient();
  if (!client) return { mode: 'batch', error: 'anthropic client unavailable' };

  const applied: VetTally = { approved: 0, rejected: 0, deferred: 0, skipped: 0, failed: 0 };
  const harvest = await harvestCronBatches(client, 'vet', 'vet-question', now, async (customId, message) => {
    if (!message || !customId.startsWith(CUSTOM_ID_PREFIX)) return; // fail-open: row stays not_scored
    try {
      const verdict = parseVetResponse(extractTextContent(message.content));
      applied[await applyVetVerdict(customId.slice(CUSTOM_ID_PREFIX.length), verdict)] += 1;
    } catch (error) {
      applied.failed += 1;
      throw error;
    }
  });

  if (!opts.submit || !(await mayCronBatchSubmit('vet', harvest, now))) {
    const skippedReason = !opts.submit ? 'harvest-only pass' : harvest.runsStillProcessing > 0 ? 'batch still in flight' : 'already submitted today';
    return { mode: 'batch', harvest: { ...harvest, applied }, submit: { scanned: 0, batch: null, skippedReason } };
  }

  // Same scope as the sync sweep: every visibility except 'blocked'.
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
      ne(questions.visibility, 'blocked'),
      isNull(questions.deletedAt),
    ))
    .limit(SUBMIT_LIMIT);

  let batch: { providerBatchId: string; requestCount: number } | null = null;
  if (pending.length > 0) {
    try {
      batch = await submitCronBatch(client, 'vet', pending.map((row) => ({
        custom_id: `${CUSTOM_ID_PREFIX}${row.id}`,
        params: buildVetRequestParams({
          questionText: row.questionText,
          answer: row.answerText,
          alternateAnswers: row.acceptedAlternatives ?? [],
          explanation: row.factualExplanation,
          broadCategory: row.broadCategory,
          canonicalSubcategory: row.canonicalSubcategory,
        }),
      })));
    } catch (error) {
      console.error('[vet-batch] submit failed', { error: error instanceof Error ? error.message : String(error) });
    }
  }
  return { mode: 'batch', harvest: { ...harvest, applied }, submit: { scanned: pending.length, batch, skippedReason: null } };
}
