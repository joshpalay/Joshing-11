/**
 * One-off cleanup: retire the Harry Potter "house cup points" question whose
 * stem asserts a false premise — that Neville Longbottom's award was
 *   "fifty points — the largest single award in that sequence".
 * In Philosopher's Stone Neville received TEN points (the decisive award), and
 * the LARGEST single award was Harry's SIXTY. The stated answer (Neville) is
 * defensible as "the courage award", but the point count is fabricated, and the
 * row's own explainer is internally scrambled. The factual gate
 * (findFactualFailures) is meant to catch exactly this "answer-right /
 * premise-false" class but fails open and missed it; the row was even marked
 * trust_tier = machine_verified.
 *
 * Two scoped writes, both reversible:
 *   - Question (live, promoted today): soft-delete (deleted_at) — honored by
 *     every serving path (daily.ts filters isNull(deletedAt)).
 *   - GeneratedQuestion (bank source): is_duplicate = true — stops re-promotion
 *     (daily selection filters eq(isDuplicate, false)). It's the only suppress
 *     flag the bank honors; suppressed_by is left null (no survivor — defect,
 *     not a dedup loser).
 *
 * Usage:
 *   npx tsx scripts/suppress-hp-points-false-premise.ts            # dry-run
 *   npx tsx scripts/suppress-hp-points-false-premise.ts --apply
 */

import 'dotenv/config';

import { and, eq, isNull } from 'drizzle-orm';

import { db, questions, generatedQuestions } from '../src/server/db';

const LIVE_QUESTION_ID = '0417b3b0-4d4c-4ccc-941f-c4a3e569b466';
const BANK_QUESTION_ID = '17b0f389-a497-4039-9306-a3539f149d15';

const DRY_RUN = !process.argv.includes('--apply');

async function main() {
  if (DRY_RUN) {
    console.log('[dry-run] No changes will be made. Pass --apply to mutate.');
  }

  const [live] = await db
    .select({
      id: questions.id,
      deletedAt: questions.deletedAt,
      questionText: questions.questionText,
      answerText: questions.answerText,
    })
    .from(questions)
    .where(eq(questions.id, LIVE_QUESTION_ID));

  const [bank] = await db
    .select({
      id: generatedQuestions.id,
      isDuplicate: generatedQuestions.isDuplicate,
      factKey: generatedQuestions.factKey,
    })
    .from(generatedQuestions)
    .where(eq(generatedQuestions.id, BANK_QUESTION_ID));

  if (!live) console.warn(`Live Question ${LIVE_QUESTION_ID} not found.`);
  else
    console.log(
      `${live.deletedAt ? 'ALREADY DELETED' : 'will soft-delete'} Question ${live.id} | ${live.answerText} | ${live.questionText.slice(0, 60)}…`,
    );

  if (!bank) console.warn(`Bank GeneratedQuestion ${BANK_QUESTION_ID} not found.`);
  else
    console.log(
      `${bank.isDuplicate ? 'ALREADY SUPPRESSED' : 'will suppress'} GeneratedQuestion ${bank.id} | fact_key=${bank.factKey}`,
    );

  if (DRY_RUN) return;

  const deleted = await db
    .update(questions)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(questions.id, LIVE_QUESTION_ID), isNull(questions.deletedAt)))
    .returning({ id: questions.id });
  console.log(`Soft-deleted ${deleted.length} live question(s).`);

  const suppressed = await db
    .update(generatedQuestions)
    .set({ isDuplicate: true })
    .where(and(eq(generatedQuestions.id, BANK_QUESTION_ID), eq(generatedQuestions.isDuplicate, false)))
    .returning({ id: generatedQuestions.id });
  console.log(`Suppressed ${suppressed.length} bank row(s).`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
