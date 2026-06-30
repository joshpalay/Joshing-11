/**
 * Read-only evidence run for the "false premises live in asserted setup
 * side-facts, not in length" hypothesis.
 *
 * For a sample of recent bank questions it:
 *   1. computes two cheap structural metrics on the question_text (the SETUP):
 *        - words           — length proxy
 *        - assertionScore  — # of independently-checkable side-claims: digits,
 *                            number-words, years, and superlative/exclusivity
 *                            words ("largest", "only", "first", "founded", …).
 *   2. runs the FIXED Sonnet factual gate (batched at 6 — exercises the raised
 *      max_tokens) to label each question flagged / not-flagged.
 *   3. compares flagged vs not on both metrics, and reports flag rate by
 *      assertion-density tertile.
 *   4. anchors with the known confirmed false-premise offenders (labeled
 *      positives) and reports where they sit in the sample's density distribution.
 *
 * No writes. Run from repo root:
 *   npx tsx --env-file=.env --env-file=.env.local scripts/audit-assertion-density.ts
 *   SAMPLE=120 npx tsx --env-file=.env --env-file=.env.local scripts/audit-assertion-density.ts
 */
import { desc, eq, inArray } from 'drizzle-orm';

import { db, generatedQuestions } from '../src/server/db';
import { findFactualFailures, type LlmQuestion } from '../src/server/daily/generate-questions';

const SAMPLE = Number(process.env.SAMPLE || 120);
const BATCH = 6;

// Confirmed false-premise offenders (labeled positives) from
// D-LLM-PROVIDER-AB-AND-GATE-TIER-01.md + today's HP find. Duplicates excluded.
const KNOWN_OFFENDER_IDS = [
  '17b0f389-a497-4039-9306-a3539f149d15', // HP "fifty points / largest single award"
  '3ae575a3-ff02-48dd-bed2-8c86c4566ba5', // tennis volley-before-net premise
  '651b6f44-f03d-47a6-87d4-24177851b854', // Lewis Hine "founded the NCLC"
  '23c571e7-e0bf-4274-ab50-25ab20d8623a', // Mozart "Jupiter" Symphony No. 38
  '4c257d42-6675-4037-9f50-1ff987bb5633', // Beethoven sonata "unusual four-movement structure"
];

const NUMBER_WORDS =
  /\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|twenty|thirty|forty|fifty|sixty|hundred|thousand|million|billion|dozen|single|pair|triple|once|twice)\b/gi;
const SUPERLATIVES =
  /\b(only|sole|solely|first|last|final|largest|biggest|smallest|longest|shortest|highest|lowest|greatest|most|least|best|worst|earliest|latest|unique|original|founded|invented|debut|debuted|premiered?|inaugural|unprecedented|never|always|every|all|none|exactly|precisely)\b/gi;
const DIGITS = /\d+/g;
const YEARS = /\b(1[0-9]{3}|20[0-9]{2})\b/g;

function metrics(text: string): { words: number; assertionScore: number } {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  const count = (re: RegExp) => (text.match(re) ?? []).length;
  // Years counted once under YEARS, not double-counted via DIGITS.
  const yearHits = count(YEARS);
  const digitHits = Math.max(0, count(DIGITS) - yearHits);
  const assertionScore = digitHits + yearHits + count(NUMBER_WORDS) + count(SUPERLATIVES);
  return { words, assertionScore };
}

function toLlmQuestion(row: { questionText: string; answer: string; canonicalSubcategory: string }): LlmQuestion {
  return {
    canonical_subcategory: row.canonicalSubcategory,
    broad_category: 'General',
    question_text: row.questionText,
    answer: row.answer,
    explainer: '',
    difficulty_estimate: 'moderate',
    fact_key: null,
    subject_entity: null,
    sub_angles: [],
    question_shape: null,
  };
}

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

function percentileOf(sorted: number[], value: number): number {
  const below = sorted.filter((x) => x < value).length;
  return Math.round((below / sorted.length) * 100);
}

async function main() {
  const rows = await db
    .select({
      id: generatedQuestions.id,
      questionText: generatedQuestions.questionText,
      answer: generatedQuestions.answer,
      canonicalSubcategory: generatedQuestions.canonicalSubcategory,
    })
    .from(generatedQuestions)
    .where(eq(generatedQuestions.isDuplicate, false))
    .orderBy(desc(generatedQuestions.createdAt))
    .limit(SAMPLE);

  console.log(`Sampled ${rows.length} recent non-suppressed bank questions.\n`);

  // Label via the fixed gate, batched.
  const flagged = new Set<string>();
  for (let i = 0; i < rows.length; i += BATCH) {
    const slice = rows.slice(i, i + BATCH);
    const { toDrop } = await findFactualFailures(slice.map(toLlmQuestion));
    for (const idx of toDrop) flagged.add(slice[idx]!.id);
    process.stdout.write(`  gated ${Math.min(i + BATCH, rows.length)}/${rows.length} — flagged so far: ${flagged.size}\n`);
  }

  const withMetrics = rows.map((r) => ({ ...r, ...metrics(r.questionText), flagged: flagged.has(r.id) }));
  const pos = withMetrics.filter((r) => r.flagged);
  const neg = withMetrics.filter((r) => !r.flagged);

  console.log('\n──────── SAMPLE: flagged vs not ────────');
  console.log(`flagged   n=${pos.length}  mean words=${mean(pos.map((r) => r.words)).toFixed(1)}  mean assertionScore=${mean(pos.map((r) => r.assertionScore)).toFixed(2)}`);
  console.log(`not       n=${neg.length}  mean words=${mean(neg.map((r) => r.words)).toFixed(1)}  mean assertionScore=${mean(neg.map((r) => r.assertionScore)).toFixed(2)}`);

  // Flag rate by assertion-density tertile.
  const sortedByScore = [...withMetrics].sort((a, b) => a.assertionScore - b.assertionScore);
  const third = Math.floor(sortedByScore.length / 3);
  const low = sortedByScore.slice(0, third);
  const high = sortedByScore.slice(sortedByScore.length - third);
  const rate = (g: typeof withMetrics) => (g.length ? (100 * g.filter((r) => r.flagged).length) / g.length : 0);
  console.log('\n──────── flag rate by assertion-density tertile ────────');
  console.log(`low  density (score ≤ ${low[low.length - 1]?.assertionScore}):  ${rate(low).toFixed(1)}%  (${low.filter((r) => r.flagged).length}/${low.length})`);
  console.log(`high density (score ≥ ${high[0]?.assertionScore}):  ${rate(high).toFixed(1)}%  (${high.filter((r) => r.flagged).length}/${high.length})`);

  // Anchor: known confirmed offenders vs the sample distribution.
  const offenders = await db
    .select({
      id: generatedQuestions.id,
      questionText: generatedQuestions.questionText,
      answer: generatedQuestions.answer,
      canonicalSubcategory: generatedQuestions.canonicalSubcategory,
    })
    .from(generatedQuestions)
    .where(inArray(generatedQuestions.id, KNOWN_OFFENDER_IDS));

  const sampleScores = withMetrics.map((r) => r.assertionScore).sort((a, b) => a - b);
  const sampleWords = withMetrics.map((r) => r.words).sort((a, b) => a - b);
  console.log('\n──────── KNOWN CONFIRMED OFFENDERS vs sample distribution ────────');
  for (const o of offenders) {
    const m = metrics(o.questionText);
    console.log(
      `score=${m.assertionScore} (p${percentileOf(sampleScores, m.assertionScore)})  words=${m.words} (p${percentileOf(sampleWords, m.words)})  | ${o.questionText.slice(0, 70)}…`,
    );
  }
  console.log(
    `\nsample assertionScore: median=${sampleScores[Math.floor(sampleScores.length / 2)]}  offenders mean=${mean(offenders.map((o) => metrics(o.questionText).assertionScore)).toFixed(2)}`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
