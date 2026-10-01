import 'dotenv/config';

import { inArray } from 'drizzle-orm';

import { db, pool, generatedQuestions } from '../src/server/db';
import { verdictToGeneratedPatch } from '../src/server/quality/verify-question';

// One-off demotion of a self-contradicting Catch-22 question (QA 2026-10-01, S4).
//
// The stem asks which tentmate is "killed off camera between chapters, his
// belongings quickly stripped and redistributed while Yossarian is still
// grieving". The answer is Mudd, and the row's own explainer says the opposite
// of the premise: Mudd's gear stays "haunting Yossarian's tent as 'the dead
// man' for the rest of the novel". The 2026-07-22 verify pass returned 'ok'
// while its reason text restated that same contradiction — it checked the
// explainer's extra facts, not whether the stem agrees with the answer.
//
// Both rows carry the identical stem: the bank original and the 2026-09-30
// clone pickBankSource made into Duo Prova's queue.
//
//   npx tsx scripts/demote-2026-10-01-catch22-mudd.ts            # DRY RUN
//   npx tsx scripts/demote-2026-10-01-catch22-mudd.ts --apply    # writes

const APPLY = process.argv.includes('--apply');

const REASON =
  'QA 2026-10-01 S4: stem says the tentmate’s belongings were quickly stripped and redistributed; ' +
  'the answer (Mudd) and its own explainer say his gear stays in the tent for the rest of the novel.';

const IDS = [
  '3abf36ce-2773-4125-804f-4db337841490', // bank original (2026-07-18)
  '096e67f5-a89b-488c-b99b-70eb14521f52', // clone served to Duo Prova (2026-09-30)
];

async function main() {
  const rows = await db
    .select({
      id: generatedQuestions.id,
      questionText: generatedQuestions.questionText,
      verdict: generatedQuestions.verificationVerdict,
      isDuplicate: generatedQuestions.isDuplicate,
    })
    .from(generatedQuestions)
    .where(inArray(generatedQuestions.id, IDS));
  for (const row of rows) {
    console.log(`[demote] ${row.id} verdict=${row.verdict ?? 'null'} is_duplicate=${row.isDuplicate}`);
    console.log(`         ${row.questionText.slice(0, 110)}…`);
  }
  if (rows.length !== IDS.length) throw new Error(`expected ${IDS.length} rows, found ${rows.length}`);
  if (!APPLY) {
    console.log('[demote] DRY RUN — re-run with --apply to write.');
    return;
  }
  const updated = await db
    .update(generatedQuestions)
    .set(verdictToGeneratedPatch('demoted', new Date(), REASON))
    .where(inArray(generatedQuestions.id, IDS))
    .returning({ id: generatedQuestions.id });
  console.log(`[demote] demoted ${updated.length} row(s).`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
