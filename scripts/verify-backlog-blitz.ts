/**
 * One-time verification backlog blitz over the Message Batches API
 * (scale-readiness follow-up, 2026-07-05: ~1,469 rows sat verifiedAt IS NULL
 * against a 50/day sync cap — a wall-clock problem, not a cost problem).
 *
 * Reuses the EXACT production primitives — prefilterForVerification (tightened),
 * submitVerifyBatch / harvestVerifyBatches, and the same verdict patch helpers —
 * so semantics are identical to the cron's async mode; this script only removes
 * the daily size cap. Runs it submits are recorded in VerifyBatchRun, so the
 * daily cron sees them in flight, won't double-submit, and can itself harvest
 * them (its submit phase is gated on runsStillProcessing === 0).
 *
 * Read-only by default. Run from repo root:
 *   node --import tsx --env-file=.env --env-file=.env.local scripts/verify-backlog-blitz.ts            # dry-run census + cost estimate
 *   node --import tsx --env-file=.env --env-file=.env.local scripts/verify-backlog-blitz.ts --submit   # stamp skips + submit routed rows in chunks
 *   node --import tsx --env-file=.env --env-file=.env.local scripts/verify-backlog-blitz.ts --harvest  # harvest ended batches + stamp verdicts
 *
 * Fail-open contract preserved: an errored/expired/unparseable result stamps
 * nothing and the row is re-picked by a later submission.
 */
import 'dotenv/config';

import { and, eq, gt, isNull, ne } from 'drizzle-orm';

import { getAnthropicClient } from '../src/lib/llm';
import { db, generatedQuestions, pool, questions } from '../src/server/db';
import {
  prefilterForVerification,
} from '../src/server/quality/verification-prefilter';
import {
  harvestVerifyBatches,
  submitVerifyBatch,
  type BatchRowInput,
} from '../src/server/quality/verify-batch';
import {
  verdictToGeneratedPatch,
  verdictToQuestionPatch,
} from '../src/server/quality/verify-question';

const SUBMIT = process.argv.includes('--submit');
const HARVEST = process.argv.includes('--harvest');
// Moderate chunks: a failed create loses one chunk, not the whole blitz.
const CHUNK = 500;

type PendingRow = {
  id: string;
  questionText: string;
  answer: string;
  explanation: string | null;
  canonicalSubcategory: string | null;
  broadCategory: string | null;
};

async function selectAllPending(now: Date): Promise<{ q: PendingRow[]; g: PendingRow[] }> {
  const [q, g] = await Promise.all([
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
      .where(and(isNull(questions.verifiedAt), ne(questions.visibility, 'blocked'), isNull(questions.deletedAt))),
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
      )),
  ]);
  return { q: q as PendingRow[], g: g as PendingRow[] };
}

async function main() {
  const now = new Date();
  const { q, g } = await selectAllPending(now);

  // Prefilter census (tightened heuristics — this script runs the working tree).
  const routed: BatchRowInput[] = [];
  const skips: Array<{ store: 'q' | 'g'; id: string }> = [];
  for (const [store, rows] of [['q', q], ['g', g]] as const) {
    for (const row of rows) {
      const d = prefilterForVerification(
        { questionText: row.questionText, answer: row.answer, explanation: row.explanation },
      );
      if (!d.needsVerification) skips.push({ store, id: row.id });
      else routed.push({ store, rowId: row.id, questionText: row.questionText, answer: row.answer, explanation: row.explanation, canonicalSubcategory: row.canonicalSubcategory, broadCategory: row.broadCategory, dimensions: d.dimensions });
    }
  }

  console.log(`pending: Question=${q.length} GeneratedQuestion=${g.length} total=${q.length + g.length}`);
  console.log(`prefilter: skip=${skips.length} route=${routed.length}`);
  // ~4k input tok/row measured; batch = 50% off; Sonnet 5 intro $2/$10 → ~$1/$5 batched.
  console.log(`rough batched cost estimate: $${((routed.length * 4000 * 1 + routed.length * 300 * 5) / 1e6).toFixed(2)} + web searches`);

  if (HARVEST) {
    const client = getAnthropicClient();
    if (!client) throw new Error('no anthropic client');
    const summary = await harvestVerifyBatches(client, now);
    let stamped = 0;
    let stampFailures = 0;
    for (const v of summary.verdicts) {
      try {
        if (v.store === 'q') {
          await db.update(questions).set(verdictToQuestionPatch(v.outcome, now, v.reason)).where(eq(questions.id, v.rowId));
        } else {
          await db.update(generatedQuestions).set(verdictToGeneratedPatch(v.outcome, now, v.reason)).where(eq(generatedQuestions.id, v.rowId));
        }
        stamped += 1;
      } catch (error) {
        stampFailures += 1;
        console.warn('stamp failed', v.store, v.rowId, error instanceof Error ? error.message : error);
      }
    }
    const byOutcome = summary.verdicts.reduce<Record<string, number>>((acc, v) => {
      acc[v.outcome] = (acc[v.outcome] ?? 0) + 1;
      return acc;
    }, {});
    console.log('harvest:', {
      runsChecked: summary.runsChecked,
      runsHarvested: summary.runsHarvested,
      runsStillProcessing: summary.runsStillProcessing,
      runsFailed: summary.runsFailed,
      resultFailures: summary.resultFailures,
      stamped,
      stampFailures,
      byOutcome,
    });
    return;
  }

  if (!SUBMIT) {
    console.log('\nDRY RUN — pass --submit to stamp skips and submit batches, --harvest to collect verdicts.');
    return;
  }

  // Stamp the free skips first (identical to the cron's skip handling).
  let skipped = 0;
  for (const s of skips) {
    try {
      if (s.store === 'q') {
        await db.update(questions).set(verdictToQuestionPatch('skipped', now)).where(eq(questions.id, s.id));
      } else {
        await db.update(generatedQuestions).set(verdictToGeneratedPatch('skipped', now)).where(eq(generatedQuestions.id, s.id));
      }
      skipped += 1;
    } catch (error) {
      console.warn('skip stamp failed', s.store, s.id, error instanceof Error ? error.message : error);
    }
  }
  console.log(`stamped ${skipped}/${skips.length} skips (zero LLM cost)`);

  const client = getAnthropicClient();
  if (!client) throw new Error('no anthropic client');
  for (let i = 0; i < routed.length; i += CHUNK) {
    const chunk = routed.slice(i, i + CHUNK);
    const { providerBatchId, requestCount } = await submitVerifyBatch(client, chunk);
    console.log(`submitted chunk ${1 + i / CHUNK}: ${requestCount} requests → ${providerBatchId}`);
  }
  console.log('\nAll batches submitted. Re-run with --harvest once ended (typically <1h), or let the daily cron harvest.');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => void pool.end());
