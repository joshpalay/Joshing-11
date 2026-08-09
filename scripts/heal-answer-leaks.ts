// Bank-healing sweep for answer-leak questions — the deterministic counterpart
// to heal-self-containment.ts. Follow-up to the discovery (2026-07-26) that
// src/server/daily/supply-backfill.ts's buildDomain() never ran the
// findAnswerLeaks backstop that generate-questions.ts and screenGroundedBatch
// both apply, so backfill-seeded bank rows could leak their answer into the
// question text (e.g. "In 'Rocko's Modern Life,' what is the name of the
// wallaby?" -> "Rocko") and sit in the bank indefinitely — served to any user
// who draws that domain via the verify-once-reuse-many bank-pick path.
//
// Pure string check (textContainsAnswer), no LLM calls, so unlike the self-
// containment sweep this is instant and free to re-run.
//
// DRY-RUN BY DEFAULT: prints what it would demote, makes ZERO writes.
// Add --apply to demote (GeneratedQuestion -> is_duplicate; Question ->
// needs_review), reusing the same patch helpers the factual verifier uses.
//
// Usage (prod DB + secrets live in .env):
//   npx tsx -r dotenv/config scripts/heal-answer-leaks.ts dotenv_config_path=.env
//   npx tsx -r dotenv/config scripts/heal-answer-leaks.ts --store g --apply dotenv_config_path=.env
import 'dotenv/config';

import { and, eq, gt, isNull, ne } from 'drizzle-orm';

import { db, generatedQuestions, questions, pool } from '../src/server/db';
import { textContainsAnswer } from '../src/server/questions/self-answering';
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
const STORE = (str('--store') ?? 'both') as 'q' | 'g' | 'both';

type Row = { id: string; text: string; answer: string; sub: string | null; alts: string[] };

async function selectGenerated(now: Date): Promise<Row[]> {
  const q = db
    .select({
      id: generatedQuestions.id,
      text: generatedQuestions.questionText,
      answer: generatedQuestions.answer,
      sub: generatedQuestions.canonicalSubcategory,
      alts: generatedQuestions.acceptableVariants,
    })
    .from(generatedQuestions)
    .where(and(eq(generatedQuestions.isDuplicate, false), gt(generatedQuestions.expiresAt, now)));
  const rows = LIMIT > 0 ? await q.limit(LIMIT) : await q;
  return rows.map((r) => ({ ...r, alts: r.alts ?? [] }));
}

async function selectCanonical(): Promise<Row[]> {
  const q = db
    .select({
      id: questions.id,
      text: questions.questionText,
      answer: questions.answerText,
      sub: questions.canonicalSubcategory,
      alts: questions.acceptedAlternatives,
    })
    .from(questions)
    .where(
      and(
        ne(questions.visibility, 'blocked'),
        isNull(questions.deletedAt),
        ne(questions.publicStatus, 'needs_review'),
      ),
    );
  const rows = LIMIT > 0 ? await q.limit(LIMIT) : await q;
  return rows.map((r) => ({ ...r, alts: r.alts ?? [] }));
}

async function sweep(label: string, store: 'q' | 'g', rows: Row[], now: Date) {
  const flagged: Row[] = [];

  for (const row of rows) {
    if (!textContainsAnswer(row.text, row.answer, row.alts)) continue;
    flagged.push(row);
    if (APPLY) {
      const reason = `answer-leak: "${row.answer}" appears in question text`.slice(0, 200);
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
  }

  console.log(`\n===== ${label} =====`);
  console.log(`scanned: ${rows.length}  flagged: ${flagged.length}`);
  console.log(APPLY ? `APPLIED: ${flagged.length} demoted` : `DRY-RUN: no writes`);
  console.log(`\n--- FLAGGED (would demote) ---`);
  for (const f of flagged) {
    console.log(`[${f.sub}] ${f.text}\n    -> answer: ${f.answer}`);
  }
  return flagged.length;
}

async function main() {
  const now = new Date();
  console.log(`mode: ${APPLY ? 'APPLY' : 'DRY-RUN'}  store: ${STORE}  limit: ${LIMIT || 'none'}`);

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
