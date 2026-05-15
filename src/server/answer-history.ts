import { and, asc, eq, inArray, isNotNull } from 'drizzle-orm';

import { db, masteryEvents } from '@/server/db';

/**
 * Read prior answer events for a (user, canonical question) pair, ordered
 * oldest-first. Used to compute answer_state at insert time.
 *
 * The shared source of truth is masteryEvents — it carries answer_state and
 * is written by every live answer surface (Daily, Feed, joshing-game,
 * Catch-up). Author-credit and curator-credit events are excluded because
 * they don't represent the user themselves answering the question.
 */
export async function readPriorAnswersForQuestion(
  userId: string,
  canonicalQuestionId: string,
): Promise<{ result: 'correct' | 'wrong' }[]> {
  const rows = await db
    .select({
      sourceType: masteryEvents.sourceType,
      answerState: masteryEvents.answerState,
      createdAt: masteryEvents.createdAt,
      id: masteryEvents.id,
    })
    .from(masteryEvents)
    .where(
      and(
        eq(masteryEvents.userId, userId),
        eq(masteryEvents.questionId, canonicalQuestionId),
        inArray(masteryEvents.sourceType, ['live_correct', 'catchup_correct']),
        isNotNull(masteryEvents.answerState),
      ),
    )
    .orderBy(asc(masteryEvents.createdAt), asc(masteryEvents.id));

  return rows.map((row) => {
    const state = row.answerState;
    const correct =
      state === 'first_correct' ||
      state === 'first_correct_after_wrong' ||
      state === 'repeat_correct';
    return { result: correct ? ('correct' as const) : ('wrong' as const) };
  });
}
