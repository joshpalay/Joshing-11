import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lte, sql } from 'drizzle-orm';

import {
  dailyPreferences,
  dailyQueues,
  db,
  declaredInterests,
  feedItems,
  generatedQuestions,
  masteryEvents,
  playerMastery,
  questions as canonicalQuestions,
  userDomainExclusions,
} from '@/server/db';
import { getDailyAssignmentBounds } from '@/lib/games/timezone';
import { getActiveDeclaredInterests } from '@/server/db/queries/declared-interests';
import { pgErrorCode } from '@/server/db/pg-error';
import { CATEGORIES, categoryLabel } from '@/lib/questions-types';
import { CATCHUP_LOOKBACK_DAYS, asQueueSlots, dailyQueueItemId, feedCatchupItemId } from '@/server/daily/catchup';
import type { QueueSlot } from '@/server/daily/types';
import {
  catchUpExpiresAt,
  expiresWithin24Hours,
  isCatchUpQueueDateEligible,
  isCatchUpSlotEligible,
  queueAgeInDays,
} from '@/server/play/catch-up-eligibility';
import {
  dedupeCatchUpItems,
  orderCatchUpItems,
} from '@/server/play/catch-up-turn-sequencing';
import { getBasePoints } from '@/server/mastery/scoring';
import { isGenericSubcategory } from '@/server/questions/canonical-subcategory';

function asQueueSlotDifficulty(
  value: string | null | undefined,
): 'accessible' | 'moderate' | 'specialist' | undefined {
  if (value === 'accessible' || value === 'moderate' || value === 'specialist') return value;
  return undefined;
}

export type KnowledgeBaseDomain = {
  domain: string;
  broadCategory: string | null;
  source: 'declared' | 'friend_mediated' | 'authorship';
  territoryType: 'declared' | 'demonstrated';
  totalPoints: number;
  tier: 'establishing' | 'familiar' | 'solid' | 'mastery';
};

export type DailyPreferenceRow = typeof dailyPreferences.$inferSelect;
export type DailyQueueRow = typeof dailyQueues.$inferSelect;

export type CatchupSurface = 'daily' | 'feed';

export type CatchupQueueItem = {
  /**
   * Opaque dispatch ID. Daily slots use `${queueId}:${slotIndex}` (legacy
   * format the client already parses); feed items use `feed:${feedItemId}`.
   * Routes that receive this back from the client should resolve it via
   * `parseCatchupItemId` rather than splitting manually.
   */
  dailyQueueItemId: string;
  surface: CatchupSurface;
  /** Daily-only — null for feed items. */
  queueId: string | null;
  /** Daily-only — null for feed items. */
  slotIndex: number | null;
  /** Feed-only — null for daily items. */
  feedItemId: string | null;
  queueDate: string;
  queueAge: number;
  expiresAt: string;
  expiresSoon: boolean;
  questionId: string;
  questionText: string;
  correctAnswer: string;
  alternateAnswers: string[];
  explanation: string | null;
  domain: string;
  domainDisplayName: string;
  broadCategory: string;
  basePoints: number;
  difficultyEstimate: 'accessible' | 'moderate' | 'specialist' | null;
  submittedAnswer: string | null;
  wasSkipped: boolean;
};

export type CatchupQuestion = CatchupQueueItem;

function normalizeDomain(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

type ScopedExclusions = {
  subcategories: Set<string>;
  broadCategories: Set<string>;
};

async function getExcludedKnowledgeDomains(userId: string): Promise<ScopedExclusions> {
  let rows: { domain: string; scope: 'subcategory' | 'broad_category' | 'category' }[];
  try {
    rows = await db
      .select({
        domain: userDomainExclusions.canonicalSubcategory,
        scope: userDomainExclusions.scope,
      })
      .from(userDomainExclusions)
      .where(eq(userDomainExclusions.userId, userId));
  } catch (error) {
    if (pgErrorCode(error) === '42P01') return { subcategories: new Set(), broadCategories: new Set() };
    // 42703 = scope column missing on a database where the additive migration
    // hasn't landed yet. Fall back to a scope='subcategory' read so the feature
    // degrades to its pre-migration behavior instead of failing.
    if (pgErrorCode(error) === '42703') {
      const legacy = await db
        .select({ domain: userDomainExclusions.canonicalSubcategory })
        .from(userDomainExclusions)
        .where(eq(userDomainExclusions.userId, userId));
      rows = legacy.map((row) => ({ domain: row.domain, scope: 'subcategory' as const }));
    } else {
      throw error;
    }
  }

  const subcategories = new Set<string>();
  const broadCategories = new Set<string>();
  const categoryEnums: string[] = [];

  for (const row of rows) {
    const value = normalizeDomain(row.domain);
    if (!value) continue;
    if (row.scope === 'subcategory') subcategories.add(value.toLowerCase());
    else if (row.scope === 'broad_category') broadCategories.add(value.toLowerCase());
    else if (row.scope === 'category') categoryEnums.push(value);
  }

  // Category-scope exclusions name a top-level Category enum value (e.g.
  // 'film_tv'). The knowledge base only carries subcategory + broadCategory,
  // so we map each excluded category to the set of broadCategory strings it
  // covers in the canonical Question table and merge those into the
  // broadCategories filter.
  if (categoryEnums.length > 0) {
    try {
      const knownCategories = categoryEnums.filter((value): value is typeof CATEGORIES[number] =>
        (CATEGORIES as readonly string[]).includes(value),
      );
      if (knownCategories.length > 0) {
        const expanded = await db
          .select({ broadCategory: canonicalQuestions.broadCategory })
          .from(canonicalQuestions)
          .where(inArray(canonicalQuestions.category, knownCategories));
        for (const row of expanded) {
          if (row.broadCategory) broadCategories.add(row.broadCategory.toLowerCase());
        }
      }
    } catch (error) {
      if (pgErrorCode(error) !== '42P01' && pgErrorCode(error) !== '42703') throw error;
    }
  }

  return { subcategories, broadCategories };
}

async function getPlayerMasteryKnowledgeRows(userId: string) {
  try {
    return await db
      .select({
        domain: playerMastery.canonicalSubcategory,
        broadCategory: playerMastery.broadCategory,
        territoryType: playerMastery.territoryType,
        totalPoints: playerMastery.totalPoints,
        tier: playerMastery.tier,
      })
      .from(playerMastery)
      .where(eq(playerMastery.userId, userId))
      .orderBy(asc(playerMastery.canonicalSubcategory));
  } catch (error) {
    if (pgErrorCode(error) !== '42703') throw error;

    const rows = await db
      .select({
        domain: playerMastery.canonicalSubcategory,
        broadCategory: playerMastery.broadCategory,
        totalPoints: playerMastery.totalPoints,
        tier: playerMastery.tier,
      })
      .from(playerMastery)
      .where(eq(playerMastery.userId, userId))
      .orderBy(asc(playerMastery.canonicalSubcategory));

    return rows.map((row) => ({ ...row, territoryType: 'demonstrated' as const }));
  }
}

export async function getKnowledgeBase(userId: string): Promise<KnowledgeBaseDomain[]> {
  const [masteryRows, declaredRows, excludedDomains] = await Promise.all([
    getPlayerMasteryKnowledgeRows(userId),
    getActiveDeclaredInterests(userId),
    getExcludedKnowledgeDomains(userId),
  ]);

  const isExcluded = (domain: string, broadCategory: string | null): boolean => {
    if (excludedDomains.subcategories.has(domain.toLowerCase())) return true;
    if (broadCategory && excludedDomains.broadCategories.has(broadCategory.toLowerCase())) return true;
    return false;
  };

  const domainsByKey = new Map<string, KnowledgeBaseDomain>();

  for (const row of masteryRows) {
    const domain = normalizeDomain(row.domain);
    if (!domain) continue;
    const key = domain.toLowerCase();
    if (isExcluded(domain, row.broadCategory)) continue;
    domainsByKey.set(key, {
      domain,
      broadCategory: row.broadCategory,
      source: row.territoryType === 'declared' ? 'declared' : 'friend_mediated',
      territoryType: row.territoryType,
      totalPoints: row.totalPoints,
      tier: row.tier,
    });
  }

  for (const row of declaredRows) {
    const domain = normalizeDomain(row.domain);
    if (!domain) continue;
    const key = domain.toLowerCase();
    if (isExcluded(domain, row.broadCategory)) continue;
    const existing = domainsByKey.get(key);
    domainsByKey.set(key, {
      domain: existing?.domain ?? domain,
      broadCategory: existing?.broadCategory ?? row.broadCategory,
      source: existing?.source ?? 'declared',
      territoryType: existing?.territoryType ?? row.territoryType,
      totalPoints: existing?.totalPoints ?? 0,
      tier: existing?.tier ?? 'establishing',
    });
  }

  return [...domainsByKey.values()].sort((a, b) => a.domain.localeCompare(b.domain));
}

export async function getTodaysDailyQueue(userId: string): Promise<DailyQueueRow | null> {
  const { assignmentDateStr } = getDailyAssignmentBounds();
  const [queue] = await db
    .select()
    .from(dailyQueues)
    .where(and(eq(dailyQueues.userId, userId), eq(dailyQueues.queueDate, assignmentDateStr)))
    .limit(1);

  return queue ?? null;
}

export async function getGeneratedQuestionsForQueue(queue: DailyQueueRow) {
  const generatedIds = asQueueSlots(queue.slots)
    .map((slot) => slot.generated_question_id)
    .filter((id): id is string => Boolean(id));

  if (generatedIds.length === 0) return [];

  return db
    .select()
    .from(generatedQuestions)
    .where(inArray(generatedQuestions.id, generatedIds));
}

export async function getCatchupQuestions(userId: string): Promise<CatchupQuestion[]> {
  const { assignmentDateStr } = getDailyAssignmentBounds();

  const [dailyItems, feedItemsForCatchup] = await Promise.all([
    getDailyCatchupItems(userId, assignmentDateStr),
    getFeedCatchupItems(userId, assignmentDateStr),
  ]);

  return dedupeCatchUpItems(orderCatchUpItems([...dailyItems, ...feedItemsForCatchup]));
}

async function getDailyCatchupItems(
  userId: string,
  assignmentDateStr: string,
): Promise<CatchupQuestion[]> {
  const queues = await db
    .select()
    .from(dailyQueues)
    .where(and(
      eq(dailyQueues.userId, userId),
      lte(dailyQueues.queueDate, assignmentDateStr),
    ))
    .orderBy(asc(dailyQueues.queueDate));

  const candidateSlots = queues.flatMap((queue) =>
    asQueueSlots(queue.slots)
      .filter((slot) => isCatchUpQueueDateEligible(String(queue.queueDate), assignmentDateStr) && isCatchUpSlotEligible(slot))
      .map((slot) => ({ queue, slot }))
  );

  const generatedIds = candidateSlots
    .map(({ slot }) => slot.generated_question_id)
    .filter((id): id is string => Boolean(id));

  if (generatedIds.length === 0) return [];

  const questions = await db
    .select()
    .from(generatedQuestions)
    .where(and(
      eq(generatedQuestions.userId, userId),
      inArray(generatedQuestions.id, generatedIds),
    ));
  const questionById = new Map(questions.map((question) => [question.id, question]));

  return candidateSlots
    .map(({ queue, slot }): CatchupQuestion | null => {
      const question = slot.generated_question_id ? questionById.get(slot.generated_question_id) : null;
      if (!question) return null;
      const queueDate = String(queue.queueDate);
      const expiresAt = catchUpExpiresAt(queueDate);
      const domain = slot.domain || question.canonicalSubcategory;
      // Suppress catchup items whose domain is a bucket-level label
      // ("general", "general knowledge", "trivia", etc.). These would
      // otherwise replay an earlier generation that slipped past the
      // upstream guard.
      if (isGenericSubcategory(domain)) return null;
      return {
        dailyQueueItemId: dailyQueueItemId(queue.id, slot.slot_index),
        surface: 'daily',
        queueId: queue.id,
        slotIndex: slot.slot_index,
        feedItemId: null,
        queueDate,
        queueAge: queueAgeInDays(queueDate, assignmentDateStr),
        expiresAt,
        expiresSoon: expiresWithin24Hours(expiresAt),
        questionId: question.id,
        questionText: slot.question_text || question.questionText,
        correctAnswer: question.answer,
        alternateAnswers: [] as string[],
        explanation: question.explainer,
        domain,
        domainDisplayName: categoryLabel(domain),
        broadCategory: question.broadCategory,
        basePoints: question.basePoints,
        difficultyEstimate: asQueueSlotDifficulty(question.difficultyEstimate) ?? null,
        submittedAnswer: slot.submitted_answer ?? null,
        wasSkipped: Boolean(slot.skipped),
      } satisfies CatchupQuestion;
    })
    .filter((question): question is CatchupQuestion => Boolean(question));
}

async function getFeedCatchupItems(
  userId: string,
  assignmentDateStr: string,
): Promise<CatchupQuestion[]> {
  // Mirror the daily lookback: only surface feed-missed items whose source
  // event landed within the catch-up window. sourceEventAt is the canonical
  // "when this hit your feed" timestamp and is already indexed.
  const oldestDate = new Date(`${assignmentDateStr}T00:00:00.000Z`);
  oldestDate.setUTCDate(oldestDate.getUTCDate() - CATCHUP_LOOKBACK_DAYS);

  let rows: Array<{ feedItem: typeof feedItems.$inferSelect; question: typeof canonicalQuestions.$inferSelect }>;
  try {
    rows = await db
      .select({ feedItem: feedItems, question: canonicalQuestions })
      .from(feedItems)
      .innerJoin(canonicalQuestions, eq(feedItems.questionId, canonicalQuestions.id))
      .where(and(
        eq(feedItems.recipientUserId, userId),
        eq(feedItems.state, 'answered'),
        eq(feedItems.answerResult, 'incorrect'),
        isNull(feedItems.catchupResolvedAt),
        gte(feedItems.sourceEventAt, oldestDate),
      ))
      .orderBy(desc(feedItems.sourceEventAt));
  } catch (error) {
    // catchupResolvedAt is added by migration 0038; tolerate a brief window
    // where the column is missing so the homepage doesn't 500 on first boot.
    if (pgErrorCode(error) === '42703') return [];
    throw error;
  }

  return rows
    .map(({ feedItem, question }): CatchupQuestion | null => {
      const domain = question.canonicalSubcategory || question.broadCategory || question.category;
      if (!domain || isGenericSubcategory(domain)) return null;
      const queueDate = feedItem.sourceEventAt.toISOString().slice(0, 10);
      const expiresAt = catchUpExpiresAt(queueDate);
      const difficulty = asQueueSlotDifficulty(
        question.calibratedDifficulty ?? question.llmDifficulty ?? question.difficultyEstimate ?? null,
      ) ?? null;
      const basePoints = getBasePoints(difficulty, 'first_correct');
      const explanation = question.explainerFullWrong
        ?? question.explainerFull
        ?? question.explainerBrief
        ?? question.factualExplanation
        ?? null;
      return {
        dailyQueueItemId: feedCatchupItemId(feedItem.id),
        surface: 'feed',
        queueId: null,
        slotIndex: null,
        feedItemId: feedItem.id,
        queueDate,
        queueAge: queueAgeInDays(queueDate, assignmentDateStr),
        expiresAt,
        expiresSoon: expiresWithin24Hours(expiresAt),
        questionId: question.id,
        questionText: question.questionText,
        correctAnswer: question.answerText,
        alternateAnswers: question.acceptedAlternatives ?? [],
        explanation,
        domain,
        domainDisplayName: categoryLabel(domain),
        broadCategory: question.broadCategory ?? domain,
        basePoints,
        difficultyEstimate: difficulty,
        submittedAnswer: feedItem.submittedAnswer ?? null,
        wasSkipped: false,
      } satisfies CatchupQuestion;
    })
    .filter((item): item is CatchupQuestion => Boolean(item));
}

export async function createDailyQueueItem(
  userId: string,
  generatedQuestionId: string,
  position: number,
): Promise<DailyQueueRow> {
  const { assignmentDateStr } = getDailyAssignmentBounds();
  const [question] = await db
    .select()
    .from(generatedQuestions)
    .where(and(
      eq(generatedQuestions.id, generatedQuestionId),
      eq(generatedQuestions.userId, userId),
      isNotNull(generatedQuestions.id),
    ))
    .limit(1);

  if (!question) {
    throw new Error('Generated question not found for user.');
  }

  const slot: QueueSlot = {
    slot_index: position,
    source: 'bot',
    generated_question_id: question.id,
    domain: question.canonicalSubcategory,
    broad_category: question.broadCategory,
    category: null,
    question_text: question.questionText,
    difficulty_estimate: asQueueSlotDifficulty(question.difficultyEstimate),
    answered: false,
    difficulty_stepped_up: false,
  };

  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(dailyQueues)
      .where(and(eq(dailyQueues.userId, userId), eq(dailyQueues.queueDate, assignmentDateStr)))
      .limit(1);

    if (!existing) {
      const [created] = await tx
        .insert(dailyQueues)
        .values({
          userId,
          queueDate: assignmentDateStr,
          slots: [slot],
        })
        .returning();

      await tx
        .update(generatedQuestions)
        .set({ usedInQueue: true })
        .where(eq(generatedQuestions.id, generatedQuestionId));

      return created;
    }

    const slots = asQueueSlots(existing.slots).filter((item) => item.slot_index !== position);
    const nextSlots = [...slots, slot].sort((a, b) => a.slot_index - b.slot_index);
    const [updated] = await tx
      .update(dailyQueues)
      .set({ slots: nextSlots })
      .where(eq(dailyQueues.id, existing.id))
      .returning();

    await tx
      .update(generatedQuestions)
      .set({ usedInQueue: true })
      .where(eq(generatedQuestions.id, generatedQuestionId));

    return updated;
  });
}

export async function getRecentDailyQuestionTexts(userId: string, limit = 60): Promise<string[]> {
  const rows = await db
    .select({ questionText: generatedQuestions.questionText })
    .from(generatedQuestions)
    .where(eq(generatedQuestions.userId, userId))
    .orderBy(sql`${generatedQuestions.createdAt} desc`)
    .limit(limit);

  return rows.map((row) => row.questionText);
}

export async function getAnsweredDailyCount(queue: DailyQueueRow): Promise<number> {
  return asQueueSlots(queue.slots).filter((slot) => slot.answered).length;
}

export async function userHasFriendMediatedDomain(userId: string, domain: string): Promise<boolean> {
  const [row] = await db
    .select({ id: masteryEvents.id })
    .from(masteryEvents)
    .where(and(
      eq(masteryEvents.userId, userId),
      eq(masteryEvents.canonicalSubcategory, domain),
      inArray(masteryEvents.sourceType, ['live_correct', 'catchup_correct']),
      isNotNull(masteryEvents.questionId),
    ))
    .limit(1);

  return Boolean(row);
}

export async function getKBDomainEntry(userId: string, domain: string) {
  const [row] = await db
    .select()
    .from(declaredInterests)
    .where(and(
      eq(declaredInterests.userId, userId),
      eq(declaredInterests.domain, domain),
      eq(declaredInterests.isActive, true),
    ))
    .limit(1);

  return row ?? null;
}

export async function addKBDomainAsDeclared(
  userId: string,
  domain: string,
  broadCategory?: string | null,
): Promise<{ opened: boolean; alreadyExisted: boolean }> {
  const { openKBDomain } = await import('@/server/knowledge/open-domain');
  return openKBDomain({ userId, domain, via: 'authorship', broadCategory });
}

async function _legacyInsertDeclared(
  userId: string,
  domain: string,
  broadCategory?: string | null,
): Promise<void> {
  await db
    .insert(declaredInterests)
    .values({
      userId,
      domain,
      broadCategory: broadCategory ?? null,
    })
    .onConflictDoNothing({
      target: [declaredInterests.userId, declaredInterests.domain],
    });
}

/**
 * @deprecated Use promoteDeclaredToDemonstrated. This function
 * still exists for any in-flight code paths but should not be
 * called. Scheduled for removal in v11.2.
 */
export async function upgradeKBDomainToDemonstrated(userId: string, domain: string): Promise<void> {
  const { openKBDomain } = await import('@/server/knowledge/open-domain');
  await openKBDomain({ userId, domain, via: 'answered_correctly' });
}
