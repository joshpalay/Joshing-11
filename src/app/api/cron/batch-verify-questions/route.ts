import { and, eq, isNull, ne } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';

import { db, generatedQuestions, questions } from '@/server/db';
import { getAnthropicClient } from '@/lib/llm';
import { isCronAuthorized } from '@/server/auth/cron';
import { runWithConcurrency } from '@/server/lib/concurrency';
import {
  prefilterForVerification,
  type PrefilterOptions,
} from '@/server/quality/verification-prefilter';
import {
  isSalvageOnDemoteEnabled,
  runSalvageSweep,
  type SalvageSweepSummary,
} from '@/server/quality/salvage-sweep';
import {
  harvestVerifyBatches,
  isBatchVerifyAsyncEnabled,
  submitVerifyBatch,
  type BatchRowInput,
} from '@/server/quality/verify-batch';
import {
  verdictToGeneratedPatch,
  verdictToQuestionPatch,
  verifyQuestion,
  type VerificationVerdict,
} from '@/server/quality/verify-question';
import {
  isSalvageGeneratedOnDemoteEnabled,
  salvageOrSuppressGeneratedDemote,
  type GeneratedDemoteRow,
} from '@/server/quality/salvage-generated';

export const dynamic = 'force-dynamic';
// Each row may make a Sonnet call plus an occasional web search; mirror the
// vet-questions ceiling so a batch completes instead of being platform-killed.
// (Async mode never holds an LLM call open — harvest + submit are quick HTTP.)
export const maxDuration = 300;

const BATCH_SIZE = 25; // per store (sync mode)
// Async mode scans more per day: batch tokens bill at 50%, there is no per-call
// timeout pressure, and 25/day sat under GeneratedQuestion's ~26/day inflow so
// its unstamped backlog crept ~1/day (batch-verify-cost-characterization.md §1/§4).
const ASYNC_BATCH_SIZE = Math.max(1, Number(process.env.BATCH_VERIFY_ASYNC_BATCH_SIZE ?? 40));
// One below the 5-cap DB pool (see src/server/db/index.ts), matching VET_CONCURRENCY.
// Each worker holds an LLM (and maybe a web-search) call in flight.
const VERIFY_CONCURRENCY = 4;

// Operational escape hatches for the 2026-07 prefilter tightenings, both
// restorable without a deploy: PREFILTER_EXTRA_FACT_LEGACY=true restores the
// pre-tightening ANSWER routing (any comma/paren/"and" routes);
// PREFILTER_EXPLANATION_LEGACY=true restores the pre-tightening EXPLANATION
// routing (any one signal OR length ≥140 routes — the measured ~90% router).
function prefilterOptions(): PrefilterOptions {
  const flag = (name: string) => {
    const raw = process.env[name]?.trim().toLowerCase();
    return raw === 'true' || raw === '1' || raw === 'yes' || raw === 'on';
  };
  return {
    legacyExtraFact: flag('PREFILTER_EXTRA_FACT_LEGACY'),
    legacyExplanation: flag('PREFILTER_EXPLANATION_LEGACY'),
  };
}

type PendingRow = {
  id: string;
  questionText: string;
  answer: string;
  explanation: string | null;
  canonicalSubcategory: string | null;
  broadCategory: string | null;
};

type Tally = {
  scanned: number;
  skipped: number;
  ok: number;
  demoted: number;
  unverifiable: number;
  failed: number;
  // Generated-only: a demotion that was auto-repaired (re-verified minimal fix
  // applied) and kept serving, instead of suppressed. See salvage-generated.ts.
  salvaged: number;
};

function emptyTally(scanned: number): Tally {
  return { scanned, skipped: 0, ok: 0, demoted: 0, unverifiable: 0, failed: 0, salvaged: 0 };
}

// Salvage-aware application of a GENERATED demotion: try to auto-repair (keep
// serving) before falling back to suppression. Returns the tally bucket touched.
// Any fault inside resolves to 'demoted' (suppress) — never a silent serve-through.
async function applyGeneratedDemote(
  row: GeneratedDemoteRow,
  reason: string,
  now: Date,
): Promise<'salvaged' | 'demoted'> {
  const res = await salvageOrSuppressGeneratedDemote(row, reason, now);
  return res.action === 'salvaged' ? 'salvaged' : 'demoted';
}

function fetchGeneratedRow(rowId: string): Promise<GeneratedDemoteRow | null> {
  return db
    .select({
      id: generatedQuestions.id,
      questionText: generatedQuestions.questionText,
      answer: generatedQuestions.answer,
      explanation: generatedQuestions.explainer,
      canonicalSubcategory: generatedQuestions.canonicalSubcategory,
      broadCategory: generatedQuestions.broadCategory,
    })
    .from(generatedQuestions)
    .where(eq(generatedQuestions.id, rowId))
    .limit(1)
    .then((rows) => rows[0] ?? null);
}

function selectPending(limit: number): Promise<[PendingRow[], PendingRow[]]> {
  return Promise.all([
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
        // House-authored rows (admin bulk-upload / crafter-keep) are
        // creator-written and admin-trusted at insert time (bulk-upload's own
        // comment: "Admin-uploaded questions are trusted: verified +
        // creator-written") — they still get the free deterministic leak
        // check and the cheap Haiku vet scorer, just never this Sonnet
        // (+ occasional web search) pass. Excluded so a large admin upload
        // can't camp the daily 25-row cap and rack up sync-rate Sonnet spend
        // on content nobody asked to machine-verify (2026-08-31).
        ne(questions.source, 'house_authored'),
      ))
      .limit(limit),
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
        // NO expires_at gate: the pool is DURABLE (D8) — pickBankSource serves
        // rows with no age/expiry filter, so a past-expiry row still reaches
        // players and must still be verifiable. Gating on expires_at > now here
        // stranded ~65 serving-but-expired rows permanently outside the sweep
        // (2026-07-15). Verification eligibility must mirror serving eligibility.
      ))
      .limit(limit),
  ]) as Promise<[PendingRow[], PendingRow[]]>;
}

// D-QUALITY-SALVAGE-01: after the sweep stamps demotions, chase them with the
// salvage pipeline so the review queue already carries one-click "Approve fix"
// proposals when a human opens it. Capped per run to stay inside maxDuration —
// the sweep skips already-proposed rows, so anything left over (cap hit, error,
// or a platform kill mid-salvage) self-heals on the next cron pass. Best-effort
// by contract: a salvage fault never fails the verify sweep.
const SALVAGE_MAX_PER_RUN = Math.max(1, Number(process.env.SALVAGE_ON_DEMOTE_MAX_PER_RUN ?? 8));

type SalvageReport =
  | { enabled: false }
  | ({ enabled: true } & SalvageSweepSummary)
  | { enabled: true; error: string };

async function chaseDemotionsWithSalvage(): Promise<SalvageReport> {
  if (!isSalvageOnDemoteEnabled()) return { enabled: false };
  try {
    const summary = await runSalvageSweep({ persist: true, limit: SALVAGE_MAX_PER_RUN });
    return { enabled: true, ...summary };
  } catch (error) {
    console.warn('[cron/batch-verify-questions] salvage sweep failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return { enabled: true, error: error instanceof Error ? error.message : String(error) };
  }
}

async function stampQuestion(rowId: string, verdict: VerificationVerdict, now: Date, reason?: string) {
  await db
    .update(questions)
    .set(verdictToQuestionPatch(verdict, now, reason))
    .where(eq(questions.id, rowId));
}

async function stampGenerated(rowId: string, verdict: VerificationVerdict, now: Date, reason?: string) {
  await db
    .update(generatedQuestions)
    .set(verdictToGeneratedPatch(verdict, now, reason))
    .where(eq(generatedQuestions.id, rowId));
}

/**
 * Batch verification sweep (B-QUESTION-QUALITY-AGENTS-01 Phase 3). Demote-only,
 * batch-only — NEVER a write-time gate, NEVER overwrites an author's answer.
 *
 * Sweeps both question stores for rows not yet stamped (verified_at IS NULL):
 *   - Question        — eligible, not blocked, not deleted, not house-authored
 *                       (admin bulk-upload / crafter-keep — already trusted at
 *                       insert time, permanently left unswept here to avoid
 *                       sync-rate Sonnet spend on it); a demote sets
 *                       publicStatus = 'needs_review'.
 *   - GeneratedQuestion — not already suppressed, not expired; a demote sets
 *                       is_duplicate = true (the only suppress flag the bank honors).
 * Per row: pure pre-filter (Phase 2) decides skip vs verify; verify runs the
 * grounded verifier (knowledge-first, web fallback). Every outcome stamps
 * verified_at + verification_verdict so the row is never re-processed. A verifier
 * FAILURE (null) leaves the row unstamped so the next sweep retries it (fail-open).
 *
 * Two execution modes:
 *   - sync (default): verify each routed row inline, VERIFY_CONCURRENCY at a time.
 *   - async (BATCH_VERIFY_ASYNC_ENABLED): two-phase over the Message Batches API —
 *     harvest yesterday's batch (apply verdicts), then submit today's rows as a
 *     new batch. 50% token pricing, ~24h verdict latency (acceptable: this is a
 *     background quality net, not a serving-path gate). Verdicts are applied with
 *     the SAME patch helpers, so demote semantics are identical across modes.
 */
export async function GET(request: NextRequest) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const now = new Date();
  const options = prefilterOptions();

  if (isBatchVerifyAsyncEnabled()) {
    return runAsyncSweep(now, options);
  }
  return runSyncSweep(now, options);
}

// ─── Async mode (Batch API) ──────────────────────────────────────────────────

async function runAsyncSweep(now: Date, options: PrefilterOptions) {
  const client = getAnthropicClient();
  if (!client) {
    // Unlike the sync path (which degrades per-row), async mode can do nothing
    // useful without a client — report loudly and let the next pass retry.
    return NextResponse.json({ mode: 'async', error: 'anthropic client unavailable' }, { status: 503 });
  }

  // Phase 1 — harvest ended batches; apply verdicts with the shared patch helpers.
  const harvest = await harvestVerifyBatches(client, now);
  const harvested = { question: emptyTally(0), generated: emptyTally(0), stampFailures: 0 };
  for (const v of harvest.verdicts) {
    try {
      if (v.store === 'q') {
        await stampQuestion(v.rowId, v.outcome, now, v.reason);
        harvested.question[v.outcome] += 1;
      } else if (v.outcome === 'demoted' && isSalvageGeneratedOnDemoteEnabled()) {
        const row = await fetchGeneratedRow(v.rowId);
        if (row) {
          const bucket = await applyGeneratedDemote(row, v.reason ?? 'demoted (reason not captured)', now);
          harvested.generated[bucket] += 1;
        } else {
          // Row vanished between submit and harvest — nothing to stamp.
          harvested.stampFailures += 1;
        }
      } else {
        await stampGenerated(v.rowId, v.outcome, now, v.reason);
        harvested.generated[v.outcome] += 1;
      }
    } catch (error) {
      harvested.stampFailures += 1; // row stays unstamped → re-picked next submit
      console.warn('[cron/batch-verify-questions] async stamp failed', {
        store: v.store,
        rowId: v.rowId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Phase 2 — submit a new batch, but only when nothing is still in flight:
  // rows inside a processing batch are still unstamped, and re-selecting them
  // here would double-bill the same verification.
  let submitted: { providerBatchId: string; requestCount: number } | null = null;
  const submitTallies = { question: emptyTally(0), generated: emptyTally(0) };
  if (harvest.runsStillProcessing === 0) {
    const [pendingQuestions, pendingGenerated] = await selectPending(ASYNC_BATCH_SIZE);
    submitTallies.question.scanned = pendingQuestions.length;
    submitTallies.generated.scanned = pendingGenerated.length;

    const routed: BatchRowInput[] = [];
    const routeOrSkip = async (row: PendingRow, store: 'q' | 'g', tally: Tally) => {
      const decision = prefilterForVerification(
        {
          questionText: row.questionText,
          answer: row.answer,
          explanation: row.explanation,
          canonicalSubcategory: row.canonicalSubcategory,
        },
        options,
      );
      if (!decision.needsVerification) {
        // Skips never need the LLM — stamp immediately, exactly like sync mode.
        try {
          if (store === 'q') await stampQuestion(row.id, 'skipped', now);
          else await stampGenerated(row.id, 'skipped', now);
          tally.skipped += 1;
        } catch {
          tally.failed += 1;
        }
        return;
      }
      routed.push({
        store,
        rowId: row.id,
        questionText: row.questionText,
        answer: row.answer,
        explanation: row.explanation,
        canonicalSubcategory: row.canonicalSubcategory,
        broadCategory: row.broadCategory,
        dimensions: decision.dimensions,
      });
    };
    for (const row of pendingQuestions) await routeOrSkip(row, 'q', submitTallies.question);
    for (const row of pendingGenerated) await routeOrSkip(row, 'g', submitTallies.generated);

    if (routed.length > 0) {
      try {
        submitted = await submitVerifyBatch(client, routed);
      } catch (error) {
        console.error('[cron/batch-verify-questions] batch submit failed', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  // Fresh demotions landed at harvest time above; propose their fixes now so
  // the review queue is one-click by the time the human gets there.
  const salvage = await chaseDemotionsWithSalvage();

  return NextResponse.json({
    mode: 'async',
    harvest: {
      runsChecked: harvest.runsChecked,
      runsHarvested: harvest.runsHarvested,
      runsStillProcessing: harvest.runsStillProcessing,
      runsFailed: harvest.runsFailed,
      resultFailures: harvest.resultFailures,
      question: harvested.question,
      generated: harvested.generated,
      stampFailures: harvested.stampFailures,
    },
    submit: { ...submitTallies, batch: submitted },
    salvage,
  });
}

// ─── Sync mode (the original inline path) ────────────────────────────────────

async function runSyncSweep(now: Date, options: PrefilterOptions) {
  const [pendingQuestions, pendingGenerated] = await selectPending(BATCH_SIZE);

  const questionTally = emptyTally(pendingQuestions.length);
  const generatedTally = emptyTally(pendingGenerated.length);

  // Resolve a row to a verdict (+ the verifier's reason, persisted since 0100 so
  // the admin review queue can show WHY a row was demoted), then apply the
  // store-appropriate patch. 'failed' = left unstamped → retried next sweep.
  async function resolveVerdict(
    row: PendingRow,
  ): Promise<{ verdict: VerificationVerdict; reason?: string } | 'failed'> {
    const decision = prefilterForVerification({
      questionText: row.questionText,
      answer: row.answer,
      explanation: row.explanation,
      canonicalSubcategory: row.canonicalSubcategory,
    }, options);
    if (!decision.needsVerification) return { verdict: 'skipped' };

    const result = await verifyQuestion({
      questionText: row.questionText,
      answer: row.answer,
      explanation: row.explanation,
      canonicalSubcategory: row.canonicalSubcategory,
      broadCategory: row.broadCategory,
      dimensions: decision.dimensions,
    });
    if (!result) return 'failed'; // fail-open: no stamp
    return { verdict: result.outcome, reason: result.reason };
  }

  function tally(into: Tally, verdict: VerificationVerdict | 'failed') {
    if (verdict === 'failed') into.failed += 1;
    else into[verdict] += 1;
  }

  await runWithConcurrency(pendingQuestions, VERIFY_CONCURRENCY, async (row) => {
    try {
      const resolved = await resolveVerdict(row);
      if (resolved === 'failed') {
        questionTally.failed += 1;
        return;
      }
      await stampQuestion(row.id, resolved.verdict, now, resolved.reason);
      tally(questionTally, resolved.verdict);
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
      const resolved = await resolveVerdict(row);
      if (resolved === 'failed') {
        generatedTally.failed += 1;
        return;
      }
      // Salvage-aware: a demoted generated row gets one auto-repair attempt
      // (keep serving) before suppression. Other verdicts stamp as usual.
      if (resolved.verdict === 'demoted' && isSalvageGeneratedOnDemoteEnabled()) {
        const bucket = await applyGeneratedDemote(
          row,
          resolved.reason ?? 'demoted (reason not captured)',
          now,
        );
        generatedTally[bucket] += 1;
        return;
      }
      await stampGenerated(row.id, resolved.verdict, now, resolved.reason);
      tally(generatedTally, resolved.verdict);
    } catch (error) {
      generatedTally.failed += 1;
      console.warn('[cron/batch-verify-questions] GeneratedQuestion row failed', {
        generatedQuestionId: row.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // Chase this run's demotions with salvage proposals (see chaseDemotionsWithSalvage).
  const salvage = await chaseDemotionsWithSalvage();

  return NextResponse.json({ question: questionTally, generated: generatedTally, salvage });
}
