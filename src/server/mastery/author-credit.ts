/**
 * Shared author-credit helpers used by all answer surfaces (Feed, Daily, Joshing Game).
 * Extracted from joshing-game.ts to enable calling from Feed and Daily routes.
 */

import { and, count, eq } from 'drizzle-orm';

import { db, masteryEvents } from '@/server/db';

/**
 * Count existing author_credit mastery events for a given question+author pair.
 * The windowed model uses this ordinal to determine the credit amount for the
 * next correct answerer.
 */
export async function countAuthorCreditEvents(questionId: string, authorId: string): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(masteryEvents)
    .where(and(
      eq(masteryEvents.userId, authorId),
      eq(masteryEvents.questionId, questionId),
      eq(masteryEvents.sourceType, 'author_credit'),
    ));

  return row?.value ?? 0;
}
