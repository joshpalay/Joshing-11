import { and, eq, sql } from 'drizzle-orm';

import { db, masteryEvents, playerMastery } from '@/server/db';
import { effectiveTier } from '@/server/mastery/tiers';
import type { AnswerState, MasteryTier } from '@/types/db';

type MasteryEventSourceType = 'daily' | 'feed' | 'joshing_game' | 'catchup' | 'author_credit' | 'curator_credit';

export type WriteMasteryEventParams = {
  userId: string;
  questionId: string;
  domain: string;
  answerState?: AnswerState;
  pointsAwarded: number;
  sourceType: MasteryEventSourceType;
  sourceId: string;
  broadCategory?: string | null;
  eventQuestionId?: string | null;
  basePoints?: number;
  weight?: number;
  answeredByUserId?: string | null;
};

export type MasteryEventWriteResult = {
  domain: string;
  points: number;
  previousTier: MasteryTier;
  newTier: MasteryTier;
  tierChanged: boolean;
};

async function readAuthorCredit(userId: string, domain: string) {
  const [row] = await db
    .select({
      points: sql<number>`coalesce(sum(${masteryEvents.awardedPoints}), 0)`,
      distinctQuestions: sql<number>`count(distinct ${masteryEvents.questionId})`,
    })
    .from(masteryEvents)
    .where(and(
      eq(masteryEvents.userId, userId),
      eq(masteryEvents.canonicalSubcategory, domain),
      eq(masteryEvents.sourceType, 'author_credit'),
    ));

  return {
    points: Number(row?.points ?? 0),
    distinctQuestions: Number(row?.distinctQuestions ?? 0),
  };
}

async function writeTierCrossingActivityForFriends(_params: {
  userId: string;
  domain: string;
  previousTier: MasteryTier;
  newTier: MasteryTier;
}) {
  // TODO Phase 8: write friend_mastery activity for each friend when
  // friend system is built. Friends list: getFriends(userId).
}

export async function writeMasteryEvent(params: WriteMasteryEventParams): Promise<MasteryEventWriteResult> {
  const [existingMastery, authorCredit] = await Promise.all([
    db
      .select()
      .from(playerMastery)
      .where(and(
        eq(playerMastery.userId, params.userId),
        eq(playerMastery.canonicalSubcategory, params.domain),
      ))
      .limit(1),
    readAuthorCredit(params.userId, params.domain),
  ]);

  const existing = existingMastery[0];
  const previousTier: MasteryTier = existing?.tier ?? 'establishing';
  const nextTotalPoints = (existing?.totalPoints ?? 0) + params.pointsAwarded;
  const nextTier = params.pointsAwarded > 0
    ? effectiveTier(nextTotalPoints, authorCredit.points, authorCredit.distinctQuestions)
    : previousTier;
  const tierChanged = previousTier !== nextTier;

  await db.transaction(async (tx) => {
    await tx.insert(masteryEvents).values({
      userId: params.userId,
      canonicalSubcategory: params.domain,
      sourceType:
        params.sourceType === 'author_credit' || params.sourceType === 'curator_credit'
          ? params.sourceType
          : params.sourceType === 'catchup'
            ? 'catchup_correct'
            : 'live_correct',
      questionId: params.eventQuestionId ?? null,
      answeredByUserId: params.answeredByUserId ?? params.userId,
      answerId: `${params.sourceType}:${params.sourceId}:${params.questionId}:${params.answeredByUserId ?? params.userId}`,
      basePoints: Math.round(params.basePoints ?? params.pointsAwarded),
      weight: params.weight ?? (params.pointsAwarded > 0 ? 1 : 0),
      awardedPoints: params.pointsAwarded,
      answerState: params.sourceType === 'author_credit' || params.sourceType === 'curator_credit' ? null : params.answerState,
      sessionContext: params.sourceType,
    });

    if (params.pointsAwarded > 0) {
      await tx
        .insert(playerMastery)
        .values({
          userId: params.userId,
          canonicalSubcategory: params.domain,
          broadCategory: params.broadCategory ?? existing?.broadCategory ?? null,
          totalPoints: params.pointsAwarded,
          tier: nextTier,
          tierReachedAt: tierChanged ? new Date() : null,
          seasonPointsStart: 0,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [playerMastery.userId, playerMastery.canonicalSubcategory],
          set: {
            broadCategory: params.broadCategory ?? existing?.broadCategory ?? null,
            totalPoints: nextTotalPoints,
            tier: nextTier,
            tierReachedAt: tierChanged ? new Date() : existing?.tierReachedAt ?? null,
            updatedAt: new Date(),
          },
        });
    }
  });

  if (tierChanged) {
    await writeTierCrossingActivityForFriends({
      userId: params.userId,
      domain: params.domain,
      previousTier,
      newTier: nextTier,
    });
  }

  return {
    domain: params.domain,
    points: params.pointsAwarded,
    previousTier,
    newTier: nextTier,
    tierChanged,
  };
}
