/**
 * Batch-API mode for the batch-verify cron (follow-up to
 * docs/findings/batch-verify-cost-characterization.md — the cron is the largest
 * recurring LLM line, and it is completely latency-insensitive, which is exactly
 * the Message Batches API's shape: 50% off all token usage, no per-call timeout,
 * and the docs confirm server tools (web_search) run inside a batch with
 * org-level throttling handled by the batch worker).
 *
 * Two-phase across daily cron runs, gated on BATCH_VERIFY_ASYNC_ENABLED
 * (default OFF → the existing synchronous path):
 *   1. HARVEST: retrieve every 'submitted' VerifyBatchRun; for ended batches,
 *      parse each result into a verdict (the caller applies the store patches)
 *      and ledger its usage with isBatch: true (50% token pricing).
 *   2. SUBMIT: build one request per routed row (same request the sync path
 *      sends — buildVerifyRequestParams — sanitized per model since this path
 *      bypasses loggedMessagesCreate) and create a new batch.
 *
 * Fail-open contract preserved end-to-end: an errored / expired / unparseable
 * result stamps nothing, so the row stays verifiedAt IS NULL and the next
 * submission re-picks it.
 */
import type Anthropic from '@anthropic-ai/sdk';

import { extractTextContent, sanitizeParamsForModel } from '@/lib/llm';
import { recordLlmUsage } from '@/server/db/queries/llm-provider-experiment';
import {
  listSubmittedVerifyBatchRuns,
  markVerifyBatchRunFailed,
  markVerifyBatchRunHarvested,
  recordVerifyBatchRun,
} from '@/server/db/queries/verify-batch';
import {
  buildVerifyRequestParams,
  parseVerifyVerdict,
  type VerifyInput,
} from '@/server/quality/verify-question';

export function isBatchVerifyAsyncEnabled(): boolean {
  const raw = process.env.BATCH_VERIFY_ASYNC_ENABLED?.trim().toLowerCase();
  return raw === 'true' || raw === '1' || raw === 'yes' || raw === 'on';
}

/** 'q' = Question, 'g' = GeneratedQuestion — encoded into the batch custom_id. */
export type VerifyStore = 'q' | 'g';

export function encodeVerifyCustomId(store: VerifyStore, rowId: string): string {
  return `${store}:${rowId}`;
}

export function decodeVerifyCustomId(
  customId: string,
): { store: VerifyStore; rowId: string } | null {
  const match = /^([qg]):(.+)$/.exec(customId);
  if (!match) return null;
  return { store: match[1] as VerifyStore, rowId: match[2] };
}

export type BatchRowInput = VerifyInput & { store: VerifyStore; rowId: string };

/**
 * Submit one batch covering `rows`. Tracking is recorded BEFORE returning; if the
 * tracking insert fails the error propagates (an untracked batch is spend we can
 * never harvest — the caller must see that loudly).
 */
export async function submitVerifyBatch(
  client: Anthropic,
  rows: BatchRowInput[],
): Promise<{ providerBatchId: string; requestCount: number }> {
  const requests: Anthropic.Messages.BatchCreateParams['requests'] = rows.map((row) => ({
    custom_id: encodeVerifyCustomId(row.store, row.rowId),
    params: sanitizeParamsForModel(buildVerifyRequestParams(row)),
  }));
  const batch = await client.messages.batches.create({ requests });
  await recordVerifyBatchRun(batch.id, requests.length);
  console.info('[verify-batch] submitted', { providerBatchId: batch.id, requestCount: requests.length });
  return { providerBatchId: batch.id, requestCount: requests.length };
}

export type HarvestedVerdict = {
  store: VerifyStore;
  rowId: string;
  outcome: 'ok' | 'demoted' | 'unverifiable';
  reason: string;
};

export type HarvestSummary = {
  runsChecked: number;
  runsHarvested: number;
  runsStillProcessing: number;
  runsFailed: number;
  /** Results that stamped nothing (errored/expired/canceled/unparseable) — those
   *  rows stay unstamped and are re-picked by the next submission. */
  resultFailures: number;
  verdicts: HarvestedVerdict[];
};

// A batch processes for ≤24h and results live 29 days; a run still 'submitted'
// after this long is wedged (or its results were never retrievable) — give up so
// it stops blocking new submissions. Its rows are unstamped and get re-picked.
const STALE_RUN_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Retrieve every pending run and turn ended batches into verdicts. DB writes to
 * question stores are the CALLER's job (it owns the patch helpers + tallies);
 * this module only writes run-tracking rows and the usage ledger.
 */
export async function harvestVerifyBatches(
  client: Anthropic,
  now: Date,
): Promise<HarvestSummary> {
  const summary: HarvestSummary = {
    runsChecked: 0,
    runsHarvested: 0,
    runsStillProcessing: 0,
    runsFailed: 0,
    resultFailures: 0,
    verdicts: [],
  };

  const runs = await listSubmittedVerifyBatchRuns();
  for (const run of runs) {
    summary.runsChecked += 1;
    try {
      const batch = await client.messages.batches.retrieve(run.providerBatchId);
      if (batch.processing_status !== 'ended') {
        if (now.getTime() - run.createdAt.getTime() > STALE_RUN_MS) {
          await markVerifyBatchRunFailed(run.id, now);
          summary.runsFailed += 1;
          console.warn('[verify-batch] stale run marked failed', { providerBatchId: run.providerBatchId });
        } else {
          summary.runsStillProcessing += 1;
        }
        continue;
      }

      for await (const result of await client.messages.batches.results(run.providerBatchId)) {
        const decoded = decodeVerifyCustomId(result.custom_id);
        if (!decoded || result.result.type !== 'succeeded') {
          summary.resultFailures += 1;
          continue; // fail-open: no stamp → re-picked next submission
        }
        const message = result.result.message;
        const usage = message.usage;
        // Ledger with the 50% batch token discount marker. Web-search requests
        // are billed at the flat per-request rate (not token usage), so the
        // discount deliberately does not apply to them (pricing.ts).
        void recordLlmUsage({
          scope: 'batch-verify',
          provider: 'anthropic',
          model: message.model,
          inputTokens: usage?.input_tokens ?? 0,
          outputTokens: usage?.output_tokens ?? 0,
          cacheReadTokens: usage?.cache_read_input_tokens ?? 0,
          cacheCreateTokens: usage?.cache_creation_input_tokens ?? 0,
          webSearchRequests:
            (usage as { server_tool_use?: { web_search_requests?: number } } | undefined)
              ?.server_tool_use?.web_search_requests ?? 0,
          isBatch: true,
        });
        const parsed = parseVerifyVerdict(extractTextContent(message.content));
        if (!parsed) {
          summary.resultFailures += 1;
          continue;
        }
        summary.verdicts.push({ ...decoded, outcome: parsed.outcome, reason: parsed.reason });
      }

      await markVerifyBatchRunHarvested(run.id, now);
      summary.runsHarvested += 1;
    } catch (error) {
      // Leave the run 'submitted' — retried on the next cron pass (and given up
      // via the stale cutoff if it never recovers).
      summary.runsStillProcessing += 1;
      console.warn('[verify-batch] harvest failed for run', {
        providerBatchId: run.providerBatchId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return summary;
}
