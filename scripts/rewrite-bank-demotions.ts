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
// CHUNKED, NOT two global phases (2026-09-07 revision — the original all-
// propose-then-all-reverify design lost ~340 already-paid-for Sonnet
// proposals when the process was killed mid-run: nothing had been applied
// yet, so nothing was lost from the DB's point of view, but the computed
// proposals themselves were never logged and had to be redone). Now:
// propose a chunk (concurrent) -> reverify that chunk (deterministic, then
// the batched Haiku quality gate) -> APPLY that chunk's survivors -> next
// chunk. A kill mid-run costs at most one chunk's work, not the whole run.
// The eligibility query also excludes rows already touched by a prior run
// (verification_reason no longer starts with 'bank sweep:' once rewritten
// or marked unsalvageable) — RE-RUNNING THIS SCRIPT RESUMES, it does not
// restart from scratch.
//
//   npx tsx scripts/rewrite-bank-demotions.ts                    # DRY RUN
//   npx tsx scripts/rewrite-bank-demotions.ts --apply             # writes
//   REWRITE_LIMIT=20 npx tsx scripts/rewrite-bank-demotions.ts    # pilot batch

const APPLY = process.argv.includes('--apply');
const PROPOSE_CONCURRENCY = Math.max(1, Number(process.env.REWRITE_CONCURRENCY ?? 3));
const CHUNK_SIZE = Math.max(1, Number(process.env.REWRITE_CHUNK_SIZE ?? 10));
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

async function fetchEligible(): Promise<Row[]> {
  return (await db
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
        // Exactly the still-untouched sweep demotions: a prior run of THIS
        // script stamps a different reason ('rewritten: ...' on success,
        // 'unsalvageable: ...' / 'still defective: ...' on failure) so those
        // rows fall out of this WHERE clause on the next run — that's the
        // resume mechanism, no separate "already processed" bookkeeping.
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
}

type Outcome =
  | { kind: 'unsalvageable'; row: Row; note: string }
  | { kind: 'rejected'; row: Row; note: string }
  | { kind: 'recovered'; row: Row; text: string; answer: string; explainer: string; note: string };

async function processChunk(chunk: Row[]): Promise<Outcome[]> {
  // Propose, concurrent within the chunk.
  const proposed: {
    row: Row;
    text: string;
    answer: string;
    explainer: string;
    note: string;
  }[] = [];
  const outcomes: Outcome[] = [];
  await runWithConcurrency(chunk, PROPOSE_CONCURRENCY, async (row) => {
    const defectReason = row.verificationReason.replace(/^bank sweep:\s*/i, '');
    const proposal = await proposeBankRewrite({
      questionText: row.questionText,
      answer: row.answer,
      explainer: row.explainer,
      defectReason,
      canonicalSubcategory: row.canonicalSubcategory,
      broadCategory: row.broadCategory,
    });
    if (proposal.kind === 'unsalvageable' || (!proposal.proposedQuestionText && !proposal.proposedAnswer)) {
      outcomes.push({ kind: 'unsalvageable', row, note: proposal.note });
      return;
    }
    proposed.push({
      row,
      text: proposal.proposedQuestionText ?? row.questionText,
      answer: proposal.proposedAnswer ?? row.answer,
      explainer: proposal.proposedExplainer ?? row.explainer,
      note: proposal.note,
    });
  });

  // Deterministic reverify — free, catches a rewrite that traded one leak
  // for another.
  const detPassed: typeof proposed = [];
  for (const p of proposed) {
    const defect = findBankSourceDefect({ questionText: p.text, answer: p.answer });
    if (defect) {
      outcomes.push({ kind: 'rejected', row: p.row, note: `deterministic: ${defect}` });
    } else {
      detPassed.push(p);
    }
  }

  // Same Haiku quality gate the sweep used, one batched call per chunk — the
  // rewritten candidate must clear the identical bar new generation clears.
  if (detPassed.length > 0) {
    const result = await findQualityFailures(
      detPassed.map((p) => toLlmQuestion(p.row, p.text, p.answer)),
    );
    detPassed.forEach((p, idx) => {
      if (result.toDrop.has(idx) || result.offDomain.has(idx)) {
        outcomes.push({
          kind: 'rejected',
          row: p.row,
          note: `quality-gate: ${(result.reasons[idx] ?? 'flagged').slice(0, 300)}`,
        });
      } else {
        outcomes.push({
          kind: 'recovered',
          row: p.row,
          text: p.text,
          answer: p.answer,
          explainer: p.explainer,
          note: p.note,
        });
      }
    });
  }

  return outcomes;
}

async function main() {
  const eligible = await fetchEligible();
  const population = LIMIT > 0 ? eligible.slice(0, LIMIT) : eligible;
  console.log(
    `[rewrite] ${population.length} wording-defect rows eligible${LIMIT > 0 ? ` (capped from ${eligible.length})` : ''}`,
  );

  let unsalvageable = 0;
  let rejected = 0;
  let recovered = 0;

  for (let i = 0; i < population.length; i += CHUNK_SIZE) {
    const chunk = population.slice(i, i + CHUNK_SIZE);
    const outcomes = await processChunk(chunk);

    for (const o of outcomes) {
      if (o.kind === 'unsalvageable') {
        unsalvageable += 1;
        console.log(`[rewrite] [unsalvageable] ${o.row.id} (${o.row.canonicalSubcategory}) — ${o.note.slice(0, 140)}`);
      } else if (o.kind === 'rejected') {
        rejected += 1;
        console.log(`[rewrite] [rejected] ${o.row.id} (${o.row.canonicalSubcategory}) — ${o.note.slice(0, 140)}`);
      } else {
        recovered += 1;
        console.log(`[rewrite] [recovered] ${o.row.id} (${o.row.canonicalSubcategory}) — ${o.note.slice(0, 140)}`);
        console.log(`    was Q: ${o.row.questionText.slice(0, 120)}`);
        console.log(`    now Q: ${o.text.slice(0, 120)}`);
        console.log(`    was A: ${o.row.answer.slice(0, 80)}  ->  now A: ${o.answer.slice(0, 80)}`);
      }
    }

    if (APPLY) {
      for (const o of outcomes) {
        if (o.kind === 'unsalvageable') {
          await db
            .update(generatedQuestions)
            .set({ verificationReason: `unsalvageable: ${o.note}`.slice(0, 500) })
            .where(inArray(generatedQuestions.id, [o.row.id]));
        } else if (o.kind === 'rejected') {
          await db
            .update(generatedQuestions)
            .set({ verificationReason: `still defective: ${o.note}`.slice(0, 500) })
            .where(inArray(generatedQuestions.id, [o.row.id]));
        } else {
          await db
            .update(generatedQuestions)
            .set({
              questionText: o.text,
              answer: o.answer,
              explainer: o.explainer,
              isDuplicate: false,
              verificationVerdict: 'ok',
              verifiedAt: new Date(),
              verificationReason: `rewritten: ${o.note}`.slice(0, 500),
            })
            .where(inArray(generatedQuestions.id, [o.row.id]));
        }
      }
    }

    console.log(
      `[rewrite] ...chunk ${Math.min(i + CHUNK_SIZE, population.length)}/${population.length} — running totals: ${recovered} recovered, ${rejected} rejected, ${unsalvageable} unsalvageable${APPLY ? '' : ' (DRY RUN, not written)'}`,
    );
  }

  console.log(
    `\n[rewrite] DONE. ${population.length} eligible -> ${recovered} recovered, ${rejected} rewrite-still-defective, ${unsalvageable} unsalvageable.`,
  );
  if (!APPLY) {
    console.log('[rewrite] DRY RUN — nothing was written. Re-run with --apply.');
  }
}

main()
  .catch((err) => {
    console.error('[rewrite] failed', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
