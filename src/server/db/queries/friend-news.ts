import { and, eq, gte, inArray, isNull, ne, notExists, sql } from 'drizzle-orm';

import { db } from '@/server/db';
import { activityItems, masteryEvents, questions, users } from '@/server/db/schema';
import { getFriends } from '@/server/db/queries/friends';

/**
 * "What did my friends do?" for one player over one window — the single source
 * the daily text, the daily email, and the weekly friends email all read, so
 * the three can never tell a player different stories.
 *
 * Friends = mutual follows (getFriends, which already drops blocked pairs).
 * Everything is counted, not listed, so the formatters stay short.
 *
 * NOTE on "answered your question": the ActivityItem type
 * `friend_answered_your_question` is NOT what it sounds like — it is written to
 * players who ALREADY got a question right when a friend gets the same one right
 * (create-feed-items-for-answer.ts notifyPreviousAnswerers). Answers to questions
 * the player actually WROTE are read here straight from MASTERY_EVENTS, which
 * records both correct and incorrect live answers against Question.creator_id.
 */
export type FriendNews = {
  /** Friends who answered questions this player wrote, most active first. */
  answeredYourQuestions: Array<{ friendId: string; name: string; total: number; correct: number }>;
  /** New questions friends wrote that this player hasn't answered yet. */
  newQuestionsFromFriends: Array<{ friendId: string; name: string; count: number }>;
  /** People who became this player's mutual friends in the window. */
  newFriends: Array<{ friendId: string; name: string }>;
  /** People this player invited who just played their first five. */
  invitedStarted: Array<{ friendId: string; name: string }>;
};

export const EMPTY_FRIEND_NEWS: FriendNews = {
  answeredYourQuestions: [],
  newQuestionsFromFriends: [],
  newFriends: [],
  invitedStarted: [],
};

function nameOf(displayName: string | null | undefined): string {
  return displayName?.trim() || 'A friend';
}

export async function getFriendNews(userId: string, since: Date): Promise<FriendNews> {
  const friends = await getFriends(userId);
  const friendIds = friends.map((f) => f.id);
  const nameById = new Map(friends.map((f) => [f.id, nameOf(f.displayName)]));

  const [answerRows, questionRows, activityRows] = await Promise.all([
    friendIds.length === 0
      ? Promise.resolve([])
      : db
          .select({
            friendId: masteryEvents.userId,
            total: sql<number>`count(distinct ${masteryEvents.questionId})`,
            correct: sql<number>`count(distinct ${masteryEvents.questionId}) filter (where ${masteryEvents.answerState} is distinct from 'incorrect')`,
          })
          .from(masteryEvents)
          .innerJoin(questions, eq(questions.id, masteryEvents.questionId))
          .where(
            and(
              eq(questions.creatorId, userId),
              inArray(masteryEvents.userId, friendIds),
              inArray(masteryEvents.sourceType, ['live_correct', 'catchup_correct']),
              gte(masteryEvents.createdAt, since),
            ),
          )
          .groupBy(masteryEvents.userId),
    friendIds.length === 0
      ? Promise.resolve([])
      : db
          .select({
            friendId: questions.creatorId,
            count: sql<number>`count(*)`,
          })
          .from(questions)
          .where(
            and(
              inArray(questions.creatorId, friendIds),
              isNull(questions.deletedAt),
              eq(questions.isDuplicate, false),
              ne(questions.visibility, 'private'),
              gte(questions.createdAt, since),
              notExists(
                db
                  .select({ one: sql`1` })
                  .from(masteryEvents)
                  .where(
                    and(
                      eq(masteryEvents.questionId, questions.id),
                      eq(masteryEvents.userId, userId),
                    ),
                  ),
              ),
            ),
          )
          .groupBy(questions.creatorId),
    db
      .select({
        type: activityItems.type,
        actorUserId: activityItems.actorUserId,
        actorName: users.displayName,
      })
      .from(activityItems)
      .innerJoin(users, eq(users.id, activityItems.actorUserId))
      .where(
        and(
          eq(activityItems.userId, userId),
          isNull(activityItems.deletedAt),
          inArray(activityItems.type, [
            'follow_mutual',
            'follow_approved',
            'invited_friend_played_first_five',
          ]),
          gte(activityItems.createdAt, since),
        ),
      ),
  ]);

  const answeredYourQuestions = answerRows
    .map((r) => ({
      friendId: r.friendId,
      name: nameById.get(r.friendId) ?? 'A friend',
      total: Number(r.total),
      correct: Number(r.correct),
    }))
    .filter((r) => r.total > 0)
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));

  const newQuestionsFromFriends = questionRows
    .flatMap((r) =>
      r.friendId
        ? [{ friendId: r.friendId, name: nameById.get(r.friendId) ?? 'A friend', count: Number(r.count) }]
        : [],
    )
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

  // Activity rows name people directly; drop anyone who is no longer a friend
  // (unfollowed or blocked since) and de-duplicate across the two follow types.
  const newFriends = new Map<string, string>();
  const invitedStarted = new Map<string, string>();
  for (const row of activityRows) {
    if (!row.actorUserId || !nameById.has(row.actorUserId)) continue;
    const target = row.type === 'invited_friend_played_first_five' ? invitedStarted : newFriends;
    target.set(row.actorUserId, nameOf(row.actorName));
  }
  // Someone whose invite just stuck is also a new friend — say it once, the
  // warmer way.
  for (const id of invitedStarted.keys()) newFriends.delete(id);

  const toList = (m: Map<string, string>) =>
    [...m].map(([friendId, name]) => ({ friendId, name }));

  return {
    answeredYourQuestions,
    newQuestionsFromFriends,
    newFriends: toList(newFriends),
    invitedStarted: toList(invitedStarted),
  };
}
