/**
 * Salvage pass over the demoted-question review queue (D-QUALITY-SALVAGE-01).
 *
 * A sample of the queue showed ~80% of demotions are not wrong answers — they
 * are one removable/wrong fact (usually a decorative aside in the explainer)
 * while the ask + headline answer are correct. For each demoted Question this
 * proposes the MINIMAL fix (proposeSalvage), re-verifies the PROPOSED version
 * (verifyQuestion directly — so we check our exact edit against the existing
 * answer), and stores a proposal. Nothing is applied: a human approves each
 * ready diff in the review queue (conservative). Broken cores → 'unsalvageable'.
 *
 * Read-only by default (proposes + prints a triage census). Run from repo root:
 *   node --import tsx --env-file=.env --env-file=.env.local scripts/salvage-demoted.ts          # dry-run: propose + census, persist nothing
 *   node --import tsx --env-file=.env --env-file=.env.local scripts/salvage-demoted.ts --write   # persist proposals to QuestionSalvageProposal
 *
 * --write only ever touches the QuestionSalvageProposal table; Question/
 * GeneratedQuestion rows are never modified by this script.
 */
import 'dotenv/config';

import { pool } from '../src/server/db';
import { getMachineDemotionsForReview } from '../src/server/db/queries/machine-demotions';
import {
  questionIdsWithProposal,
  upsertSalvageProposal,
} from '../src/server/db/queries/salvage-proposals';
import { proposeSalvage } from '../src/server/quality/salvage-question';
import { verifyQuestion } from '../src/server/quality/verify-question';

const WRITE = process.argv.includes('--write');
const CONCURRENCY = 5;
// --limit N: process only the first N of the queue (validation runs).
const LIMIT_ARG = process.argv.find((a) => a.startsWith('--limit='));
const LIMIT = LIMIT_ARG ? Math.max(1, Number(LIMIT_ARG.split('=')[1]) || 0) : Infinity;

type Outcome = 'ready' | 'reverify_failed' | 'unsalvageable' | 'skipped_existing';

async function processOne(item: {
  questionId: string;
  questionText: string;
  correctAnswer: string;
  explanation: string | null;
  verificationReason: string | null;
  canonicalSubcategory: string | null;
  broadCategory: string | null;
}): Promise<{ outcome: Outcome; note: string }> {
  const proposal = await proposeSalvage({
    questionText: item.questionText,
    answer: item.correctAnswer,
    explanation: item.explanation,
    verificationReason: item.verificationReason ?? 'demoted (reason not captured)',
    canonicalSubcategory: item.canonicalSubcategory,
    broadCategory: item.broadCategory,
  });

  if (proposal.kind === 'unsalvageable') {
    if (WRITE) {
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
  if (WRITE) {
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

async function main() {
  const fullQueue = await getMachineDemotionsForReview();
  const queue = Number.isFinite(LIMIT) ? fullQueue.slice(0, LIMIT) : fullQueue;
  const already = await questionIdsWithProposal(queue.map((q) => q.questionId));
  const todo = queue.filter((q) => !already.has(q.questionId));

  console.log(
    `[salvage] queue=${queue.length} already_proposed=${already.size} to_process=${todo.length} mode=${WRITE ? 'WRITE' : 'DRY-RUN'}`,
  );

  const tally: Record<Outcome, number> = {
    ready: 0,
    reverify_failed: 0,
    unsalvageable: 0,
    skipped_existing: already.size,
  };

  for (let i = 0; i < todo.length; i += CONCURRENCY) {
    const chunk = todo.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      chunk.map(async (item) => {
        try {
          return await processOne(item);
        } catch (error) {
          return {
            outcome: 'reverify_failed' as Outcome,
            note: `error: ${error instanceof Error ? error.message : String(error)}`,
          };
        }
      }),
    );
    results.forEach((r, j) => {
      tally[r.outcome]++;
      const stem = chunk[j].questionText.slice(0, 60).replace(/\s+/g, ' ');
      console.log(`  [${r.outcome}] ${stem}… — ${r.note}`);
    });
  }

  console.log('\n[salvage] census:', JSON.stringify(tally));
  const salvageable = tally.ready;
  const pct = todo.length ? Math.round((salvageable / todo.length) * 100) : 0;
  console.log(
    `[salvage] ${salvageable}/${todo.length} processed became one-click-ready (${pct}%). ${WRITE ? 'Persisted.' : 'Dry-run — re-run with --write to persist.'}`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
