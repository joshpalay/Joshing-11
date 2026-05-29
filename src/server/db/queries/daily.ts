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
  users,
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
  const canonicalIds = candidateSlots
    .filter(({ slot }) => !slot.generated_question_id)
    .map(({ slot }) => slot.question_id)
    .filter((id): id is string => Boolean(id));

  if (generatedIds.length === 0 && canonicalIds.length === 0) return [];

  const [generatedRows, canonicalRows] = await Promise.all([
    generatedIds.length > 0
      ? db
          .select()
          .from(generatedQuestions)
          .where(and(
            eq(generatedQuestions.userId, userId),
            inArray(generatedQuestions.id, generatedIds),
          ))
      : Promise.resolve<typeof generatedQuestions.$inferSelect[]>([]),
    canonicalIds.length > 0
      ? db
          .select()
          .from(canonicalQuestions)
          .where(inArray(canonicalQuestions.id, canonicalIds))
      : Promise.resolve<typeof canonicalQuestions.$inferSelect[]>([]),
  ]);
  const generatedById = new Map(generatedRows.map((question) => [question.id, question]));
  const canonicalById = new Map(canonicalRows.map((question) => [question.id, question]));

  return candidateSlots
    .map(({ queue, slot }): CatchupQuestion | null => {
      const queueDate = String(queue.queueDate);
      const expiresAt = catchUpExpiresAt(queueDate);

      if (slot.generated_question_id) {
        const question = generatedById.get(slot.generated_question_id);
        if (!question) return null;
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
      }

      if (!slot.question_id) return null;
      const question = canonicalById.get(slot.question_id);
      if (!question || question.deletedAt) return null;
      const domain = slot.domain || question.canonicalSubcategory || question.broadCategory || question.category;
      if (!domain || isGenericSubcategory(domain)) return null;
      const difficulty = asQueueSlotDifficulty(
        question.calibratedDifficulty ?? question.llmDifficulty ?? question.difficultyEstimate ?? null,
      ) ?? null;
      const explanation = question.explainerFullWrong
        ?? question.explainerFull
        ?? question.explainerBrief
        ?? question.factualExplanation
        ?? null;
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
        correctAnswer: question.answerText,
        alternateAnswers: question.acceptedAlternatives ?? [],
        explanation,
        domain,
        domainDisplayName: categoryLabel(domain),
        broadCategory: question.broadCategory ?? domain,
        basePoints: getBasePoints(difficulty, 'first_correct'),
        difficultyEstimate: difficulty,
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

export type AuthoredPick = {
  id: string;
  creatorId: string | null;
  questionText: string;
  answerText: string;
  alternateAnswers: string[];
  factualExplanation: string | null;
  canonicalSubcategory: string;
  broadCategory: string | null;
  category: string;
  difficultyEstimate: 'accessible' | 'moderate' | 'specialist' | null;
  authorName: string | null;
  authorNote: string | null;
};

/**
 * Returns up to `limit` vetted user-authored questions for the viewer's
 * Daily 5, ranked by social tier: direct friends first, then friends-of-
 * friends, then everyone else. The orchestrator tops up the remaining
 * slots with LLM-generated questions.
 *
 * "Vetted" means publicStatus = 'eligible_pending' (set by the Haiku
 * vetter in src/server/llm/vet-question.ts). The viewer is never offered
 * their own question, deleted questions, or questions that have already
 * appeared in any of their past daily queues.
 */
export async function pickEligibleAuthoredQuestions(
  viewerUserId: string,
  socialGraph: { direct: Set<string>; extended: Set<string> },
  limit: number,
): Promise<AuthoredPick[]> {
  if (limit <= 0) return [];

  // Collect every question id the viewer has already seen on any past daily
  // queue. The graph is small per user (5 slots/day) so a Node-side scan is
  // simpler than a JSONB containment subquery and dodges driver portability
  // questions. Indexed via DailyQueue_user_id_idx.
  //
  // ALSO collect every question the viewer has already answered on any surface
  // (feed, catchup, prior daily). MASTERY_EVENTS.question_id stores the
  // canonical Question.id for both feed and daily writes (see writeMasteryEvent
  // / daily/answer route) — but only `live_correct` and `catchup_correct` were
  // covered before, so a feed delivery the viewer never opened (or answered
  // wrong) used to re-surface as a "friend" Daily slot the next day.
  //
  // ALSO collect every question the viewer has been *sent* via FeedItem,
  // regardless of state. The feed is the other distribution surface for
  // friend questions; once a question has hit the viewer's feed we should not
  // re-serve it as a Daily slot in any state.
  const [pastQueues, answeredRows, feedRows] = await Promise.all([
    db
      .select({ slots: dailyQueues.slots })
      .from(dailyQueues)
      .where(eq(dailyQueues.userId, viewerUserId)),
    db
      .select({ questionId: masteryEvents.questionId })
      .from(masteryEvents)
      .where(and(
        eq(masteryEvents.userId, viewerUserId),
        inArray(masteryEvents.sourceType, ['live_correct', 'catchup_correct']),
        isNotNull(masteryEvents.questionId),
      )),
    db
      .select({ questionId: feedItems.questionId })
      .from(feedItems)
      .where(and(
        eq(feedItems.recipientUserId, viewerUserId),
        isNotNull(feedItems.questionId),
      )),
  ]);
  const seenQuestionIds = new Set<string>();
  for (const row of pastQueues) {
    for (const slot of asQueueSlots(row.slots)) {
      if (slot.question_id) seenQuestionIds.add(slot.question_id);
    }
  }
  for (const row of answeredRows) {
    if (row.questionId) seenQuestionIds.add(row.questionId);
  }
  for (const row of feedRows) {
    if (row.questionId) seenQuestionIds.add(row.questionId);
  }

  // Pull a generous over-fetch so the in-memory tier sort has something to
  // work with even when most of the recent pool came from the viewer's own
  // FoF cluster. The DB-side ORDER BY is only the score+recency tiebreak.
  const overFetch = Math.max(limit * 6, 30);
  const candidates = await db
    .select({
      id: canonicalQuestions.id,
      creatorId: canonicalQuestions.creatorId,
      questionText: canonicalQuestions.questionText,
      answerText: canonicalQuestions.answerText,
      alternateAnswers: canonicalQuestions.acceptedAlternatives,
      factualExplanation: canonicalQuestions.factualExplanation,
      canonicalSubcategory: canonicalQuestions.canonicalSubcategory,
      broadCategory: canonicalQuestions.broadCategory,
      category: canonicalQuestions.category,
      difficultyEstimate: canonicalQuestions.difficultyEstimate,
      creatorNote: canonicalQuestions.creatorNote,
      publicEligibilityScore: canonicalQuestions.publicEligibilityScore,
      createdAt: canonicalQuestions.createdAt,
    })
    .from(canonicalQuestions)
    .where(and(
      eq(canonicalQuestions.publicStatus, 'eligible_pending'),
      eq(canonicalQuestions.visibility, 'public'),
      isNotNull(canonicalQuestions.creatorId),
      isNotNull(canonicalQuestions.canonicalSubcategory),
      isNull(canonicalQuestions.deletedAt),
    ))
    .orderBy(
      desc(canonicalQuestions.publicEligibilityScore),
      desc(canonicalQuestions.createdAt),
    )
    .limit(overFetch);

  const tierOf = (creatorId: string | null): number => {
    if (!creatorId) return 3;
    if (socialGraph.direct.has(creatorId)) return 0;
    if (socialGraph.extended.has(creatorId)) return 1;
    return 2;
  };

  const filtered = candidates
    .filter((row) => row.creatorId && row.creatorId !== viewerUserId)
    .filter((row) => !seenQuestionIds.has(row.id))
    .filter((row) => row.canonicalSubcategory && !isGenericSubcategory(row.canonicalSubcategory))
    .map((row) => ({
      row,
      tier: tierOf(row.creatorId),
      score: row.publicEligibilityScore ?? 0,
      createdAt: row.createdAt?.getTime() ?? 0,
    }))
    .sort((a, b) => {
      if (a.tier !== b.tier) return a.tier - b.tier;
      if (a.score !== b.score) return b.score - a.score;
      return b.createdAt - a.createdAt;
    })
    .slice(0, limit);

  if (filtered.length === 0) return [];

  // Hydrate author display names in one shot.
  const authorIds = [...new Set(filtered.map((c) => c.row.creatorId).filter((id): id is string => Boolean(id)))];
  const authorRows = await db
    .select({ id: users.id, displayName: users.displayName })
    .from(users)
    .where(inArray(users.id, authorIds));
  const nameById = new Map(authorRows.map((u) => [u.id, u.displayName] as const));

  return filtered.map(({ row }) => ({
    id: row.id,
    creatorId: row.creatorId,
    questionText: row.questionText,
    answerText: row.answerText,
    alternateAnswers: row.alternateAnswers ?? [],
    factualExplanation: row.factualExplanation,
    canonicalSubcategory: row.canonicalSubcategory ?? '',
    broadCategory: row.broadCategory,
    category: String(row.category ?? ''),
    difficultyEstimate: asQueueSlotDifficulty(row.difficultyEstimate ?? null) ?? null,
    authorName: row.creatorId ? nameById.get(row.creatorId) ?? null : null,
    authorNote: row.creatorNote ?? null,
  } satisfies AuthoredPick));
}

/**
 * Inserts a vetted user-authored question into the viewer's daily queue
 * as a `source: 'friend'` slot. Counterpart to `createDailyQueueItem`,
 * which only handles bot-generated questions. The QueueSlot schema
 * already supports both shapes (src/server/daily/types.ts).
 */
export async function createDailyQueueItemFromAuthored(
  userId: string,
  authored: AuthoredPick,
  position: number,
): Promise<DailyQueueRow> {
  const { assignmentDateStr } = getDailyAssignmentBounds();

  const slot: QueueSlot = {
    slot_index: position,
    source: 'friend',
    question_id: authored.id,
    author_id: authored.creatorId ?? undefined,
    author_name: authored.authorName,
    author_note: authored.authorNote,
    domain: authored.canonicalSubcategory,
    broad_category: authored.broadCategory,
    category: authored.category || null,
    question_text: authored.questionText,
    difficulty_estimate: authored.difficultyEstimate ?? undefined,
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
      return created;
    }

    const slots = asQueueSlots(existing.slots).filter((item) => item.slot_index !== position);
    const nextSlots = [...slots, slot].sort((a, b) => a.slot_index - b.slot_index);
    const [updated] = await tx
      .update(dailyQueues)
      .set({ slots: nextSlots })
      .where(eq(dailyQueues.id, existing.id))
      .returning();
    return updated;
  });
}

export type RecentDailyQuestionEntry = {
  domain: string;
  text: string;
};

export type RecentFactKeyEntry = {
  domain: string;
  factKey: string;
};

// Default widened from 60 to 200: the LLM repeatedly regenerated canonical
// trivia (the Götterdämmerung Hagen-summons-vassals question surfaced ~4×)
// because anything beyond ~12 days fell out of the avoid window. The full list
// is now used to derive a compact fact-key avoid set; only the most recent
// slice of full question texts is included verbatim (see RECENT_QUESTION_TEXT_LIMIT
// in src/server/daily/generate-questions.ts).
//
// Each entry carries the source domain so the prompt can label cross-domain
// overlap explicitly (e.g. a Mrs. Dalloway fact asked under "Virginia Woolf's
// Novels and Essays" still counts when generating for the "Mrs. Dalloway"
// domain). The avoid list itself is already cross-domain (user-scoped),
// so this is purely about giving the LLM the signal to use it.
export async function getRecentDailyQuestionTexts(
  userId: string,
  limit = 200,
): Promise<RecentDailyQuestionEntry[]> {
  const rows = await db
    .select({
      questionText: generatedQuestions.questionText,
      domain: generatedQuestions.canonicalSubcategory,
    })
    .from(generatedQuestions)
    .where(eq(generatedQuestions.userId, userId))
    .orderBy(sql`${generatedQuestions.createdAt} desc`)
    .limit(limit);

  return rows.map((row) => ({
    domain: row.domain ?? 'unknown',
    text: row.questionText,
  }));
}

export type AccessibleBankSource = {
  questionText: string;
  answer: string;
  explainer: string;
  broadCategory: string;
  canonicalSubcategory: string;
  difficultyEstimate: string;
  basePoints: number;
  factKey: string;
  subAngles: string[];
};

// Pull one previously-generated "accessible" question for the given domain
// that the current user has NOT seen, sourced from any OTHER user. Lets us
// reuse canonical accessible trivia ("Mrs. Lovett's name", "Send in the
// Clowns") instead of re-discovering it via Sonnet each week.
//
// Restrictions:
// - fact_key must be present (predates 2026-05-24; older rows lack it)
// - created within the last 30 days (filters out the worst pre-quality-gate
//   historical drift)
// - not authored by the viewer
// - fact_key not already in the viewer's recent avoid set
//
// Returns null when the bank is empty for this domain — caller falls back
// to fresh LLM generation, which incidentally grows the bank.
export async function pickAccessibleBankSource(
  userId: string,
  domain: string,
  avoidFactKeys: ReadonlySet<string>,
): Promise<AccessibleBankSource | null> {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  let candidates: Array<typeof generatedQuestions.$inferSelect>;
  try {
    candidates = await db
      .select()
      .from(generatedQuestions)
      .where(and(
        eq(generatedQuestions.canonicalSubcategory, domain),
        eq(generatedQuestions.difficultyEstimate, 'accessible'),
        isNotNull(generatedQuestions.factKey),
        sql`${generatedQuestions.userId} <> ${userId}`,
        gte(generatedQuestions.createdAt, since),
      ))
      .orderBy(sql`random()`)
      .limit(8);
  } catch (error) {
    // Tolerate the brief window where the sub_angles column is missing
    // (migration 0055): a hard failure here would silently disable the
    // entire bank-pick path until the migration lands.
    if (pgErrorCode(error) === '42703') return null;
    throw error;
  }

  for (const row of candidates) {
    if (!row.factKey) continue;
    if (avoidFactKeys.has(row.factKey)) continue;
    return {
      questionText: row.questionText,
      answer: row.answer,
      explainer: row.explainer,
      broadCategory: row.broadCategory,
      canonicalSubcategory: row.canonicalSubcategory,
      difficultyEstimate: row.difficultyEstimate,
      basePoints: row.basePoints,
      factKey: row.factKey,
      subAngles: Array.isArray(row.subAngles) ? row.subAngles : [],
    };
  }
  return null;
}

// Counts of recent generations per canonical_subcategory for a user, scoped
// to a lookback window. Used by `selectDiverseDomains` to deprioritise
// over-saturated domains so a user with 10 active interests doesn't see
// the same 2-3 domains every day.
export async function getRecentDomainCounts(
  userId: string,
  lookbackDays = 7,
): Promise<Map<string, number>> {
  const since = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000);
  const rows = await db
    .select({
      domain: generatedQuestions.canonicalSubcategory,
      count: sql<number>`count(*)::int`,
    })
    .from(generatedQuestions)
    .where(and(
      eq(generatedQuestions.userId, userId),
      gte(generatedQuestions.createdAt, since),
    ))
    .groupBy(generatedQuestions.canonicalSubcategory);

  const result = new Map<string, number>();
  for (const row of rows) {
    if (row.domain) result.set(row.domain, Number(row.count) || 0);
  }
  return result;
}

// Aggregate recent sub_angles per domain for positive guidance in the
// generation prompt. We only care about domains the next generation will
// target, so the caller scopes the lookup. Returns a Map keyed by domain
// with the deduped sub-angle tag list (newest-first up to the per-domain
// cap). An empty Map is returned if the column is missing on a preview DB
// that hasn't run migration 0055.
export async function getRecentSubAnglesByDomain(
  userId: string,
  domains: string[],
  perDomainLimit = 20,
  rowLimit = 200,
): Promise<Map<string, string[]>> {
  const result = new Map<string, string[]>();
  if (domains.length === 0) return result;

  let rows: { domain: string; subAngles: string[] }[];
  try {
    rows = await db
      .select({
        domain: generatedQuestions.canonicalSubcategory,
        subAngles: generatedQuestions.subAngles,
      })
      .from(generatedQuestions)
      .where(and(
        eq(generatedQuestions.userId, userId),
        inArray(generatedQuestions.canonicalSubcategory, domains),
      ))
      .orderBy(sql`${generatedQuestions.createdAt} desc`)
      .limit(rowLimit);
  } catch (error) {
    // sub_angles column is added by migration 0055; tolerate the brief window
    // where the column is missing rather than 500ing the daily generation.
    if (pgErrorCode(error) === '42703') return result;
    throw error;
  }

  const perDomainSeen = new Map<string, Set<string>>();
  for (const row of rows) {
    const angles = Array.isArray(row.subAngles) ? row.subAngles : [];
    if (angles.length === 0) continue;
    const domain = row.domain;
    let bucket = result.get(domain);
    let seen = perDomainSeen.get(domain);
    if (!bucket) {
      bucket = [];
      result.set(domain, bucket);
    }
    if (!seen) {
      seen = new Set<string>();
      perDomainSeen.set(domain, seen);
    }
    for (const angle of angles) {
      if (typeof angle !== 'string') continue;
      const trimmed = angle.trim();
      if (!trimmed) continue;
      const key = trimmed.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      bucket.push(trimmed);
      if (bucket.length >= perDomainLimit) break;
    }
  }
  return result;
}

// Recent fact_keys for the same user, newest first. Used both for the LLM
// avoid list (compact: ~40 chars per key vs. ~80+ per full question text)
// and the persist-time dedup check in persistGeneratedQuestion.
export async function getRecentFactKeys(
  userId: string,
  limit = 200,
): Promise<RecentFactKeyEntry[]> {
  const rows = await db
    .select({
      factKey: generatedQuestions.factKey,
      domain: generatedQuestions.canonicalSubcategory,
    })
    .from(generatedQuestions)
    .where(and(
      eq(generatedQuestions.userId, userId),
      isNotNull(generatedQuestions.factKey),
    ))
    .orderBy(sql`${generatedQuestions.createdAt} desc`)
    .limit(limit);

  const out: RecentFactKeyEntry[] = [];
  for (const row of rows) {
    if (row.factKey) {
      out.push({ domain: row.domain ?? 'unknown', factKey: row.factKey });
    }
  }
  return out;
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
