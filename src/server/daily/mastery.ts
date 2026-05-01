/**
 * B9 — Personal Daily mastery writes.
 *
 * Two entry points:
 *
 *   awardPersonalDailyFriendMastery()
 *     Routes through the existing `awardMasteryPoints` (live_correct path) so
 *     tier progression, corpus gate, and cache invalidation are shared with
 *     group-game writes. Adds session_context = 'personal_daily'. Answered_by
 *     is set to the player's own id to tighten DB-level dedup within the
 *     personal-daily context.
 *
 *   awardPersonalDailyBotMastery()
 *     Bot-generated questions have no canonical Question row, so we write the
 *     MasteryEvent directly (question_id = null) and upsert PlayerMastery
 *     ourselves, reusing `effectiveTier` so the tier logic is not duplicated.
 *
 * Both functions return a `MasteryDelta` describing a tier crossing this
 * session, if any, so the answer endpoint can surface it to the UI.
 */

import type { Prisma, MasteryTier } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { awardMasteryPoints } from '@/server/mastery/awards';
import { effectiveTier } from '@/server/mastery/tiers';
import { invalidateMultitudesCacheForUser } from '@/server/profile/multitudes';
import { PERSONAL_DAILY_SESSION_CONTEXT } from './types';

type TransactionClient = Prisma.TransactionClient;

export type MasteryDelta = {
  domain: string;
  new_tier: MasteryTier;
};

export type PersonalDailyAwardResult = {
  awarded: boolean;
  awarded_points: number;
  mastery_delta: MasteryDelta | null;
};

/**
 * Check whether the user has already earned live (non-repeat) mastery credit
 * for this canonical question — through a group game or a prior personal
 * daily. Used to gate the personal-daily friend path at repeat_correct.
 */
export async function userHasLiveCorrectFor(
  db: TransactionClient | typeof prisma,
  userId: string,
  questionId: string
): Promise<boolean> {
  const existing = await db.masteryEvent.findFirst({
    where: {
      user_id: userId,
      question_id: questionId,
      source_type: 'live_correct',
    },
    select: { id: true },
  });
  return !!existing;
}

export async function awardPersonalDailyFriendMastery(input: {
  userId: string;
  questionId: string;
  canonicalSubcategory: string;
}): Promise<PersonalDailyAwardResult> {
  // Pre-check spans group + personal daily — a user who already got this
  // right in any live context should not earn duplicate credit here.
  const alreadyCorrect = await userHasLiveCorrectFor(prisma, input.userId, input.questionId);
  if (alreadyCorrect) {
    return { awarded: false, awarded_points: 0, mastery_delta: null };
  }

  const tierBefore = await readTier(input.userId, input.canonicalSubcategory);

  const result = await awardMasteryPoints(prisma, {
    userId: input.userId,
    questionId: input.questionId,
    sourceType: 'live_correct',
    answerState: 'first_correct',
    answeredByUserId: input.userId,
    sessionContext: PERSONAL_DAILY_SESSION_CONTEXT,
  });

  if (!result.awarded) {
    return { awarded: false, awarded_points: 0, mastery_delta: null };
  }

  const awardedPoints = await readLatestAwardedPoints({
    userId: input.userId,
    questionId: input.questionId,
    sourceType: 'live_correct',
    sessionContext: PERSONAL_DAILY_SESSION_CONTEXT,
  });

  const masteryDelta: MasteryDelta | null =
    result.tier_crossed && result.new_tier
      ? { domain: input.canonicalSubcategory, new_tier: result.new_tier }
      : null;

  // tierBefore is informational — tier_crossed is already computed inside
  // awardMasteryPoints against the same PlayerMastery row.
  void tierBefore;

  return {
    awarded: true,
    awarded_points: awardedPoints,
    mastery_delta: masteryDelta,
  };
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

  const result = await prisma.$transaction(async (tx) => {
    await tx.masteryEvent.create({
      data: {
        user_id: input.userId,
        question_id: null,
        canonical_subcategory: input.canonicalSubcategory,
        source_type: 'live_correct',
        answered_by_user_id: input.userId,
        base_points: input.basePoints,
        weight: input.weight,
        awarded_points: awardedPoints,
        answer_state: null,
        session_context: PERSONAL_DAILY_SESSION_CONTEXT,
      },
    });

    const existingMastery = await tx.playerMastery.findUnique({
      where: {
        user_id_canonical_subcategory: {
          user_id: input.userId,
          canonical_subcategory: input.canonicalSubcategory,
        },
      },
      select: { total_points: true, tier: true },
    });

    const authorCreditWhere = {
      user_id: input.userId,
      canonical_subcategory: input.canonicalSubcategory,
      source_type: 'author_credit' as const,
    };
    const [authorCreditAgg, authorCreditDistinct] = await Promise.all([
      tx.masteryEvent.aggregate({
        where: authorCreditWhere,
        _sum: { awarded_points: true },
      }),
      tx.masteryEvent.groupBy({
        by: ['question_id'],
        where: authorCreditWhere,
      }),
    ]);
    const authorCreditInDomain = authorCreditAgg._sum.awarded_points ?? 0;
    const authorCreditDistinctQuestionCount = authorCreditDistinct.length;

    const previousTier: MasteryTier = existingMastery?.tier ?? 'establishing';
    const nextPoints = (existingMastery?.total_points ?? 0) + awardedPoints;
    const nextTier = effectiveTier(
      nextPoints,
      authorCreditInDomain,
      authorCreditDistinctQuestionCount
    );
    const tierCrossed = nextTier !== previousTier;
    const now = new Date();

    await tx.playerMastery.upsert({
      where: {
        user_id_canonical_subcategory: {
          user_id: input.userId,
          canonical_subcategory: input.canonicalSubcategory,
        },
      },
      update: {
        total_points: { increment: awardedPoints },
        broad_category: input.broadCategory,
        tier: nextTier,
        updated_at: now,
        ...(tierCrossed && { tier_reached_at: now }),
      },
      create: {
        user_id: input.userId,
        canonical_subcategory: input.canonicalSubcategory,
        broad_category: input.broadCategory,
        total_points: awardedPoints,
        tier: nextTier,
        tier_reached_at: tierCrossed ? now : null,
        updated_at: now,
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

async function readTier(
  userId: string,
  canonicalSubcategory: string
): Promise<MasteryTier> {
  const row = await prisma.playerMastery.findUnique({
    where: {
      user_id_canonical_subcategory: { user_id: userId, canonical_subcategory: canonicalSubcategory },
    },
    select: { tier: true },
  });
  return row?.tier ?? 'establishing';
}

async function readLatestAwardedPoints(args: {
  userId: string;
  questionId: string;
  sourceType: 'live_correct';
  sessionContext: string;
}): Promise<number> {
  const row = await prisma.masteryEvent.findFirst({
    where: {
      user_id: args.userId,
      question_id: args.questionId,
      source_type: args.sourceType,
      session_context: args.sessionContext,
    },
    orderBy: { created_at: 'desc' },
    select: { awarded_points: true },
  });
  return row ? Math.round(row.awarded_points) : 0;
}
