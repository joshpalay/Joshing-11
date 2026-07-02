/**
 * Before/after skip-rate measurement for the 2026-07 extra_fact tightening
 * (batch-verify-cost-characterization.md §2/§5 — "the single biggest cost dial").
 *
 * Read-only, zero LLM spend: pulls the most recent N rows per store (default 300,
 * matching the characterization's sample) and runs the PURE pre-filter twice —
 * legacy answer heuristic vs tightened — printing skip rates, dimension mixes,
 * and examples of rows whose decision changed. Nothing is written.
 *
 *   npx tsx scripts/measure-prefilter-skip-rate.ts        # 300 rows/store
 *   npx tsx scripts/measure-prefilter-skip-rate.ts 600    # custom sample size
 *
 * Baseline to beat (measured 2026-07-01, legacy heuristic): skip 9%, route 91%,
 * extra_fact on ~90% of the sample. Re-record the new numbers in
 * docs/findings/batch-verify-cost-characterization.md after running.
 */
import 'dotenv/config';

import { desc } from 'drizzle-orm';

import { db, generatedQuestions, pool, questions } from '../src/server/db';
import {
  prefilterForVerification,
  type PrefilterInput,
} from '../src/server/quality/verification-prefilter';

type SampleRow = PrefilterInput & { store: 'Question' | 'GeneratedQuestion'; id: string };

type VariantTally = {
  skipped: number;
  routed: number;
  falsePremise: number;
  extraFact: number;
};

function tallyVariant(rows: SampleRow[], legacyExtraFact: boolean): VariantTally {
  const t: VariantTally = { skipped: 0, routed: 0, falsePremise: 0, extraFact: 0 };
  for (const row of rows) {
    const d = prefilterForVerification(row, { legacyExtraFact });
    if (!d.needsVerification) {
      t.skipped += 1;
      continue;
    }
    t.routed += 1;
    if (d.dimensions.includes('false_premise')) t.falsePremise += 1;
    if (d.dimensions.includes('extra_fact')) t.extraFact += 1;
  }
  return t;
}

function pct(part: number, whole: number): string {
  return whole === 0 ? '—' : `${((part / whole) * 100).toFixed(1)}%`;
}

async function main() {
  const perStore = Math.max(1, Number(process.argv[2] ?? 300));

  const [questionRows, generatedRows] = await Promise.all([
    db
      .select({
        id: questions.id,
        questionText: questions.questionText,
        answer: questions.answerText,
        explanation: questions.factualExplanation,
      })
      .from(questions)
      .orderBy(desc(questions.createdAt))
      .limit(perStore),
    db
      .select({
        id: generatedQuestions.id,
        questionText: generatedQuestions.questionText,
        answer: generatedQuestions.answer,
        explanation: generatedQuestions.explainer,
      })
      .from(generatedQuestions)
      .orderBy(desc(generatedQuestions.createdAt))
      .limit(perStore),
  ]);

  const sample: SampleRow[] = [
    ...questionRows.map((r) => ({ ...r, store: 'Question' as const })),
    ...generatedRows.map((r) => ({ ...r, store: 'GeneratedQuestion' as const })),
  ];

  const legacy = tallyVariant(sample, true);
  const strict = tallyVariant(sample, false);
  const n = sample.length;

  console.log(`\nSample: ${n} rows (${questionRows.length} Question + ${generatedRows.length} GeneratedQuestion, most recent)\n`);
  console.log('variant   skip           route          false_premise  extra_fact');
  for (const [name, t] of [
    ['legacy ', legacy],
    ['strict ', strict],
  ] as const) {
    console.log(
      `${name}   ${String(t.skipped).padStart(4)} (${pct(t.skipped, n).padStart(6)})  ` +
        `${String(t.routed).padStart(4)} (${pct(t.routed, n).padStart(6)})  ` +
        `${String(t.falsePremise).padStart(4)} (${pct(t.falsePremise, n).padStart(6)})  ` +
        `${String(t.extraFact).padStart(4)} (${pct(t.extraFact, n).padStart(6)})`,
    );
  }

  // Rows whose overall decision flipped route→skip: the spend actually saved.
  const flipped = sample.filter((row) => {
    const wasRouted = prefilterForVerification(row, { legacyExtraFact: true }).needsVerification;
    const nowRouted = prefilterForVerification(row).needsVerification;
    return wasRouted && !nowRouted;
  });
  console.log(
    `\nroute→skip under tightening: ${flipped.length} rows (${pct(flipped.length, n)}) — ` +
      `each was a paid verify call/day of demand; eyeball a few below for anything that LOOKS claim-bearing:`,
  );
  for (const row of flipped.slice(0, 10)) {
    console.log(`  [${row.store}] Q: ${row.questionText.slice(0, 90)}`);
    console.log(`      A: ${row.answer.slice(0, 90)}`);
  }
  if (flipped.length > 10) console.log(`  … and ${flipped.length - 10} more`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => void pool.end());
