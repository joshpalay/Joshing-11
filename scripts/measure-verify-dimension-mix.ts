/**
 * Dimension-level attribution for batch-verify's web-search cost.
 *
 * WHY THIS EXISTS. Two existing harnesses each answer half the question and
 * neither answers this one:
 *   - measure-verify-web-search-rate.ts reads the LlmUsageEvent ledger and gives
 *     the per-call search rate, but the ledger records no dimensions, so it
 *     cannot say WHICH dimension mix is doing the searching.
 *   - measure-prefilter-skip-rate.ts replays the pure pre-filter, but it never
 *     selects canonical_subcategory, so `ambiguous_source` is INERT there (see
 *     verification-prefilter.ts: "When omitted the ambiguous_source route is
 *     inert") and it only tallies false_premise / extra_fact — never the
 *     combinations.
 *
 * This script closes that gap: it selects canonical_subcategory so all three
 * dimensions route for real, then reports the dimension-COMBINATION mix. The
 * combination is the point — a row routed on `ambiguous_source` ALONE has
 * nothing to fact-check (the verify system prompt says that dimension "needs NO
 * web search" and to "never search for it"), so attaching the web_search tool to
 * that call can only cost money. buildVerifyRequestParams now omits the tool for
 * those calls; this measures how many calls that actually reaches.
 *
 * Read-only. Zero LLM spend. Nothing is written.
 *
 *   npx tsx scripts/measure-verify-dimension-mix.ts        # 300 rows/store
 *   npx tsx scripts/measure-verify-dimension-mix.ts 600    # custom sample size
 *
 * Context for reading the output (measured 2026-08-03, trailing 7d):
 *   - a searching batch-verify call costs ~24x a knowledge-only one
 *     ($0.0615 vs $0.0026) — search results are re-processed across tool turns,
 *     adding ~21.6k cache tokens per call
 *   - ~27-31% of calls search at all
 *   - the 2026-07-17 knowledge-first prompt tightening moved that rate only
 *     36.2% -> 31.5%, so prompt-side is a weak lever; structural routing (not
 *     asking the model to restrain itself) is where the remaining win is
 */
import 'dotenv/config';

import { desc } from 'drizzle-orm';

import { db, generatedQuestions, pool, questions } from '../src/server/db';
import {
  prefilterForVerification,
  type PrefilterInput,
  type VerificationDimension,
} from '../src/server/quality/verification-prefilter';

type SampleRow = PrefilterInput & { store: 'Question' | 'GeneratedQuestion'; id: string };

// Measured 2026-08-03 over the trailing 7d of scope='batch-verify' ledger rows,
// split on whether the call invoked web_search. Used only to turn the routed-row
// counts below into a rough dollar reach — not a billing figure.
const USD_SEARCHING_CALL = 0.0615;
const USD_KNOWLEDGE_ONLY_CALL = 0.0026;
// Share of tool-bearing calls that actually invoke search (trailing 7d: 88/323).
const OBSERVED_SEARCH_RATE = 0.27;

/** Stable label for a dimension set, e.g. "ambiguous_source only". */
function comboLabel(dimensions: VerificationDimension[]): string {
  const sorted = [...dimensions].sort();
  return sorted.length === 1 ? `${sorted[0]} only` : sorted.join(' + ');
}

function pct(part: number, whole: number): string {
  return whole === 0 ? '—' : `${((part / whole) * 100).toFixed(1)}%`;
}

async function main() {
  const perStore = Math.max(1, Number(process.argv[2] ?? 300));

  // canonical_subcategory is the column measure-prefilter-skip-rate.ts omits;
  // without it isAmbiguousSourceCandidate() returns false for every row and the
  // whole dimension silently disappears from the mix.
  const [questionRows, generatedRows] = await Promise.all([
    db
      .select({
        id: questions.id,
        questionText: questions.questionText,
        answer: questions.answerText,
        explanation: questions.factualExplanation,
        canonicalSubcategory: questions.canonicalSubcategory,
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
        canonicalSubcategory: generatedQuestions.canonicalSubcategory,
      })
      .from(generatedQuestions)
      .orderBy(desc(generatedQuestions.createdAt))
      .limit(perStore),
  ]);

  const sample: SampleRow[] = [
    ...questionRows.map((r) => ({ ...r, store: 'Question' as const })),
    ...generatedRows.map((r) => ({ ...r, store: 'GeneratedQuestion' as const })),
  ];

  let skipped = 0;
  let routed = 0;
  let ambiguousOnly = 0;
  const byCombo = new Map<string, number>();
  const ambiguousOnlyExamples: SampleRow[] = [];

  for (const row of sample) {
    const decision = prefilterForVerification(row, {});
    if (!decision.needsVerification) {
      skipped += 1;
      continue;
    }
    routed += 1;
    const label = comboLabel(decision.dimensions);
    byCombo.set(label, (byCombo.get(label) ?? 0) + 1);
    if (decision.dimensions.length === 1 && decision.dimensions[0] === 'ambiguous_source') {
      ambiguousOnly += 1;
      if (ambiguousOnlyExamples.length < 10) ambiguousOnlyExamples.push(row);
    }
  }

  const n = sample.length;
  console.log(
    `\nSample: ${n} rows (${questionRows.length} Question + ${generatedRows.length} GeneratedQuestion, most recent)`,
  );
  console.log(`Routed to verification: ${routed} (${pct(routed, n)})   Skipped: ${skipped} (${pct(skipped, n)})\n`);

  console.log('dimension combination                     rows    % of routed');
  for (const [label, count] of [...byCombo.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`${label.padEnd(40)}  ${String(count).padStart(4)}    ${pct(count, routed).padStart(6)}`);
  }

  // The headline: how far the no-tool-on-ambiguous_source-only change reaches.
  console.log(`\n=== reach of the ambiguous_source-only tool suppression ===`);
  console.log(`ambiguous_source-only calls: ${ambiguousOnly} of ${routed} routed (${pct(ambiguousOnly, routed)})`);

  if (ambiguousOnly === 0) {
    console.log(
      '\nZero rows route on ambiguous_source alone in this sample. The change is still\n' +
        'correct (it can only ever remove a tool the prompt forbids using), but it is\n' +
        'NOT a cost lever at this sample size — do not bank savings on it. The search\n' +
        'spend lives in the factual dimensions; look there instead.',
    );
  } else {
    // Rough: only the searching share of those calls was actually costing the
    // premium, so credit the delta on that share alone.
    const wouldHaveSearched = ambiguousOnly * OBSERVED_SEARCH_RATE;
    const saved = wouldHaveSearched * (USD_SEARCHING_CALL - USD_KNOWLEDGE_ONLY_CALL);
    console.log(
      `~${wouldHaveSearched.toFixed(1)} of them would have searched at the observed ${(OBSERVED_SEARCH_RATE * 100).toFixed(0)}% rate,\n` +
        `so the change is worth roughly $${saved.toFixed(3)} per ${routed} routed calls.`,
    );
    console.log('\nExamples (ambiguous_source only — these no longer carry the search tool):');
    for (const row of ambiguousOnlyExamples) {
      console.log(`  [${row.store}] ${row.questionText.slice(0, 100)}`);
      console.log(`      subject: ${row.canonicalSubcategory ?? '(none)'}`);
    }
  }

  console.log(
    '\nNote: this sizes ONE structural change. The dominant search cost sits in the\n' +
      'factual dimensions, which genuinely need the tool — reducing that is a quality\n' +
      'tradeoff, not a free win, and wants its own measured experiment.',
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => void pool.end());
