/**
 * One-time cleanup for FeedItems created by the 8.6 broadcast-share path
 * (sourceType = 'authored_shared').
 *
 * For each such item:
 *   - If the source user (the author) answered the question: convert to
 *     friend_answered and set sourceResult based on correctness.
 *   - Otherwise: soft-delete (state → 'rolled_off').
 *
 * Usage:
 *   npx tsx scripts/cleanup-authored-shared-feed-items.ts --dry-run
 *   npx tsx scripts/cleanup-authored-shared-feed-items.ts --apply
 */

import 'dotenv/config';

import { and, eq, inArray, ne, sql } from 'drizzle-orm';

import { db, feedItems, masteryEvents } from '../src/server/db';

const DRY_RUN = !process.argv.includes('--apply');

if (DRY_RUN) {
  console.log('[dry-run] No changes will be made. Pass --apply to mutate.');
}

async function authorAnswerResult(
  authorId: string,
  questionId: string,
): Promise<'correct' | 'incorrect' | null> {
  // Check for a correct answer first
  const [correct] = await db
    .select({ id: masteryEvents.id })
    .from(masteryEvents)
    .where(
      and(
        eq(masteryEvents.userId, authorId),
        eq(masteryEvents.questionId, questionId),
        eq(masteryEvents.answeredByUserId, authorId),
        inArray(masteryEvents.sourceType, ['live_correct', 'catchup_correct']),
        ne(masteryEvents.answerState, 'incorrect'),
        sql`${masteryEvents.awardedPoints} > 0`,
      ),
    )
    .limit(1);

  if (correct) return 'correct';

  // Check for any answer (incorrect)
  const [any] = await db
    .select({ id: masteryEvents.id })
    .from(masteryEvents)
    .where(
      and(
        eq(masteryEvents.userId, authorId),
        eq(masteryEvents.questionId, questionId),
        eq(masteryEvents.answeredByUserId, authorId),
      ),
    )
    .limit(1);

  return any ? 'incorrect' : null;
}

async function main() {
  const rows = await db.select().from(feedItems).where(eq(feedItems.sourceType, 'authored_shared'));

  console.log(`Found ${rows.length} authored_shared FeedItem(s).`);
  if (rows.length === 0) {
    console.log('Nothing to clean up.');
    return;
  }

  let converted = 0;
  let deleted = 0;

  for (const row of rows) {
    if (!row.questionId) {
      // No question — soft-delete
      console.log(`  [${row.id}] No questionId — will roll off`);
      if (!DRY_RUN) {
        await db.update(feedItems).set({ state: 'rolled_off' }).where(eq(feedItems.id, row.id));
      }
      deleted++;
      continue;
    }

    const result = await authorAnswerResult(row.sourceUserId, row.questionId);

    if (result !== null) {
      console.log(`  [${row.id}] Author answered (${result}) — will convert to friend_answered`);
      if (!DRY_RUN) {
        await db
          .update(feedItems)
          .set({ sourceType: 'friend_answered', sourceResult: result })
          .where(eq(feedItems.id, row.id));
      }
      converted++;
    } else {
      console.log(`  [${row.id}] Author has not answered — will roll off`);
      if (!DRY_RUN) {
        await db.update(feedItems).set({ state: 'rolled_off' }).where(eq(feedItems.id, row.id));
      }
      deleted++;
    }
  }

  console.log('\nSummary:');
  console.log(`  Total found:                ${rows.length}`);
  console.log(`  Converted to friend_answered: ${converted}`);
  console.log(`  Rolled off (soft-deleted):  ${deleted}`);
  if (DRY_RUN) {
    console.log('\n[dry-run] No changes applied. Re-run with --apply to execute.');
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
