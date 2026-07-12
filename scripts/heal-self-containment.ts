// Bank-healing sweep for un-anchored (non-self-contained) questions — the
// measured follow-up to the generation-side "NAME THE SOURCE" rule (PR #1500).
//
// DRY-RUN BY DEFAULT: classifies servable questions with the Haiku self-
// containment classifier and PRINTS what it would demote, making ZERO writes.
// Add --apply to demote (GeneratedQuestion → is_duplicate; Question →
// needs_review), reusing the exact patch helpers the factual verifier uses. The
// --apply gate is the off-by-default safety: review the dry-run output first.
//
// Usage (prod DB + secrets live in .env):
//   npx tsx -r dotenv/config scripts/heal-self-containment.ts dotenv_config_path=.env
//   npx tsx -r dotenv/config scripts/heal-self-containment.ts --limit 200 dotenv_config_path=.env
//   npx tsx -r dotenv/config scripts/heal-self-containment.ts --store g --apply dotenv_config_path=.env
import 'dotenv/config';

import { and, eq, gt, isNull, ne } from 'drizzle-orm';

import { db, generatedQuestions, questions, pool } from '../src/server/db';
import { runWithConcurrency } from '../src/server/lib/concurrency';
import { classifySelfContainment, questionNamesSubject } from '../src/server/quality/self-containment';
import { verdictToGeneratedPatch, verdictToQuestionPatch } from '../src/server/quality/verify-question';

const argv = process.argv.slice(2);
const has = (f: string) => argv.includes(f);
const num = (f: string, d: number) => {
  const i = argv.indexOf(f);
  if (i === -1 || i + 1 >= argv.length) return d;
  const n = Number(argv[i + 1]);
  return Number.isFinite(n) ? n : d;
};
const str = (f: string): string | null => {
  const i = argv.indexOf(f);
  return i !== -1 && i + 1 < argv.length ? argv[i + 1] : null;
};

const APPLY = has('--apply');
const LIMIT = num('--limit', 0); // 0 = no limit (whole servable set)
const CONCURRENCY = num('--concurrency', 6);
const STORE = (str('--store') ?? 'both') as 'q' | 'g' | 'both';

type Row = {
  id: string;
  text: string;
  answer: string;
  sub: string | null;
  broad: string | null;
};

async function selectGenerated(now: Date): Promise<Row[]> {
  const q = db
    .select({
      id: generatedQuestions.id,
      text: generatedQuestions.questionText,
      answer: generatedQuestions.answer,
      sub: generatedQuestions.canonicalSubcategory,
      broad: generatedQuestions.broadCategory,
    })
    .from(generatedQuestions)
    .where(and(eq(generatedQuestions.isDuplicate, false), gt(generatedQuestions.expiresAt, now)));
  const rows = LIMIT > 0 ? await q.limit(LIMIT) : await q;
  return rows;
}

async function selectCanonical(): Promise<Row[]> {
  const q = db
    .select({
      id: questions.id,
      text: questions.questionText,
      answer: questions.answerText,
      sub: questions.canonicalSubcategory,
      broad: questions.broadCategory,
    })
    .from(questions)
    .where(
      and(
        ne(questions.visibility, 'blocked'),
        isNull(questions.deletedAt),
        // Skip rows already sitting in review so re-runs don't re-spend on them.
        ne(questions.publicStatus, 'needs_review'),
      ),
    );
  const rows = LIMIT > 0 ? await q.limit(LIMIT) : await q;
  return rows;
}

type Flagged = { row: Row; reason: string };

async function sweep(label: string, store: 'q' | 'g', rows: Row[], now: Date) {
  let classified = 0;
  let failed = 0;
  let selfContained = 0;
  let guardSaves = 0;
  const flagged: Flagged[] = [];

  await runWithConcurrency(rows, CONCURRENCY, async (row) => {
    if (!row.sub) {
      selfContained += 1; // no hidden subject to fail against; leave it alone
      return;
    }
    const verdict = await classifySelfContainment({
      questionText: row.text,
      answer: row.answer,
      canonicalSubcategory: row.sub,
      broadCategory: row.broad,
    });
    if (!verdict) {
      failed += 1; // fail-open: never demote on a classifier failure
      return;
    }
    classified += 1;
    if (verdict.selfContained) {
      selfContained += 1;
      return;
    }
    // Last-resort guard: if the question literally names its own subcategory, the
    // LLM hallucinated the miss — never demote it.
    if (questionNamesSubject(row.text, row.sub)) {
      guardSaves += 1;
      selfContained += 1;
      return;
    }
    flagged.push({ row, reason: verdict.reason });
    if (APPLY) {
      const reason = `self-containment: ${verdict.reason}`;
      if (store === 'g') {
        await db
          .update(generatedQuestions)
          .set(verdictToGeneratedPatch('demoted', now, reason))
          .where(eq(generatedQuestions.id, row.id));
      } else {
        await db
          .update(questions)
          .set(verdictToQuestionPatch('demoted', now, reason))
          .where(eq(questions.id, row.id));
      }
    }
  });

  const denom = Math.max(1, classified);
  console.log(`\n===== ${label} =====`);
  console.log(
    `scanned: ${rows.length}  classified: ${classified}  classifier-failures: ${failed}  ` +
      `self-contained: ${selfContained}  guard-saves: ${guardSaves}  flagged: ${flagged.length} (${((flagged.length / denom) * 100).toFixed(1)}% of classified)`,
  );
  console.log(APPLY ? `APPLIED: ${flagged.length} demoted` : `DRY-RUN: no writes`);
  console.log(`\n--- FLAGGED (would demote) ---`);
  for (const f of flagged) {
    console.log(`[${f.row.sub}] ${f.row.text}\n    → ${f.reason}`);
  }
  return flagged.length;
}

async function main() {
  const now = new Date();
  console.log(
    `mode: ${APPLY ? 'APPLY' : 'DRY-RUN'}  store: ${STORE}  limit: ${LIMIT || 'none'}  concurrency: ${CONCURRENCY}`,
  );

  if (STORE === 'g' || STORE === 'both') {
    await sweep('generated (servable)', 'g', await selectGenerated(now), now);
  }
  if (STORE === 'q' || STORE === 'both') {
    await sweep('questions (eligible)', 'q', await selectCanonical(), now);
  }

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
