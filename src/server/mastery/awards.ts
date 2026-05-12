/**
 * @deprecated Not in use in v11.0.
 *
 * This file is preserved as a reference for porting v10.25 logic to
 * Drizzle when needed. It should NOT be imported by active code.
 * If you find yourself wanting to call from this file, port the
 * function to a Drizzle-native implementation in src/server/ first.
 */

import { invalidateMultitudesCacheForUser } from '@/server/profile/multitudes';
import type { AnswerState, DifficultyEstimate, MasteryTier } from '@/types/db';
import { effectiveTier, TIER_THRESHOLD_POINTS } from '@/server/mastery/tiers';

// TODO R2: replace Prisma transaction/client shapes with Drizzle equivalents.
type DbClient = any;
type TransactionClient = any;
type LegacyDifficultyEstimate = DifficultyEstimate | 'accessible' | 'moderate' | 'specialist';
type MasterySourceType = 'live_correct' | 'authored' | 'author_credit' | 'catchup_correct';
type PrismaKnownRequestError = Error & { code?: string };
type AwardableAnswerState = 'first_correct' | 'first_correct_after_wrong';

/** Portrait / declared-proven weighting — not the §8.32 mastery point table. */
const PORTRAIT_DIFFICULTY_WEIGHT = {
  accessible: 1,
  moderate: 2,
  specialist: 3,
} as Record<LegacyDifficultyEstimate, number>;

export function getDifficultyPoints(difficulty: LegacyDifficultyEstimate): number {
  return PORTRAIT_DIFFICULTY_WEIGHT[difficulty];
}

/** PRD §8.32 — answering points from difficulty + answer_state (live-equivalent base before session weight). */
export function getBasePoints(
  difficulty: LegacyDifficultyEstimate | null,
  answerState: AnswerState
): number {
  if (answerState === 'repeat_correct' || answerState === 'incorrect') return 0;
  const d = difficulty ?? 'moderate';
  const table = {
    specialist: { first_correct: 100, first_correct_after_wrong: 25 },
    moderate: { first_correct: 50, first_correct_after_wrong: 13 },
    accessible: { first_correct: 10, first_correct_after_wrong: 3 },
  } as Record<LegacyDifficultyEstimate, Record<AwardableAnswerState, number>>;
  return table[d][answerState as AwardableAnswerState];
}

/** PRD §8.32 — creator earnings from empirical correct rate on the question. */
export function creatorEarningsFromEmpiricalRate(correctCount: number, askedCount: number): number {
  if (askedCount <= 0) return 50;
  const rate = correctCount / askedCount;
  if (rate > 0.7) return 25;
  if (rate >= 0.4) return 50;
  return 100;
}

type CreatorMasteryWindowConfig = {
  basePoints: number;
  fullCreditWindow: number;
  reducedCreditWindow: number;
};

function creatorMasteryWindowFromEmpiricalRate(
  correctCount: number,
  askedCount: number
): CreatorMasteryWindowConfig {
  if (askedCount <= 0) {
    return { basePoints: 50, fullCreditWindow: 3, reducedCreditWindow: 3 };
  }
  const rate = correctCount / askedCount;
  if (rate > 0.7) {
    return { basePoints: 25, fullCreditWindow: 2, reducedCreditWindow: 2 };
  }
  if (rate >= 0.4) {
    return { basePoints: 50, fullCreditWindow: 3, reducedCreditWindow: 3 };
  }
  return { basePoints: 100, fullCreditWindow: 5, reducedCreditWindow: 5 };
}

export function creatorMasteryAwardForNthCorrect(
  correctCount: number,
  askedCount: number,
  countedCorrectOrdinal: number
): { basePoints: number; weight: number; awardedPoints: number } {
  const { basePoints, fullCreditWindow, reducedCreditWindow } = creatorMasteryWindowFromEmpiricalRate(
    correctCount,
    askedCount
  );
  const maxCountedCorrectAnswers = fullCreditWindow + reducedCreditWindow;
  if (countedCorrectOrdinal > maxCountedCorrectAnswers) {
    return { basePoints, weight: 0, awardedPoints: 0 };
  }
  const weight = countedCorrectOrdinal <= fullCreditWindow ? 1 : 0.5;
  return {
    basePoints,
    weight,
    awardedPoints: Math.round(basePoints * weight),
  };
}

export type AwardMasteryPointsResult = {
  awarded: boolean;
  tier_crossed: boolean;
  new_tier: MasteryTier | null;
};

type AwardMasteryPointsInput = {
  userId: string;
  questionId: string;
  sourceType: MasterySourceType;
  answeredByUserId?: string;
  answerId?: string;
  /** Required when source awards answering credit (live or catch-up). */
  answerState?: AnswerState;
  /**
   * Optional tag written to MasteryEvent.session_context. Group-game writes
   * omit this (stays null). B9 personal-daily writes pass 'personal_daily'
   * so that mastery events can be distinguished without touching the
   * MasterySourceType enum.
   */
  sessionContext?: string | null;
};

async function applyMasteryAward(
  tx: TransactionClient,
  input: AwardMasteryPointsInput
): Promise<AwardMasteryPointsResult> {
  const question = await tx.question.findUnique({
    where: { id: input.questionId },
    select: {
      canonical_subcategory: true,
      broad_category: true,
      calibrated_difficulty: true,
      llm_difficulty: true,
      // NOTE: Question.correct_count / asked_count are best-effort caches.
      // Author-credit rewards must use live Answer aggregates in-transaction.
      correct_count: true,
      asked_count: true,
    },
  });

  if (!question?.canonical_subcategory) {
    return { awarded: false, tier_crossed: false, new_tier: null };
  }

  const difficulty = question.calibrated_difficulty ?? question.llm_difficulty ?? null;

  // PRD §8.31: minimum 3 questions in the subcategory corpus before mastery progress is tracked.
  const MASTERY_MIN_CORPUS = 3;
  const corpusCount = await tx.question.count({
    where: { canonical_subcategory: question.canonical_subcategory, deleted_at: null },
  });
  if (corpusCount < MASTERY_MIN_CORPUS) {
    return { awarded: false, tier_crossed: false, new_tier: null };
  }

  let basePoints = 0;
  let weight = 1;
  let answerStateForRow: AnswerState | null = null;
  let answerIdForRow: string | undefined;

  if (input.sourceType === 'live_correct' || input.sourceType === 'catchup_correct') {
    if (input.answerState === undefined) {
      throw new Error(`awardMasteryPoints: ${input.sourceType} requires answerState`);
    }
    answerStateForRow = input.answerState;
    answerIdForRow = input.answerId;
    basePoints = getBasePoints(difficulty, input.answerState);
    weight = input.sourceType === 'catchup_correct' ? 0.25 : 1;
  } else if (input.sourceType === 'author_credit') {
    await tx.$queryRaw`SELECT id FROM "Question" WHERE id = ${input.questionId} FOR UPDATE`;
    const [askedCount, correctCount] = await Promise.all([
      tx.answer.count({
        where: {
          question_id: input.questionId,
          catch_up: false,
        },
      }),
      tx.answer.count({
        where: {
          question_id: input.questionId,
          catch_up: false,
          result: 'correct',
        },
      }),
    ]);
    const existingCountedCorrect = await tx.masteryEvent.count({
      where: {
        user_id: input.userId,
        question_id: input.questionId,
        source_type: 'author_credit',
      },
    });
    const creatorAward = creatorMasteryAwardForNthCorrect(
      correctCount,
      askedCount,
      existingCountedCorrect + 1
    );
    basePoints = creatorAward.basePoints;
    weight = creatorAward.weight;
    answerStateForRow = null;
  } else if (input.sourceType === 'authored') {
    basePoints = getBasePoints(difficulty, 'first_correct');
    weight = 1;
    answerStateForRow = null;
  } else {
    return { awarded: false, tier_crossed: false, new_tier: null };
  }

  const awardedPoints = Math.round(basePoints * weight);

  if (awardedPoints <= 0) {
    return { awarded: false, tier_crossed: false, new_tier: null };
  }

  await tx.masteryEvent.create({
    data: {
      user_id: input.userId,
      question_id: input.questionId,
      canonical_subcategory: question.canonical_subcategory,
      source_type: input.sourceType,
      answered_by_user_id: input.answeredByUserId,
      answer_id: answerIdForRow,
      base_points: basePoints,
      weight,
      awarded_points: awardedPoints,
      answer_state: answerStateForRow,
      session_context: input.sessionContext ?? null,
    },
  });

  const existingMastery = await tx.playerMastery.findUnique({
    where: {
      user_id_canonical_subcategory: {
        user_id: input.userId,
        canonical_subcategory: question.canonical_subcategory,
      },
    },
    select: {
      total_points: true,
      tier: true,
    },
  });

  const authorCreditWhere = {
    user_id: input.userId,
    canonical_subcategory: question.canonical_subcategory,
    source_type: 'author_credit' as const,
  };
  const [authorCreditAgg, authorCreditDistinctQuestionGroups] = await Promise.all([
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
  const authorCreditDistinctQuestionCount = authorCreditDistinctQuestionGroups.length;

  const previousTier = existingMastery?.tier ?? 'establishing';
  const nextPoints = (existingMastery?.total_points ?? 0) + awardedPoints;
  const upgradedTier = effectiveTier(nextPoints, authorCreditInDomain, authorCreditDistinctQuestionCount);
  const tierCrossed = upgradedTier !== previousTier;
  if (
    nextPoints >= TIER_THRESHOLD_POINTS.mastery &&
    upgradedTier === 'solid' &&
    authorCreditInDomain / nextPoints < 0.2
  ) {
    console.info('[mastery] mastery blocked — creator pct:', authorCreditInDomain / nextPoints);
  }
  const now = new Date();

  await tx.playerMastery.upsert({
    where: {
      user_id_canonical_subcategory: {
        user_id: input.userId,
        canonical_subcategory: question.canonical_subcategory,
      },
    },
    update: {
      total_points: { increment: awardedPoints },
      broad_category: question.broad_category,
      tier: upgradedTier,
      updated_at: now,
      ...(tierCrossed && {
        tier_reached_at: now,
      }),
    },
    create: {
      user_id: input.userId,
      canonical_subcategory: question.canonical_subcategory,
      broad_category: question.broad_category,
      total_points: awardedPoints,
      tier: upgradedTier,
      tier_reached_at: tierCrossed ? now : null,
      updated_at: now,
    },
  });

  invalidateMultitudesCacheForUser(input.userId);

  return {
    awarded: true,
    tier_crossed: tierCrossed,
    new_tier: tierCrossed ? upgradedTier : null,
  };
}

export async function awardMasteryPoints(
  db: DbClient,
  input: AwardMasteryPointsInput
): Promise<AwardMasteryPointsResult> {
  if ('$transaction' in db) {
    return db.$transaction((tx: TransactionClient) => applyMasteryAward(tx, input));
  }

  return applyMasteryAward(db, input);
}

export async function awardAuthoredMasteryIfMissing(db: DbClient, input: { userId: string; questionId: string }) {
  const existingEvent = await db.masteryEvent.findFirst({
    where: {
      user_id: input.userId,
      question_id: input.questionId,
      source_type: 'authored',
    },
    select: { id: true },
  });

  if (existingEvent) {
    return { awarded: false };
  }

  const result = await awardMasteryPoints(db, {
    userId: input.userId,
    questionId: input.questionId,
    sourceType: 'authored',
  });

  return {
    awarded: result.awarded,
  };
}

type AwardAuthorCreditInput = {
  questionId: string;
  questionAuthorId: string;
  answeredByUserId: string;
  answerResult: 'correct' | 'wrong' | 'expired';
  isCatchUp: boolean;
  difficulty: LegacyDifficultyEstimate | null;
};

export async function awardAuthorCreditIfEligible(db: DbClient, input: AwardAuthorCreditInput) {
  if (input.answerResult !== 'correct') return { awarded: false, reason: 'not_correct' as const };
  if (input.isCatchUp) return { awarded: false, reason: 'catch_up' as const };
  if (input.questionAuthorId === input.answeredByUserId) return { awarded: false, reason: 'self_answer' as const };

  const existing = await db.masteryEvent.findFirst({
    where: {
      source_type: 'author_credit',
      question_id: input.questionId,
      answered_by_user_id: input.answeredByUserId,
    },
    select: { id: true },
  });

  if (existing) return { awarded: false, reason: 'duplicate' as const };

  try {
    const result = await awardMasteryPoints(db, {
      userId: input.questionAuthorId,
      questionId: input.questionId,
      sourceType: 'author_credit',
      answeredByUserId: input.answeredByUserId,
    });
    return { awarded: result.awarded, reason: result.awarded ? ('awarded' as const) : ('not_awarded' as const) };
  } catch (error) {
    if (
      error instanceof Error
      && (error as PrismaKnownRequestError).code === 'P2002'
    ) {
      return { awarded: false, reason: 'duplicate' as const };
    }
    throw error;
  }
}
