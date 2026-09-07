import 'dotenv/config';

import { eq, inArray, or, ilike, and, not } from 'drizzle-orm';

import { db, pool, generatedQuestions } from '../src/server/db';
import { runWithConcurrency } from '../src/server/lib/concurrency';
import {
  findQualityFailures,
  findBankSourceDefect,
  type LlmQuestion,
} from '../src/server/daily/generate-questions';
import { proposeBankRewrite } from '../src/server/quality/salvage-bank-rewrite';

// Rewrite-and-reverify pass over the WORDING-defect rows the 2026-09-07 bank
// sweep demoted (diagnosis/answer-leak-domain-drift-plan.md). Fix 2 (the
// sweep) only ever suppressed; this is the recovery half — same underlying
// fact, defect removed, re-verified before anything is restored to serving.
//
// Scoped to defect classes where the fix is a WORDING change, not a content
// or filing one: ANSWER_LEAKED, SELF_ANSWERING, DEFINITION_SUPPLIED,
// MULTI_PART, MISLEADING_SETUP, and yesterday's un-prefixed leak/shape
// demotions. Deliberately EXCLUDES FALSE_PREMISE (the content is actually
// wrong), OPINION_OR_VAGUE (no single answer to preserve), GENERIC_AT_TIER
// (a difficulty-tier problem, not a wording one), and OFF_DOMAIN (a filing
// problem — see scripts/demote-2026-09-07-off-domain-review.ts instead).
//
// Two phases, not interleaved, so batching and concurrency don't fight:
//   A) PROPOSE — Sonnet, concurrent (proposeBankRewrite). Every row gets a
//      rewritten candidate or an unsalvageable verdict.
//   B) REVERIFY — deterministic (findBankSourceDefect, free) then the SAME
//      Haiku quality gate the sweep used, batched. A candidate is applied
//      ONLY if it clears BOTH — the identical bar new generation clears, not
//      a lower one for "recovered" content.
//
//   npx tsx scripts/rewrite-bank-demotions.ts                    # DRY RUN
//   npx tsx scripts/rewrite-bank-demotions.ts --apply             # writes
//   REWRITE_LIMIT=20 npx tsx scripts/rewrite-bank-demotions.ts    # pilot batch

const APPLY = process.argv.includes('--apply');
const PROPOSE_CONCURRENCY = Math.max(1, Number(process.env.REWRITE_CONCURRENCY ?? 3));
const REVERIFY_BATCH_SIZE = Math.max(1, Number(process.env.REWRITE_BATCH_SIZE ?? 10));
const LIMIT = Number(process.env.REWRITE_LIMIT ?? 0); // 0 = no cap

type Row = {
  id: string;
  questionText: string;
  answer: string;
  explainer: string;
  canonicalSubcategory: string;
  broadCategory: string;
  difficultyEstimate: string;
  factKey: string | null;
  verificationReason: string;
};

function toLlmQuestion(row: Row, text: string, ans: string): LlmQuestion {
  const tier = (['accessible', 'moderate', 'specialist'] as const).includes(
    row.difficultyEstimate as never,
  )
    ? (row.difficultyEstimate as LlmQuestion['difficulty_estimate'])
    : 'moderate';
  return {
    canonical_subcategory: row.canonicalSubcategory,
    broad_category: row.broadCategory,
    question_text: text,
    answer: ans,
    explainer: row.explainer,
    difficulty_estimate: tier,
    fact_key: row.factKey,
    subject_entity: null,
    sub_angles: [],
    question_shape: null,
  };
}

async function main() {
  const eligible = (await db
    .select({
      id: generatedQuestions.id,
      questionText: generatedQuestions.questionText,
      answer: generatedQuestions.answer,
      explainer: generatedQuestions.explainer,
      canonicalSubcategory: generatedQuestions.canonicalSubcategory,
      broadCategory: generatedQuestions.broadCategory,
      difficultyEstimate: generatedQuestions.difficultyEstimate,
      factKey: generatedQuestions.factKey,
      verificationReason: generatedQuestions.verificationReason,
    })
    .from(generatedQuestions)
    .where(
      and(
        eq(generatedQuestions.isDuplicate, true),
        ilike(generatedQuestions.verificationReason, 'bank sweep:%'),
        not(
          or(
            ilike(generatedQuestions.verificationReason, '%FALSE_PREMISE%'),
            ilike(generatedQuestions.verificationReason, '%OPINION_OR_VAGUE%'),
            ilike(generatedQuestions.verificationReason, '%GENERIC_AT_TIER%'),
            ilike(generatedQuestions.verificationReason, '%OFF_DOMAIN%'),
          )!,
        ),
      ),
    )) as Row[];

  const population = LIMIT > 0 ? eligible.slice(0, LIMIT) : eligible;
  console.log(
    `[rewrite] ${population.length} wording-defect rows eligible${LIMIT > 0 ? ` (capped from ${eligible.length})` : ''}`,
  );

  // --- Phase A: propose, concurrent ---------------------------------------
  type Proposed = {
    row: Row;
    proposedText: string;
    proposedAnswer: string;
    proposedExplainer: string;
    note: string;
  };
  const proposals: Proposed[] = [];
  let unsalvageable = 0;
  let done = 0;
  await runWithConcurrency(population, PROPOSE_CONCURRENCY, async (row) => {
    const defectReason = row.verificationReason.replace(/^bank sweep:\s*/i, '');
    const proposal = await proposeBankRewrite({
      questionText: row.questionText,
      answer: row.answer,
      explainer: row.explainer,
      defectReason,
      canonicalSubcategory: row.canonicalSubcategory,
      broadCategory: row.broadCategory,
    });
    done += 1;
    if (done % 50 === 0) console.log(`[rewrite] ...proposed ${done}/${population.length}`);
    if (proposal.kind === 'unsalvageable' || (!proposal.proposedQuestionText && !proposal.proposedAnswer)) {
      unsalvageable += 1;
      console.log(`[rewrite] [unsalvageable] ${row.id} (${row.canonicalSubcategory}) — ${proposal.note.slice(0, 140)}`);
      return;
    }
    proposals.push({
      row,
      proposedText: proposal.proposedQuestionText ?? row.questionText,
      proposedAnswer: proposal.proposedAnswer ?? row.answer,
      proposedExplainer: proposal.proposedExplainer ?? row.explainer,
      note: proposal.note,
    });
  });
  console.log(`[rewrite] Phase A done: ${proposals.length} proposed, ${unsalvageable} unsalvageable`);

  // --- Phase B: reverify ---------------------------------------------------
  // Deterministic pass first — free, instant, catches a rewrite that traded
  // one leak for another.
  const detPassed: Proposed[] = [];
  let detRejected = 0;
  for (const p of proposals) {
    const defect = findBankSourceDefect({ questionText: p.proposedText, answer: p.proposedAnswer });
    if (defect) {
      detRejected += 1;
      console.log(`[rewrite] [rejected:deterministic] ${p.row.id} — ${defect.slice(0, 140)}`);
      continue;
    }
    detPassed.push(p);
  }
  console.log(`[rewrite] deterministic reverify: ${detPassed.length} passed, ${detRejected} rejected`);

  // Same Haiku quality gate the sweep used, batched — the rewritten candidate
  // must clear the identical bar new generation clears.
  const cleared: Proposed[] = [];
  let llmRejected = 0;
  for (let i = 0; i < detPassed.length; i += REVERIFY_BATCH_SIZE) {
    const batch = detPassed.slice(i, i + REVERIFY_BATCH_SIZE);
    const result = await findQualityFailures(
      batch.map((p) => toLlmQuestion(p.row, p.proposedText, p.proposedAnswer)),
    );
    batch.forEach((p, idx) => {
      if (result.toDrop.has(idx) || result.offDomain.has(idx)) {
        llmRejected += 1;
        console.log(
          `[rewrite] [rejected:quality-gate] ${p.row.id} — ${(result.reasons[idx] ?? '').slice(0, 140)}`,
        );
      } else {
        cleared.push(p);
      }
    });
    if ((i / REVERIFY_BATCH_SIZE) % 10 === 0) {
      console.log(`[rewrite] ...reverified ${Math.min(i + REVERIFY_BATCH_SIZE, detPassed.length)}/${detPassed.length}`);
    }
  }
  console.log(`[rewrite] quality-gate reverify: ${cleared.length} cleared, ${llmRejected} rejected`);

  console.log(
    `\n[rewrite] SUMMARY: ${population.length} eligible -> ${unsalvageable} unsalvageable, ${detRejected + llmRejected} rewrite-still-defective, ${cleared.length} recoverable`,
  );
  for (const p of cleared) {
    console.log(`\n  [recoverable] ${p.row.id} (${p.row.canonicalSubcategory})`);
    console.log(`    was Q: ${p.row.questionText.slice(0, 120)}`);
    console.log(`    was A: ${p.row.answer.slice(0, 90)}`);
    console.log(`    now Q: ${p.proposedText.slice(0, 120)}`);
    console.log(`    now A: ${p.proposedAnswer.slice(0, 90)}`);
    console.log(`    note: ${p.note.slice(0, 160)}`);
  }

  if (!APPLY) {
    console.log(`\n[rewrite] DRY RUN — would restore ${cleared.length} row(s). Re-run with --apply to write.`);
    return;
  }

  let applied = 0;
  for (const p of cleared) {
    const updated = await db
      .update(generatedQuestions)
      .set({
        questionText: p.proposedText,
        answer: p.proposedAnswer,
        explainer: p.proposedExplainer,
        isDuplicate: false,
        verificationVerdict: 'ok',
        verifiedAt: new Date(),
        verificationReason: `rewritten: ${p.note}`.slice(0, 500),
      })
      .where(inArray(generatedQuestions.id, [p.row.id]))
      .returning({ id: generatedQuestions.id });
    applied += updated.length;
  }
  console.log(`\n[rewrite] restored ${applied} row(s) to serving.`);
}

main()
  .catch((err) => {
    console.error('[rewrite] failed', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
