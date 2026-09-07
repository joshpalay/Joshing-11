import 'dotenv/config';

import { eq, inArray } from 'drizzle-orm';

import { db, pool, generatedQuestions } from '../src/server/db';
import {
  findBankSourceDefect,
  findQualityFailures,
  type LlmQuestion,
} from '../src/server/daily/generate-questions';
import { verdictToGeneratedPatch } from '../src/server/quality/verify-question';

// One-time hygiene sweep over EXISTING bank stock.
//
// Why this exists: every quality gate lives inside generateDailyQuestions and
// only ever sees FRESHLY GENERATED questions. pickBankSource re-serves old
// stock by cloning a bank row straight into the queue, so anything that
// entered the bank before its gate existed is re-served forever and no gate
// tuning can reach it. Found 2026-09-06 in production: a Joyce question filed
// under "Virginia Woolf's Novels and Essays" (generated 2026-05-09) and a
// self-answering onion/tears question (generated 2026-08-21) were both served
// that day having never passed through a single gate. See
// diagnosis/answer-leak-domain-drift-plan.md.
//
// The companion fix (findBankSourceDefect, wired into pickBankSource) stops
// BAD STOCK BEING RE-SERVED from here on. This script is the other half:
// cleaning what is already in the bank. Neither substitutes for the other.
//
//   npx tsx scripts/sweep-bank-quality.ts                  # DRY RUN, all checks
//   npx tsx scripts/sweep-bank-quality.ts --no-llm         # deterministic only (no API key needed)
//   npx tsx scripts/sweep-bank-quality.ts --apply          # writes demotions to prod
//   npx tsx scripts/sweep-bank-quality.ts --apply --include-off-domain
//
// Demotion is is_duplicate=true + verdict 'demoted' + a reason, exactly the
// shape the batch verifier already uses (verdictToGeneratedPatch), so it is
// reversible (set is_duplicate=false) and shows up wherever machine demotions
// already show up. For a handful of individually-noticed rows, filing a
// ContentReport is the better route — that surfaces them in /admin/reports for
// a human. This script is bulk hygiene, so it demotes rather than flooding
// that queue.
//
// OFF_DOMAIN hits are reported but NOT demoted unless --include-off-domain is
// passed. That mirrors the DOMAIN_DRIFT_DROP_ENABLED posture: the off-domain
// judgement has no precision data behind it yet (Phase 2's eval is still
// unrun), and its false-positive mode — silently demoting a correctly-filed
// question — is invisible in production.

const APPLY = process.argv.includes('--apply');
const NO_LLM = process.argv.includes('--no-llm');
const INCLUDE_OFF_DOMAIN = process.argv.includes('--include-off-domain');
const BATCH_SIZE = Math.max(1, Number(process.env.SWEEP_BATCH_SIZE ?? 10));
const LIMIT = Number(process.env.SWEEP_LIMIT ?? 0); // 0 = no cap

type BankRow = {
  id: string;
  questionText: string;
  answer: string;
  explainer: string;
  canonicalSubcategory: string;
  broadCategory: string;
  difficultyEstimate: string;
  factKey: string | null;
  acceptableVariants: string[];
};

type Finding = { row: BankRow; reason: string; kind: 'deterministic' | 'llm' | 'off_domain' };

function asLlmQuestion(row: BankRow): LlmQuestion {
  const tier = (['accessible', 'moderate', 'specialist'] as const).includes(
    row.difficultyEstimate as never,
  )
    ? (row.difficultyEstimate as LlmQuestion['difficulty_estimate'])
    : 'moderate';
  return {
    canonical_subcategory: row.canonicalSubcategory,
    broad_category: row.broadCategory,
    question_text: row.questionText,
    answer: row.answer,
    explainer: row.explainer,
    difficulty_estimate: tier,
    fact_key: row.factKey,
    subject_entity: null,
    sub_angles: [],
    question_shape: null,
  };
}

async function main() {
  const rows = (await db
    .select({
      id: generatedQuestions.id,
      questionText: generatedQuestions.questionText,
      answer: generatedQuestions.answer,
      explainer: generatedQuestions.explainer,
      canonicalSubcategory: generatedQuestions.canonicalSubcategory,
      broadCategory: generatedQuestions.broadCategory,
      difficultyEstimate: generatedQuestions.difficultyEstimate,
      factKey: generatedQuestions.factKey,
      acceptableVariants: generatedQuestions.acceptableVariants,
    })
    .from(generatedQuestions)
    .where(eq(generatedQuestions.isDuplicate, false))) as BankRow[];

  const population = LIMIT > 0 ? rows.slice(0, LIMIT) : rows;
  console.log(
    `[sweep] ${population.length} servable bank rows${LIMIT > 0 ? ` (capped from ${rows.length})` : ''}`,
  );

  const findings: Finding[] = [];

  // Pass 1 — deterministic. Free, no API key, catches the lexical defects.
  const survivors: BankRow[] = [];
  for (const row of population) {
    const defect = findBankSourceDefect(row);
    if (defect) findings.push({ row, reason: defect, kind: 'deterministic' });
    else survivors.push(row);
  }
  console.log(`[sweep] deterministic: ${findings.length} defective / ${population.length}`);

  // Pass 2 — the Haiku quality gate. This is what reaches the SEMANTIC defects
  // (a stem that paraphrases its answer, a definition that hands the answer
  // over, a question filed under a sibling domain) that no lexical rule can.
  if (!NO_LLM) {
    let batches = 0;
    for (let i = 0; i < survivors.length; i += BATCH_SIZE) {
      const batch = survivors.slice(i, i + BATCH_SIZE);
      const result = await findQualityFailures(batch.map(asLlmQuestion));
      for (const idx of result.toDrop) {
        findings.push({ row: batch[idx], reason: result.reasons[idx] ?? 'quality gate', kind: 'llm' });
      }
      for (const idx of result.offDomain) {
        findings.push({
          row: batch[idx],
          reason: result.reasons[idx] ?? 'OFF_DOMAIN',
          kind: 'off_domain',
        });
      }
      batches += 1;
      if (batches % 10 === 0) {
        console.log(`[sweep] ...${i + batch.length}/${survivors.length} through the quality gate`);
      }
    }
    console.log(`[sweep] quality gate: ${batches} batches over ${survivors.length} rows`);
  } else {
    console.log('[sweep] --no-llm: skipped the quality gate (semantic defects NOT checked)');
  }

  const byKind = {
    deterministic: findings.filter((f) => f.kind === 'deterministic'),
    llm: findings.filter((f) => f.kind === 'llm'),
    off_domain: findings.filter((f) => f.kind === 'off_domain'),
  };
  console.log(
    `\n[sweep] findings: ${byKind.deterministic.length} deterministic, ${byKind.llm.length} quality-gate, ${byKind.off_domain.length} off-domain`,
  );
  for (const f of findings) {
    console.log(
      `\n  [${f.kind}] ${f.row.id}  (${f.row.canonicalSubcategory})\n    Q: ${f.row.questionText.slice(0, 130)}\n    A: ${f.row.answer.slice(0, 90)}\n    why: ${f.reason.slice(0, 160)}`,
    );
  }

  const toDemote = findings.filter((f) => f.kind !== 'off_domain' || INCLUDE_OFF_DOMAIN);
  if (!APPLY) {
    console.log(
      `\n[sweep] DRY RUN — would demote ${toDemote.length} row(s). Re-run with --apply to write.`,
    );
    return;
  }

  // De-dupe: a row can be flagged by more than one pass; keep the first reason.
  const seen = new Map<string, string>();
  for (const f of toDemote) if (!seen.has(f.row.id)) seen.set(f.row.id, f.reason);

  let demoted = 0;
  for (const [id, reason] of seen) {
    const patch = verdictToGeneratedPatch('demoted', new Date(), `bank sweep: ${reason}`.slice(0, 400));
    const updated = await db
      .update(generatedQuestions)
      .set(patch)
      .where(inArray(generatedQuestions.id, [id]))
      .returning({ id: generatedQuestions.id });
    demoted += updated.length;
  }
  console.log(`\n[sweep] demoted ${demoted} row(s).`);
}

main()
  .catch((err) => {
    console.error('[sweep] failed', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
