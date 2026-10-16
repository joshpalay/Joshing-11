/**
 * Shared Message Batches plumbing for latency-insensitive crons (vet-questions,
 * backfill-supply). Batch tokens bill at 50%; most batches end within an hour
 * and every batch ends (possibly expired) within 24h.
 *
 * Each cron pass is two phases, same contract as quality/verify-batch.ts:
 *   1. HARVEST every 'submitted' run of its kind: ended batches hand each
 *      result to the caller and ledger succeeded usage with isBatch: true.
 *   2. SUBMIT a new batch only when nothing of that kind is still in flight and
 *      none was submitted within MIN_SUBMIT_GAP_MS. Each cron runs twice a day
 *      (submit, then a later harvest pass); the gap keeps that to one
 *      submission a day so the same work is never paid for twice.
 *
 * Fail-open: an errored / expired / canceled result reaches the caller as
 * `null`, which writes nothing, so the work is re-picked by a later submission.
 */
import type Anthropic from '@anthropic-ai/sdk';

import { sanitizeParamsForModel } from '@/lib/llm';
import {
  latestCronBatchSubmittedAt,
  listSubmittedCronBatchRuns,
  markCronBatchRun,
  recordCronBatchRun,
  type CronBatchKind,
  type CronBatchRunRow,
} from '@/server/db/queries/cron-batch';
import { recordLlmUsage } from '@/server/db/queries/llm-provider-experiment';

export function isFlagOn(name: string): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  return raw === 'true' || raw === '1' || raw === 'yes' || raw === 'on';
}

// Same give-up horizon as verify-batch: results live 29 days, a batch ends in ≤24h.
const STALE_RUN_MS = 7 * 24 * 60 * 60 * 1000;
export const MIN_SUBMIT_GAP_MS = 20 * 60 * 60 * 1000;

export type CronBatchRequest = { custom_id: string; params: Anthropic.MessageCreateParamsNonStreaming };

export async function submitCronBatch(
  client: Anthropic,
  kind: CronBatchKind,
  requests: CronBatchRequest[],
  payload: Record<string, unknown> = {},
): Promise<{ providerBatchId: string; requestCount: number }> {
  const batch = await client.messages.batches.create({
    requests: requests.map((r) => ({ custom_id: r.custom_id, params: sanitizeParamsForModel(r.params) })),
  });
  await recordCronBatchRun(kind, batch.id, requests.length, payload);
  console.info('[cron-batch] submitted', { kind, providerBatchId: batch.id, requestCount: requests.length });
  return { providerBatchId: batch.id, requestCount: requests.length };
}

export type CronHarvestSummary = {
  runsChecked: number;
  runsHarvested: number;
  runsStillProcessing: number;
  runsFailed: number;
  /** Results that wrote nothing (errored/expired/canceled, or the handler threw). */
  resultFailures: number;
};

/**
 * Harvest every pending run of `kind`. `onResult` receives the succeeded
 * message (or null for a failed result) plus the run; it owns all store
 * writes. A run is marked harvested only after every result was handed over,
 * so a crash mid-run re-delivers on the next pass — handlers must be
 * idempotent (guard writes on the row still being in its pending state).
 */
export async function harvestCronBatches(
  client: Anthropic,
  kind: CronBatchKind,
  scope: string,
  now: Date,
  onResult: (customId: string, message: Anthropic.Message | null, run: CronBatchRunRow) => Promise<void>,
): Promise<CronHarvestSummary> {
  const summary: CronHarvestSummary = { runsChecked: 0, runsHarvested: 0, runsStillProcessing: 0, runsFailed: 0, resultFailures: 0 };
  for (const run of await listSubmittedCronBatchRuns(kind)) {
    summary.runsChecked += 1;
    const stale = now.getTime() - run.createdAt.getTime() > STALE_RUN_MS;
    try {
      const batch = await client.messages.batches.retrieve(run.providerBatchId);
      if (batch.processing_status !== 'ended') {
        if (stale) {
          await markCronBatchRun(run.id, 'failed', now);
          summary.runsFailed += 1;
        } else {
          summary.runsStillProcessing += 1;
        }
        continue;
      }
      for await (const result of await client.messages.batches.results(run.providerBatchId)) {
        const message = result.result.type === 'succeeded' ? result.result.message : null;
        if (message) {
          const usage = message.usage;
          void recordLlmUsage({
            scope,
            provider: 'anthropic',
            model: message.model,
            inputTokens: usage?.input_tokens ?? 0,
            outputTokens: usage?.output_tokens ?? 0,
            cacheReadTokens: usage?.cache_read_input_tokens ?? 0,
            cacheCreateTokens: usage?.cache_creation_input_tokens ?? 0,
            isBatch: true,
          });
        } else {
          summary.resultFailures += 1;
        }
        try {
          await onResult(result.custom_id, message, run);
        } catch (error) {
          if (message) summary.resultFailures += 1;
          console.warn('[cron-batch] result handler failed', {
            kind,
            customId: result.custom_id,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
      await markCronBatchRun(run.id, 'harvested', now);
      summary.runsHarvested += 1;
    } catch (error) {
      console.warn('[cron-batch] harvest failed for run', {
        kind,
        providerBatchId: run.providerBatchId,
        error: error instanceof Error ? error.message : String(error),
      });
      // A 404 (results gone, or another workspace's key) or a run past the
      // stale cutoff is permanent: give up so it cannot block submissions
      // forever (the 2026-08-27 verify freeze). Its work is re-picked later.
      if ((error as { status?: number } | null)?.status === 404 || stale) {
        try {
          await markCronBatchRun(run.id, 'failed', now);
          summary.runsFailed += 1;
          continue;
        } catch {
          // Couldn't record the give-up — retry next pass.
        }
      }
      summary.runsStillProcessing += 1;
    }
  }
  return summary;
}

/** Submit only when nothing is in flight and the last submission is old enough. */
export async function mayCronBatchSubmit(kind: CronBatchKind, harvest: CronHarvestSummary, now: Date): Promise<boolean> {
  if (harvest.runsStillProcessing > 0) return false;
  const last = await latestCronBatchSubmittedAt(kind);
  return !last || now.getTime() - last.getTime() >= MIN_SUBMIT_GAP_MS;
}
