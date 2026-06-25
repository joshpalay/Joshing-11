/**
 * One-off cleanup: soft-delete the two daily-generated Breaking Bad questions
 * that named the episode title (which was the answer) in the stem —
 *   "A box cutter" / "A fly"
 * They slipped the answer-leak gate because the leading article defeated the
 * substring check (now fixed in src/server/questions/self-answering.ts).
 *
 * Soft-delete only (sets deleted_at); reversible. Scoped to two explicit ids.
 *
 * Usage:
 *   npx tsx scripts/soft-delete-self-answering-questions.ts            # dry-run
 *   npx tsx scripts/soft-delete-self-answering-questions.ts --apply
 */

import 'dotenv/config';

import { inArray, isNull, and } from 'drizzle-orm';

import { db, questions } from '../src/server/db';

const TARGET_IDS = [
  '98f4d6f8-66e8-4808-96fd-88fa436bfa3a', // "A box cutter"
  '011a7bdd-19fb-4cec-8ec9-4b2eb96d7730', // "A fly"
];

const DRY_RUN = !process.argv.includes('--apply');

async function main() {
  if (DRY_RUN) {
    console.log('[dry-run] No changes will be made. Pass --apply to mutate.');
  }

  const rows = await db
    .select({
      id: questions.id,
      questionText: questions.questionText,
      answerText: questions.answerText,
      deletedAt: questions.deletedAt,
    })
    .from(questions)
    .where(inArray(questions.id, TARGET_IDS));

  for (const row of rows) {
    console.log(
      `${row.deletedAt ? 'ALREADY DELETED' : 'will soft-delete'} ${row.id} | ${row.answerText} | ${row.questionText.slice(0, 60)}…`,
    );
  }

  if (rows.length !== TARGET_IDS.length) {
    console.warn(`Expected ${TARGET_IDS.length} rows, found ${rows.length}.`);
  }

  if (DRY_RUN) return;

  const updated = await db
    .update(questions)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(and(inArray(questions.id, TARGET_IDS), isNull(questions.deletedAt)))
    .returning({ id: questions.id });

  console.log(`Soft-deleted ${updated.length} row(s).`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
