import { and, eq, gte, inArray, isNotNull, isNull } from 'drizzle-orm'

import { deriveSharedAnswerActivity, type SharedAnswerActivity } from '@/lib/shared-answer-activity'
import { db, feedItems, masteryEvents, questions, users } from '@/server/db'
import { getViewerHiddenQuestionIds } from '@/server/db/queries/content-reports'
import { mutualFollowApproved } from '@/server/db/queries/follow-visibility'
import { blockedIdsAmong } from '@/server/db/queries/user-blocks'
import { notBlocked } from '@/server/feed/visibility'
import { applyTierGate, FRIEND_FACING_TIERS, type TrustTier } from '@/server/daily/verification-gating'

const CORRECT_STATES = ['first_correct', 'first_correct_after_wrong', 'repeat_correct'] as const
const ANSWER_SOURCES = ['live_correct', 'catchup_correct'] as const

// An opt-in Home comparison. The existing activity stream and its cluster rules
// stay intact; this read emits individual shared questions with no count threshold.
export async function getSharedAnswerActivity(userId: string, windowDays: number): Promise<SharedAnswerActivity[]> {
  const since = new Date(Date.now() - windowDays * 86_400_000)
  const friendRows = await db.select({ userId: users.id, name: users.displayName })
    .from(users).where(mutualFollowApproved(userId, users.id, 'shared_answer_activity'))
  const blocked = await blockedIdsAmong(userId, friendRows.map((friend) => friend.userId))
  const friends = friendRows.filter((friend) => friend.userId !== userId && !blocked.has(friend.userId))
    .map((friend) => ({ ...friend, name: friend.name?.trim() || 'A friend' }))
  if (!friends.length) return []
  const participants = [userId, ...friends.map((friend) => friend.userId)]
  // Bound the later answer, so an old answer of ours can meet a new friend's answer.
  const candidates = await db.selectDistinct({ questionId: masteryEvents.questionId })
    .from(masteryEvents).where(and(
      inArray(masteryEvents.userId, participants),
      inArray(masteryEvents.sourceType, ANSWER_SOURCES),
      inArray(masteryEvents.answerState, CORRECT_STATES),
      isNotNull(masteryEvents.questionId),
      gte(masteryEvents.createdAt, since),
    ))
  const ids = candidates.map((row) => row.questionId).filter((id): id is string => Boolean(id))
  if (!ids.length) return []
  const [answers, feed, hidden] = await Promise.all([
    db.select({
      userId: masteryEvents.userId,
      questionId: questions.id,
      questionText: questions.questionText,
      correctAnswer: questions.answerText,
      domain: questions.canonicalSubcategory,
      answeredAt: masteryEvents.createdAt,
      answerId: masteryEvents.answerId,
      trustTier: questions.trustTier,
    }).from(masteryEvents).innerJoin(questions, eq(questions.id, masteryEvents.questionId))
      .where(and(
        inArray(masteryEvents.userId, participants),
        inArray(masteryEvents.questionId, ids),
        inArray(masteryEvents.sourceType, ANSWER_SOURCES),
        inArray(masteryEvents.answerState, CORRECT_STATES),
        isNull(questions.deletedAt),
        notBlocked(),
      )),
    db.select({
      id: feedItems.id,
      questionId: feedItems.questionId,
      recipientUserId: feedItems.recipientUserId,
      sourceUserId: feedItems.sourceUserId,
      sourceType: feedItems.sourceType,
      sourceResult: feedItems.sourceResult,
      sourceEventAt: feedItems.sourceEventAt,
    }).from(feedItems).where(and(
      inArray(feedItems.questionId, ids),
      inArray(feedItems.recipientUserId, participants),
    )),
    getViewerHiddenQuestionIds(userId, ids),
  ])
  const visibleAnswers = applyTierGate('convergence', answers,
    (row) => row.trustTier as TrustTier, FRIEND_FACING_TIERS).rows
    .filter((answer) => !hidden.has(answer.questionId))
  return deriveSharedAnswerActivity(userId, friends, visibleAnswers, feed, since)
}
