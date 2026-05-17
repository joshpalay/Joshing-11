import { and, eq, sql } from 'drizzle-orm';

import { db, masteryEvents, playerMastery } from '@/server/db';
import { effectiveTier } from '@/server/mastery/tiers';
import type { AnswerState, MasteryTier } from '@/types/db';
import { normalizeBroadCategory } from '@/lib/knowledge/broad-category';

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
  broadCategory: string | null;
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

async function writeTierCrossingActivityForFriends(params: {
  userId: string;
  domain: string;
  previousTier: MasteryTier;
  newTier: MasteryTier;
}) {
  void params;
  // TODO Phase 8: write friend_mastery activity for each friend when
  // friend system is built. Friends list: getFriends(userId).
}

export async function writeMasteryEvent(params: WriteMasteryEventParams): Promise<MasteryEventWriteResult> {
  const [existingMastery, authorCredit] = await Promise.all([
    db
      .select({
        broadCategory: playerMastery.broadCategory,
        totalPoints: playerMastery.totalPoints,
        tier: playerMastery.tier,
        tierReachedAt: playerMastery.tierReachedAt,
      })
      .from(playerMastery)
      .where(and(
        eq(playerMastery.userId, params.userId),
        eq(playerMastery.canonicalSubcategory, params.domain),
      ))
      .limit(1),
    readAuthorCredit(params.userId, params.domain),
  ]);

  const existing = existingMastery[0];
  const broadCategory = normalizeBroadCategory(params.broadCategory ?? existing?.broadCategory);
  const previousTier: MasteryTier = existing?.tier ?? 'establishing';
  const nextTotalPoints = (existing?.totalPoints ?? 0) + params.pointsAwarded;
  const nextTier = params.pointsAwarded > 0
    ? effectiveTier(nextTotalPoints, authorCredit.points, authorCredit.distinctQuestions)
    : previousTier;
  const tierChanged = previousTier !== nextTier;

  await db.transaction(async (tx) => {
    await tx.execute(sql`
      insert into "MASTERY_EVENTS" (
        "user_id",
        "canonical_subcategory",
        "source_type",
        "question_id",
        "answered_by_user_id",
        "answer_id",
        "base_points",
        "weight",
        "awarded_points",
        "answer_state",
        "session_context"
      ) values (
        ${params.userId},
        ${params.domain},
        ${
          params.sourceType === 'author_credit' || params.sourceType === 'curator_credit'
            ? params.sourceType
            : params.sourceType === 'catchup'
              ? 'catchup_correct'
              : 'live_correct'
        },
        ${params.eventQuestionId ?? null},
        ${params.answeredByUserId ?? params.userId},
        ${`${params.sourceType}:${params.sourceId}:${params.questionId}:${params.answeredByUserId ?? params.userId}`},
        ${Math.round(params.basePoints ?? params.pointsAwarded)},
        ${params.weight ?? (params.pointsAwarded > 0 ? 1 : 0)},
        ${params.pointsAwarded},
        ${params.sourceType === 'author_credit' || params.sourceType === 'curator_credit' ? null : (params.answerState ?? null)},
        ${params.sourceType}
      )
    `);

    if (params.pointsAwarded > 0) {
      await tx
        .insert(playerMastery)
        .values({
          userId: params.userId,
          canonicalSubcategory: params.domain,
          broadCategory,
          totalPoints: params.pointsAwarded,
          tier: nextTier,
          tierReachedAt: tierChanged ? new Date() : null,
          seasonPointsStart: 0,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [playerMastery.userId, playerMastery.canonicalSubcategory],
          set: {
            broadCategory,
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
    broadCategory: broadCategory ?? null,
    points: params.pointsAwarded,
    previousTier,
    newTier: nextTier,
    tierChanged,
  };
}
