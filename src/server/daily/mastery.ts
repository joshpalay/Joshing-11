/**
 * B9 - Personal Daily mastery writes.
 */

import { and, countDistinct, desc, eq, sql } from 'drizzle-orm';

import { db } from '@/server/db';
import { masteryEvents, playerMastery } from '@/server/db/schema';
import { effectiveTier } from '@/server/mastery/tiers';
import { invalidateMultitudesCacheForUser } from '@/server/profile/multitudes';
import type { MasteryTier } from '@/types/db';
import { PERSONAL_DAILY_SESSION_CONTEXT } from './types';

type TransactionClient = typeof db;

export type MasteryDelta = {
  domain: string;
  new_tier: MasteryTier;
};

export type PersonalDailyAwardResult = {
  awarded: boolean;
  awarded_points: number;
  mastery_delta: MasteryDelta | null;
};

export async function userHasLiveCorrectFor(
  tx: TransactionClient,
  userId: string,
  questionId: string,
): Promise<boolean> {
  const [existing] = await tx
    .select({ id: masteryEvents.id })
    .from(masteryEvents)
    .where(
      and(
        eq(masteryEvents.userId, userId),
        eq(masteryEvents.questionId, questionId),
        eq(masteryEvents.sourceType, 'live_correct'),
      ),
    )
    .limit(1);

  return !!existing;
}

export async function awardPersonalDailyFriendMastery(input: {
  userId: string;
  questionId: string;
  canonicalSubcategory: string;
}): Promise<PersonalDailyAwardResult> {
  // TODO R2: complex mastery query — needs full Drizzle rewrite
  void input;
  return { awarded: false, awarded_points: 0, mastery_delta: null };
}

export async function awardPersonalDailyBotMastery(input: {
  userId: string;
  canonicalSubcategory: string;
  broadCategory: string;
  basePoints: number;
  weight: number;
}): Promise<PersonalDailyAwardResult> {
  const awardedPoints = Math.round(input.basePoints * input.weight);
  if (awardedPoints <= 0) {
    return { awarded: false, awarded_points: 0, mastery_delta: null };
  }

  const result = await db.transaction(async (tx) => {
    await tx.insert(masteryEvents).values({
      userId: input.userId,
      questionId: null,
      canonicalSubcategory: input.canonicalSubcategory,
      sourceType: 'live_correct',
      answeredByUserId: input.userId,
      basePoints: input.basePoints,
      weight: input.weight,
      awardedPoints,
      answerState: null,
      sessionContext: PERSONAL_DAILY_SESSION_CONTEXT,
    });

    const [existingMastery] = await tx
      .select({ totalPoints: playerMastery.totalPoints, tier: playerMastery.tier })
      .from(playerMastery)
      .where(
        and(
          eq(playerMastery.userId, input.userId),
          eq(playerMastery.canonicalSubcategory, input.canonicalSubcategory),
        ),
      )
      .limit(1);

    const [authorCredit] = await tx
      .select({
        awardedPoints: sql<number>`coalesce(sum(${masteryEvents.awardedPoints}), 0)`,
        distinctQuestionCount: countDistinct(masteryEvents.questionId),
      })
      .from(masteryEvents)
      .where(
        and(
          eq(masteryEvents.userId, input.userId),
          eq(masteryEvents.canonicalSubcategory, input.canonicalSubcategory),
          eq(masteryEvents.sourceType, 'author_credit'),
        ),
      );

    const authorCreditInDomain = Number(authorCredit?.awardedPoints ?? 0);
    const authorCreditDistinctQuestionCount = authorCredit?.distinctQuestionCount ?? 0;
    const previousTier: MasteryTier = existingMastery?.tier ?? 'establishing';
    const nextPoints = (existingMastery?.totalPoints ?? 0) + awardedPoints;
    const nextTier = effectiveTier(
      nextPoints,
      authorCreditInDomain,
      authorCreditDistinctQuestionCount,
    );
    const tierCrossed = nextTier !== previousTier;
    const now = new Date();

    await tx
      .insert(playerMastery)
      .values({
        userId: input.userId,
        canonicalSubcategory: input.canonicalSubcategory,
        broadCategory: input.broadCategory,
        totalPoints: awardedPoints,
        tier: nextTier,
        tierReachedAt: tierCrossed ? now : null,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [playerMastery.userId, playerMastery.canonicalSubcategory],
        set: {
          totalPoints: sql`${playerMastery.totalPoints} + ${awardedPoints}`,
          broadCategory: input.broadCategory,
          tier: nextTier,
          updatedAt: now,
          ...(tierCrossed && { tierReachedAt: now }),
        },
      });

    return { tierCrossed, nextTier };
  });

  invalidateMultitudesCacheForUser(input.userId);

  return {
    awarded: true,
    awarded_points: awardedPoints,
    mastery_delta: result.tierCrossed
      ? { domain: input.canonicalSubcategory, new_tier: result.nextTier }
      : null,
  };
}

async function readTier(userId: string, canonicalSubcategory: string): Promise<MasteryTier> {
  const [row] = await db
    .select({ tier: playerMastery.tier })
    .from(playerMastery)
    .where(
      and(
        eq(playerMastery.userId, userId),
        eq(playerMastery.canonicalSubcategory, canonicalSubcategory),
      ),
    )
    .limit(1);
  return row?.tier ?? 'establishing';
}

async function readLatestAwardedPoints(args: {
  userId: string;
  questionId: string;
  sourceType: 'live_correct';
  sessionContext: string;
}): Promise<number> {
  const [row] = await db
    .select({ awardedPoints: masteryEvents.awardedPoints })
    .from(masteryEvents)
    .where(
      and(
        eq(masteryEvents.userId, args.userId),
        eq(masteryEvents.questionId, args.questionId),
        eq(masteryEvents.sourceType, args.sourceType),
        eq(masteryEvents.sessionContext, args.sessionContext),
      ),
    )
    .orderBy(desc(masteryEvents.createdAt))
    .limit(1);
  return row ? Math.round(row.awardedPoints) : 0;
}

void readTier;
void readLatestAwardedPoints;
