/**
 * Salvage sweep (D-QUALITY-SALVAGE-01) — the shared propose→re-verify→persist
 * pipeline over the demoted-question review queue.
 *
 * Extracted from scripts/salvage-demoted.ts so the batch-verify cron can chase
 * every fresh demotion with a machine-proposed minimal fix automatically: by the
 * time a human opens /admin/reports, ~80% of demotion cards already carry a
 * one-click "Approve fix". The script remains the manual/bulk entry point
 * (dry-run default); both callers share this exact pipeline.
 *
 * Contract (unchanged from the script):
 *   - Nothing is ever applied to Question rows here — only QuestionSalvageProposal
 *     rows are written, and only when `persist` is true.
 *   - A proposal becomes 'ready' ONLY when the re-verified proposed text passes;
 *     anything else is stored 'unsalvageable' so a bad fix is never offered.
 *   - Questions that already have ANY proposal are skipped (never re-spend);
 *     an item that ERRORS persists nothing, so the next sweep retries it.
 */
import { getMachineDemotionsForReview } from '@/server/db/queries/machine-demotions';
import {
  questionIdsWithProposal,
  upsertSalvageProposal,
} from '@/server/db/queries/salvage-proposals';
import { runWithConcurrency } from '@/server/lib/concurrency';
import { proposeSalvage } from '@/server/quality/salvage-question';
import { verifyQuestion } from '@/server/quality/verify-question';

/** DEFAULT ON — set SALVAGE_ON_DEMOTE_ENABLED=false to stop the cron-chained
 *  sweep without a deploy (the manual script is unaffected by this flag). */
export function isSalvageOnDemoteEnabled(): boolean {
  const raw = process.env.SALVAGE_ON_DEMOTE_ENABLED?.trim().toLowerCase();
  return !(raw === 'false' || raw === '0' || raw === 'no' || raw === 'off');
}

export type SalvageSweepItem = {
  questionId: string;
  questionText: string;
  correctAnswer: string;
  explanation: string | null;
  verificationReason: string | null;
  canonicalSubcategory: string | null;
  broadCategory: string | null;
};

export type SalvageItemOutcome = 'ready' | 'reverify_failed' | 'unsalvageable' | 'error';

export type SalvageItemResult = { outcome: SalvageItemOutcome; note: string };

/**
 * Propose the minimal fix for one demoted question, re-verify the PROPOSED
 * version against the EXISTING answer, and (when `persist`) store the proposal —
 * 'ready' only if the re-verify passes. Never edits the question itself.
 */
export async function salvageOneDemotedQuestion(
  item: SalvageSweepItem,
  persist: boolean,
): Promise<SalvageItemResult> {
  const proposal = await proposeSalvage({
    questionText: item.questionText,
    answer: item.correctAnswer,
    explanation: item.explanation,
    verificationReason: item.verificationReason ?? 'demoted (reason not captured)',
    canonicalSubcategory: item.canonicalSubcategory,
    broadCategory: item.broadCategory,
  });

  if (proposal.kind === 'unsalvageable') {
    if (persist) {
      await upsertSalvageProposal({
        questionId: item.questionId,
        targetTable: 'question',
        kind: 'unsalvageable',
        proposedStem: null,
        proposedExplanation: null,
        reverifyOutcome: 'demoted',
        reverifyReason: proposal.note,
        status: 'unsalvageable',
      });
    }
    return { outcome: 'unsalvageable', note: proposal.note };
  }

  // Re-verify the PROPOSED version against the EXISTING answer (verifyQuestion
  // directly — rerunQuestion would regenerate the answer + overwrite our
  // proposed explainer). Fall back to originals for the field we didn't touch.
  const reverify = await verifyQuestion({
    questionText: proposal.proposedStem ?? item.questionText,
    answer: item.correctAnswer,
    explanation: proposal.proposedExplanation ?? item.explanation ?? undefined,
    canonicalSubcategory: item.canonicalSubcategory ?? undefined,
    broadCategory: item.broadCategory ?? undefined,
    dimensions: ['false_premise', 'extra_fact'],
  });

  // Only a proposal that now PASSES becomes 'ready'; anything else is not shown.
  const passed = reverify?.outcome === 'ok';
  if (persist) {
    await upsertSalvageProposal({
      questionId: item.questionId,
      targetTable: 'question',
      kind: proposal.kind,
      proposedStem: proposal.proposedStem,
      proposedExplanation: proposal.proposedExplanation,
      reverifyOutcome: reverify?.outcome ?? 'unverifiable',
      reverifyReason: reverify?.reason ?? 'reverify unavailable',
      status: passed ? 'ready' : 'unsalvageable',
    });
  }
  return {
    outcome: passed ? 'ready' : 'reverify_failed',
    note: `${proposal.kind}: ${proposal.note}${passed ? '' : ` → reverify=${reverify?.outcome ?? 'none'}`}`,
  };
}

export type SalvageSweepSummary = {
  /** Demotion cards currently in the review queue. */
  queued: number;
  /** Skipped: a proposal (any status) already exists — never re-spend. */
  alreadyProposed: number;
  /** Items actually run through the pipeline this sweep (post-skip, post-limit). */
  processed: number;
  ready: number;
  reverifyFailed: number;
  unsalvageable: number;
  /** Threw mid-pipeline: nothing persisted, retried by the next sweep. */
  errors: number;
};

export type SalvageSweepOptions = {
  /** false = dry-run: propose + re-verify but write nothing (the script default). */
  persist: boolean;
  /** Max items processed (post-skip). Callers on a request deadline set this. */
  limit?: number;
  /** LLM-bound workers in flight; keep small inside the cron (DB pool is 5). */
  concurrency?: number;
  /** Per-item progress hook (the script's console census). */
  onItem?: (item: SalvageSweepItem, result: SalvageItemResult) => void;
};

/**
 * Run the salvage pipeline over every un-proposed demotion in the review queue,
 * up to `limit`. Item faults are contained (counted, nothing persisted) so one
 * bad row never aborts the sweep; leftovers self-heal on the next pass because
 * the skip guard only skips rows that got a persisted proposal.
 */
export async function runSalvageSweep(options: SalvageSweepOptions): Promise<SalvageSweepSummary> {
  const { persist, limit, concurrency = 3, onItem } = options;

  const queue = await getMachineDemotionsForReview();
  const already = await questionIdsWithProposal(queue.map((q) => q.questionId));
  const unproposed = queue.filter((q) => !already.has(q.questionId));
  const todo = limit !== undefined ? unproposed.slice(0, Math.max(0, limit)) : unproposed;

  const summary: SalvageSweepSummary = {
    queued: queue.length,
    alreadyProposed: already.size,
    processed: todo.length,
    ready: 0,
    reverifyFailed: 0,
    unsalvageable: 0,
    errors: 0,
  };

  await runWithConcurrency(todo, concurrency, async (item) => {
    // runWithConcurrency does not isolate failures — contain them here.
    let result: SalvageItemResult;
    try {
      result = await salvageOneDemotedQuestion(item, persist);
    } catch (error) {
      result = {
        outcome: 'error',
        note: error instanceof Error ? error.message : String(error),
      };
    }
    if (result.outcome === 'ready') summary.ready += 1;
    else if (result.outcome === 'reverify_failed') summary.reverifyFailed += 1;
    else if (result.outcome === 'unsalvageable') summary.unsalvageable += 1;
    else summary.errors += 1;
    onItem?.(item, result);
  });

  return summary;
}
