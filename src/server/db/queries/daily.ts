import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lt, lte, ne, or, sql } from 'drizzle-orm';

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
  skippedDailyQuestions,
  userDomainExclusions,
  users,
} from '@/server/db';
import { getDailyAssignmentBounds } from '@/lib/games/timezone';
import { getActiveDeclaredInterests } from '@/server/db/queries/declared-interests';
import { notSuppressedByContentReport } from '@/server/db/queries/content-reports';
import { pgErrorCode } from '@/server/db/pg-error';
import { CATEGORIES, categoryLabel, HOUSE_AUTHOR, resolveAuthorDisplay } from '@/lib/questions-types';
import { CATCHUP_LOOKBACK_DAYS, asQueueSlots, dailyQueueItemId, feedCatchupItemId, minusUtcDays } from '@/server/daily/catchup';
import { DAILY_QUEUE_SIZE, type QueueSlot } from '@/server/daily/types';
import {
  FRIEND_FACING_TIERS,
  SELF_PRACTICE_TIERS,
  applyTierGate,
  type TrustTier,
} from '@/server/daily/verification-gating';
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
import { domainKey } from '@/lib/knowledge/domain-key';

function asQueueSlotDifficulty(
  value: string | null | undefined,
): 'accessible' | 'moderate' | 'specialist' | undefined {
  if (value === 'accessible' || value === 'moderate' || value === 'specialist') return value;
  return undefined;
}

export type KnowledgeBaseDomain = {
  domain: string;
  broadCategory: string | null;
  source: 'declared' | 'demonstrated';
  territoryType: 'declared' | 'demonstrated';
  totalPoints: number;
  tier: 'establishing' | 'familiar' | 'solid' | 'mastery';
  correctAnswerCount: number;
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
  /**
   * Display name of the human author, when one exists. Null for LLM-origin
   * questions (daily-generated, or curated_sent feed items with no creator) —
   * the client renders the non-person LLM_QUESTION_ATTRIBUTION label for those
   * rather than implying a person wrote it.
   */
  authorName: string | null;
  /**
   * D-3: the author is the non-human house/editorial author. `authorName` is the
   * house name ('Joshing') and the client renders the persistent Editorial badge
   * with no relational copy. Set explicitly (not inferred from the name string).
   */
  authorIsHouse: boolean;
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

async function getCorrectAnswerCountsByDomain(userId: string): Promise<Map<string, number>> {
  const rows = await db
    .select({
      domain: masteryEvents.canonicalSubcategory,
      count: sql<number>`count(*)::int`,
    })
    .from(masteryEvents)
    .where(and(eq(masteryEvents.userId, userId), inArray(masteryEvents.sourceType, ['live_correct', 'catchup_correct'])))
    .groupBy(masteryEvents.canonicalSubcategory);

  return new Map(rows.map((row) => [normalizeDomain(row.domain).toLowerCase(), Number(row.count ?? 0)]));
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
  const [masteryRows, declaredRows, excludedDomains, correctCountsByDomain] = await Promise.all([
    getPlayerMasteryKnowledgeRows(userId),
    getActiveDeclaredInterests(userId),
    getExcludedKnowledgeDomains(userId),
    getCorrectAnswerCountsByDomain(userId),
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
      source: row.territoryType === 'declared' ? 'declared' : 'demonstrated',
      territoryType: row.territoryType,
      totalPoints: row.totalPoints,
      tier: row.tier,
      correctAnswerCount: correctCountsByDomain.get(key) ?? 0,
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
      correctAnswerCount: existing?.correctAnswerCount ?? correctCountsByDomain.get(key) ?? 0,
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

/**
 * Atomically claim the daily reminder email for a queue so concurrent cron
 * retries can't double-send. The single UPDATE flips email_reminder_sent_at
 * from null to now() only if it is still null, and RETURNs the row iff this
 * call won the race. Returns true iff THIS call should send; a losing or
 * duplicate call returns false and must not send.
 */
export async function claimDailyEmailReminder(queueId: string): Promise<boolean> {
  const claimed = await db
    .update(dailyQueues)
    .set({ emailReminderSentAt: new Date() })
    .where(and(eq(dailyQueues.id, queueId), isNull(dailyQueues.emailReminderSentAt)))
    .returning({ id: dailyQueues.id });

  return claimed.length > 0;
}

/**
 * Release a claim (reset email_reminder_sent_at to null) after a send failure,
 * so a later cron run can retry the reminder for this queue. Idempotent.
 */
export async function releaseDailyEmailReminder(queueId: string): Promise<void> {
  await db
    .update(dailyQueues)
    .set({ emailReminderSentAt: null })
    .where(eq(dailyQueues.id, queueId));
}

/**
 * Total number of daily queues ever built for this user, across all dates.
 *
 * Used to detect a user's FIRST Daily Five: the orchestrator treats a zero count
 * (no queue built yet) as first-run and seeds the queue from onboarding areas in
 * selection order; the queue route treats a count of one (only the just-served
 * queue) as the moment to show the one-time first-run intro.
 */
export async function countDailyQueues(userId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(dailyQueues)
    .where(eq(dailyQueues.userId, userId));
  return row?.count ?? 0;
}

/**
 * Deletes the user's untouched daily queues (none of whose slots are answered or
 * skipped) within the catch-up window. Returns the number of queues deleted.
 *
 * Used when daily preferences (topics / domain mode / difficulty) change before
 * play: dropping untouched queues lets the next queue load regenerate from the
 * new settings (POST /api/daily/queue → fillDailyQueueForUser reads current
 * preferences). We clear not just today's queue but every still-eligible prior
 * untouched queue, because carryForwardUntouchedDailyQueue would otherwise
 * re-date one of those old-settings queues onto today and defeat the change.
 *
 * Started queues (any slot answered or skipped) are left intact, so points
 * already earned survive and that day's questions remain available in catch-up;
 * the new settings take effect on the next freshly generated queue.
 */
export async function invalidateUntouchedDailyQueues(userId: string): Promise<number> {
  const { assignmentDateStr } = getDailyAssignmentBounds();
  const oldestEligible = minusUtcDays(assignmentDateStr, CATCHUP_LOOKBACK_DAYS);

  const queues = await db
    .select()
    .from(dailyQueues)
    .where(and(
      eq(dailyQueues.userId, userId),
      lte(dailyQueues.queueDate, assignmentDateStr),
      gte(dailyQueues.queueDate, oldestEligible),
    ));

  const untouchedIds = queues
    .filter((queue) => !asQueueSlots(queue.slots).some((slot) => slot.answered || slot.skipped))
    .map((queue) => queue.id);

  if (untouchedIds.length === 0) return 0;

  await db.delete(dailyQueues).where(inArray(dailyQueues.id, untouchedIds));
  return untouchedIds.length;
}

/**
 * Rolls an unplayed previous Daily Five forward to today instead of generating
 * a brand-new (LLM-billed) set the user may again skip. Returns true when the
 * caller should treat today's queue as ready (either it already existed, or a
 * prior untouched queue was re-dated to today); false when there's nothing to
 * carry forward and the caller should generate.
 *
 * Rationale: the cron builds a queue for every onboarded user every day with no
 * activity filter, so a user who's been away for N days accrued N fresh
 * generations they never saw. Their previous queue is still sitting unplayed
 * (and surfaces in catch-up for CATCHUP_LOOKBACK_DAYS), so re-dating it gives
 * them the same five at zero LLM cost. A *played* prior queue (any slot answered
 * or skipped) is left alone — that user is engaged and should get a fresh set.
 *
 * Re-dating reuses the same row, so the carried-forward queue keeps rolling
 * forward each day until the user actually plays it; only real engagement (or
 * no prior queue at all) triggers generation.
 */
export async function carryForwardUntouchedDailyQueue(userId: string): Promise<boolean> {
  const { assignmentDateStr } = getDailyAssignmentBounds();

  const today = await getTodaysDailyQueue(userId);
  if (today && asQueueSlots(today.slots).length > 0) return true;

  // Only carry forward a queue still inside the catch-up window. An older queue
  // has already aged out of catch-up, so re-dating it would surface stale
  // questions the user can no longer otherwise reach; let that regenerate.
  const oldestEligible = minusUtcDays(assignmentDateStr, CATCHUP_LOOKBACK_DAYS);
  const [prior] = await db
    .select()
    .from(dailyQueues)
    .where(and(
      eq(dailyQueues.userId, userId),
      lt(dailyQueues.queueDate, assignmentDateStr),
      gte(dailyQueues.queueDate, oldestEligible),
    ))
    .orderBy(desc(dailyQueues.queueDate))
    .limit(1);

  if (!prior) return false;

  const priorSlots = asQueueSlots(prior.slots);
  // Only carry forward a *full* untouched queue. A short prior queue (a low-yield
  // or transiently-failed generation day) must be allowed to regenerate — rolling
  // it forward freezes the shortfall, so a one-off bad day (e.g. the 2026-05-29
  // over-provision truncation that yielded 3) gives the user the same partial set
  // every day until they happen to play it. Re-dating is purely a cost saver for
  // absent users; a fresh generation for a short queue is the right trade.
  if (priorSlots.length < DAILY_QUEUE_SIZE) return false;
  if (priorSlots.some((slot) => slot.answered || slot.skipped)) return false;

  // Clear any empty/partial today-row first so the unique (user, queue_date)
  // constraint doesn't block the re-date.
  if (today) {
    await db.delete(dailyQueues).where(eq(dailyQueues.id, today.id));
  }

  try {
    await db
      .update(dailyQueues)
      .set({ queueDate: assignmentDateStr })
      .where(eq(dailyQueues.id, prior.id));
    return true;
  } catch (error) {
    // 23505 = unique_violation: a today-row was created concurrently (e.g. the
    // on-demand POST raced the cron). Let the caller fall through; the existing
    // queue stands.
    if (pgErrorCode(error) === '23505') return false;
    throw error;
  }
}

/**
 * If today's queue is a SHORT, UNTOUCHED set that was carried over from a prior
 * day, delete it so the caller can regenerate a fresh, full set. Returns true
 * when it cleared one.
 *
 * carryForwardUntouchedDailyQueue re-dates a prior unplayed queue onto today but
 * leaves createdAt untouched, so a carried queue's createdAt predates today's
 * assignment window. A short queue *built today* (createdAt within the window)
 * is graceful-degrade for a genuinely low-yield day and is left intact —
 * regenerating it on every page load would re-bill the LLM. Only a carried-over
 * shortfall is stale: without this, a one-off bad generation day (e.g. the
 * 2026-05-29 over-provision truncation that yielded 3) freezes the user's Daily
 * Five short and rolls forward unchanged until they happen to play it.
 */
export async function clearStaleShortTodayQueue(userId: string): Promise<boolean> {
  const today = await getTodaysDailyQueue(userId);
  if (!today) return false;

  const slots = asQueueSlots(today.slots);
  if (slots.length === 0 || slots.length >= DAILY_QUEUE_SIZE) return false;
  if (slots.some((slot) => slot.answered || slot.skipped)) return false;

  // assignmentDate is the UTC calendar date of the current window's start. A row
  // physically created during this window (createdAt >= assignmentDate) was built
  // for today — keep it even if short. A carried-forward queue keeps its original,
  // earlier createdAt, so it falls before assignmentDate and is cleared.
  const { assignmentDate } = getDailyAssignmentBounds();
  if (today.createdAt >= assignmentDate) return false; // built for today — keep it

  await db.delete(dailyQueues).where(eq(dailyQueues.id, today.id));
  return true;
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

// Resolve creator display names for a set of (possibly null/duplicate) creator
// ids, returning a id→name map. Null/absent ids are skipped — their questions
// are LLM-origin and the client labels them non-relationally.
async function resolveCreatorNames(creatorIds: Array<string | null>): Promise<Map<string, string | null>> {
  const ids = [...new Set(creatorIds.filter((id): id is string => Boolean(id)))];
  if (ids.length === 0) return new Map();
  const nameRows = await db
    .select({ id: users.id, displayName: users.displayName })
    .from(users)
    .where(inArray(users.id, ids));
  return new Map(nameRows.map((row) => [row.id, row.displayName]));
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

  // Resolve human author names for canonical (friend-authored) slots so the
  // client shows the real person; generated slots have no creator and stay null.
  const authorNameById = await resolveCreatorNames(canonicalRows.map((q) => q.creatorId));

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
          authorName: null, // daily-generated: LLM origin, no human author
          authorIsHouse: false,
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
        ...resolveAuthorDisplay(question.creatorId, question.source, question.creatorId ? authorNameById.get(question.creatorId) ?? null : null),
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
        // Safety hard-block: a question blocked after the original answer
        // (cron re-vet, upheld report) must not resurface in catch-up.
        ne(canonicalQuestions.visibility, 'blocked'),
      ))
      .orderBy(desc(feedItems.sourceEventAt));
  } catch (error) {
    // catchupResolvedAt is added by migration 0038; tolerate a brief window
    // where the column is missing so the homepage doesn't 500 on first boot.
    if (pgErrorCode(error) === '42703') return [];
    throw error;
  }

  // Feed catch-up items can be friend-authored (authored_shared) or LLM
  // (curated_sent, null creator) — resolve the real author for the former.
  const authorNameById = await resolveCreatorNames(rows.map(({ question }) => question.creatorId));

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
        ...resolveAuthorDisplay(question.creatorId, question.source, question.creatorId ? authorNameById.get(question.creatorId) ?? null : null),
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

/** Presence attribution for a Daily Five +2 bonus slot (D-4 §B). */
export type BonusPresence = {
  sourceId: string;
  sourceName: string | null;
  /** Additional followed friends (beyond the named one) whose world surfaces this domain. */
  extraCount: number;
};

/**
 * Persists a Daily Five +2 bonus slot (D-4 §B): a freshly generated accessible
 * question, sourced like a bot slot (source='bot', generated_question_id) but
 * carrying presence_* attribution ("from {Name}'s world") instead of a literal
 * answerer. Replaces createDailyQueueItemFromAnswerer.
 */
export async function createDailyQueueItemFromPresence(
  userId: string,
  generatedQuestionId: string,
  presence: BonusPresence,
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
    throw new Error('Generated bonus question not found for user.');
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
    presence_source_id: presence.sourceId,
    presence_source_name: presence.sourceName,
    presence_source_extra_count: presence.extraCount > 0 ? presence.extraCount : undefined,
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
        .values({ userId, queueDate: assignmentDateStr, slots: [slot] })
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
 * D-3: a labeled non-human house/editorial question selected for the Daily core.
 * Mirrors AuthoredPick minus the human-author fields — the house identity is
 * fixed (resolved from HOUSE_AUTHOR at slot-build time), never a users row, so
 * there is no creatorId / authorName here. `authorNote` carries an optional
 * editorial aside (populated in Stage 5).
 */
export type HousePick = {
  id: string;
  questionText: string;
  answerText: string;
  alternateAnswers: string[];
  factualExplanation: string | null;
  canonicalSubcategory: string;
  broadCategory: string | null;
  category: string;
  difficultyEstimate: 'accessible' | 'moderate' | 'specialist' | null;
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
 *
 * `allowedSubcategories` constrains candidates to canonical subcategories
 * that are in the viewer's knowledge base (declared interests + demonstrated
 * mastery in random mode, selected domains in custom mode). Bot-generated
 * questions go through generateDailyQuestionsFromKnowledgeBase which is
 * already domain-constrained; without this set the authored picker was
 * serving the entire vetted public pool regardless of the viewer's
 * interests, so a viewer who declared only "Star Wars" + "UX design"
 * could end up with a Rodgers & Hammerstein question in their Daily 5.
 */
export async function pickEligibleAuthoredQuestions(
  viewerUserId: string,
  socialGraph: { direct: Set<string>; extended: Set<string> },
  limit: number,
  allowedSubcategories: ReadonlySet<string>,
): Promise<AuthoredPick[]> {
  if (limit <= 0) return [];
  if (allowedSubcategories.size === 0) return [];

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
      trustTier: canonicalQuestions.trustTier,
      createdAt: canonicalQuestions.createdAt,
    })
    .from(canonicalQuestions)
    .where(and(
      eq(canonicalQuestions.publicStatus, 'eligible_pending'),
      eq(canonicalQuestions.visibility, 'public'),
      isNotNull(canonicalQuestions.creatorId),
      isNotNull(canonicalQuestions.canonicalSubcategory),
      inArray(canonicalQuestions.canonicalSubcategory, [...allowedSubcategories]),
      isNull(canonicalQuestions.deletedAt),
      // B-Report-3: never draw a reported question into a new daily queue.
      notSuppressedByContentReport(canonicalQuestions.id, 'question'),
    ))
    .orderBy(
      desc(canonicalQuestions.publicEligibilityScore),
      desc(canonicalQuestions.createdAt),
    )
    .limit(overFetch);

  // Tier-gate (B4 Phase 3): friend-facing requires human_validated|author_confirmed.
  // Off by default — shadow-logs and serves today's set until the flag is flipped.
  const tierGated = applyTierGate(
    'friend-facing/authored',
    candidates,
    (row) => row.trustTier as TrustTier,
    FRIEND_FACING_TIERS,
  ).rows;

  const tierOf = (creatorId: string | null): number => {
    if (!creatorId) return 3;
    if (socialGraph.direct.has(creatorId)) return 0;
    if (socialGraph.extended.has(creatorId)) return 1;
    return 2;
  };

  const filtered = tierGated
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

/** Candidate row shape for the pure house selector (subset of canonical columns). */
export type HouseCandidateRow = {
  id: string;
  questionText: string;
  answerText: string;
  alternateAnswers: string[] | null;
  factualExplanation: string | null;
  canonicalSubcategory: string | null;
  broadCategory: string | null;
  category: string | null;
  difficultyEstimate: string | null;
  creatorNote: string | null;
  createdAt: Date | null;
};

/**
 * Pure selection step for house questions (extracted for testing). Drops
 * anything the viewer has already seen and anything in a generic bucket domain,
 * prefers newest curated content, and caps at `limit`. Domain matching to the
 * viewer's niches happens in the SQL filter (allowedSubcategories); this step is
 * the in-memory dedup + ordering.
 */
export function selectHousePicks(
  rows: HouseCandidateRow[],
  seenQuestionIds: ReadonlySet<string>,
  limit: number,
): HousePick[] {
  if (limit <= 0) return [];
  return rows
    .filter((row) => !seenQuestionIds.has(row.id))
    .filter((row) => row.canonicalSubcategory && !isGenericSubcategory(row.canonicalSubcategory))
    .sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0))
    .slice(0, limit)
    .map((row) => ({
      id: row.id,
      questionText: row.questionText,
      answerText: row.answerText,
      alternateAnswers: row.alternateAnswers ?? [],
      factualExplanation: row.factualExplanation,
      canonicalSubcategory: row.canonicalSubcategory ?? '',
      broadCategory: row.broadCategory,
      category: String(row.category ?? ''),
      difficultyEstimate: asQueueSlotDifficulty(row.difficultyEstimate ?? null) ?? null,
      authorNote: row.creatorNote ?? null,
    } satisfies HousePick));
}

/**
 * D-3 — selects up to `limit` house/editorial questions (canonical rows with
 * source='house_authored', creatorId null) matched to the viewer's niches by
 * domain. This is the bank/domain matching path (NOT the +2 relevance ranking):
 * candidates are constrained to `allowedSubcategories` (the viewer's knowledge
 * base) exactly like the bot/bank pool, and deduped against questions the viewer
 * has already seen on a past daily or answered. House questions never enter the
 * Feed and never occupy a +2 bonus slot (see createDailyQueueItemFromHouse /
 * isCorrectAnswerFeedEligible).
 *
 * House content is editorially curated, so it is NOT gated on the public-vetting
 * status the authored picker requires — only visibility='public' and not deleted.
 */
export async function pickHouseQuestions(
  viewerUserId: string,
  limit: number,
  allowedSubcategories: ReadonlySet<string>,
): Promise<HousePick[]> {
  if (limit <= 0) return [];
  if (allowedSubcategories.size === 0) return [];

  // House questions never reach the viewer's feed (Invariant — house is not
  // feed-eligible), so dedup only needs past daily queues + answered questions.
  const [pastQueues, answeredRows] = await Promise.all([
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

  const candidates = await db
    .select({
      id: canonicalQuestions.id,
      questionText: canonicalQuestions.questionText,
      answerText: canonicalQuestions.answerText,
      alternateAnswers: canonicalQuestions.acceptedAlternatives,
      factualExplanation: canonicalQuestions.factualExplanation,
      canonicalSubcategory: canonicalQuestions.canonicalSubcategory,
      broadCategory: canonicalQuestions.broadCategory,
      category: canonicalQuestions.category,
      difficultyEstimate: canonicalQuestions.difficultyEstimate,
      creatorNote: canonicalQuestions.creatorNote,
      trustTier: canonicalQuestions.trustTier,
      createdAt: canonicalQuestions.createdAt,
    })
    .from(canonicalQuestions)
    .where(and(
      eq(canonicalQuestions.source, 'house_authored'),
      isNull(canonicalQuestions.creatorId),
      eq(canonicalQuestions.visibility, 'public'),
      isNotNull(canonicalQuestions.canonicalSubcategory),
      inArray(canonicalQuestions.canonicalSubcategory, [...allowedSubcategories]),
      isNull(canonicalQuestions.deletedAt),
      // B-Report-3: a reported house question is suppressed from new queues too.
      notSuppressedByContentReport(canonicalQuestions.id, 'question'),
    ))
    .orderBy(desc(canonicalQuestions.createdAt))
    .limit(Math.max(limit * 4, 20));

  // Tier-gate (B4 Phase 3): house editorial is the friend-facing bucket
  // (author-asserted, public per D9). Off by default — shadow-logs only.
  const gatedCandidates = applyTierGate(
    'house/editorial',
    candidates,
    (row) => row.trustTier as TrustTier,
    FRIEND_FACING_TIERS,
  ).rows;

  return selectHousePicks(gatedCandidates, seenQuestionIds, limit);
}

/**
 * Builds the QueueSlot for a house core slot (pure; extracted for testing).
 * source='house', a canonical question_id, author_name='Joshing' — and crucially
 * NO author_id (the house identity is never a users.id; Invariant H-1) and NO
 * answerer_* fields (so it is unmistakably a core slot, never a +2 bonus slot).
 */
export function buildHouseSlot(pick: HousePick, position: number): QueueSlot {
  return {
    slot_index: position,
    source: 'house',
    question_id: pick.id,
    author_name: HOUSE_AUTHOR.displayName,
    author_note: pick.authorNote ?? undefined,
    domain: pick.canonicalSubcategory,
    broad_category: pick.broadCategory,
    category: pick.category || null,
    question_text: pick.questionText,
    difficulty_estimate: pick.difficultyEstimate ?? undefined,
    answered: false,
    difficulty_stepped_up: false,
  };
}

/**
 * Inserts a house/editorial question into the viewer's daily queue as a
 * `source: 'house'` core slot. Counterpart to createDailyQueueItemFromAuthored.
 */
export async function createDailyQueueItemFromHouse(
  userId: string,
  pick: HousePick,
  position: number,
): Promise<DailyQueueRow> {
  const { assignmentDateStr } = getDailyAssignmentBounds();
  const slot = buildHouseSlot(pick, position);

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

export type BankSource = {
  questionText: string;
  answer: string;
  explainer: string;
  broadCategory: string;
  canonicalSubcategory: string;
  difficultyEstimate: string;
  basePoints: number;
  factKey: string;
  subAngles: string[];
  // Quality/verification fields earned once at generation time (PRD-D-5
  // "verify-once-reuse-many"). Carried so the per-viewer serving copy keeps
  // the aside, the right-but-rephrased grading leniency (acceptable_variants
  // is what /api/daily/answer grades against), the earned trust tier, and the
  // retrieval provenance, instead of silently resetting them on every reuse
  // (audit 2026-06-10, finding Q4).
  insideJoke: string | null;
  trustTier: TrustTier;
  askToAnswerVerified: boolean;
  acceptableVariants: string[];
  sourceRefs: string[];
  perishable: boolean;
};

export type BankDifficulty = 'accessible' | 'moderate' | 'specialist';

// Pull one previously-generated question of the requested difficulty tier for
// the given domain that the current user has NOT seen, sourced from any OTHER
// user. Lets us reuse canonical trivia ("Mrs. Lovett's name", "Send in the
// Clowns") instead of re-discovering it via Sonnet each week.
//
// Originally accessible-only; now spans accessible/moderate/specialist so the
// harder slots draw from the shared pool before billing the LLM too. The
// caller passes the difficulty the slot would otherwise generate at, so a
// reused question always matches the player's intended difficulty.
//
// Restrictions:
// - fact_key must be present (predates 2026-05-24; older rows lack it)
// - not GENERATED for the viewer (userId <> viewer)
// - not the same trivia the viewer themselves AUTHORED. The `userId <> viewer`
//   guard only covers questions GENERATED for the viewer; a question the viewer
//   *wrote* lives in the canonical `questions` table (creatorId = viewer), never
//   in the generated bank, so an independently-generated bank row about the same
//   fact would otherwise be served straight back to its author — e.g. the +2
//   bonus handing you a question you composed and sent a friend (reported
//   2026-06). `avoidQuestionTexts` lets the caller pass the viewer's authored
//   question texts so those rows are skipped here.
// - not suppressed as an embedding near-duplicate (is_duplicate; B3)
// - fact_key not already in the viewer's recent avoid set
//
// Durability (B1 pool substrate / PRD-D-5 §5.1, D8): the bank no longer excludes
// questions by age — nothing decays out, so thin domains stop drying up. Recency
// still *ranks*: we draw a newest-first window and shuffle within it, so when a
// domain has plenty of recent rows the result matches the prior "random among
// recent" behavior, and only falls back to older rows when recent ones run out.
//
// Returns null when the bank is empty for this domain+difficulty — caller
// falls back to fresh LLM generation, which incidentally grows the bank.
const BANK_RECENCY_WINDOW = 50;

// Canonical form for cross-table question-text matching (bank row text vs. a
// viewer-authored canonical question). Mirrors the queue-orchestrator's own
// dedup normalization (trim + lowercase) so the two stay consistent.
export function normalizeQuestionText(text: string): string {
  return text.trim().toLowerCase();
}

// Pure servability check for a bank candidate (extracted for testing). A row is
// servable only if it has a fact_key (older rows lack one), its fact_key isn't
// in the viewer's recent avoid set, and its text isn't one the viewer authored
// (`avoidQuestionTexts`). Keeping this pure lets the loop in pickBankSource stay
// a thin DB shell while the routing rule itself is unit-tested.
export function isBankRowServable(
  row: { factKey: string | null; questionText: string },
  avoidFactKeys: ReadonlySet<string>,
  avoidQuestionTexts: ReadonlySet<string>,
): boolean {
  if (!row.factKey) return false;
  if (avoidFactKeys.has(row.factKey)) return false;
  // Never serve the viewer trivia they themselves authored — fact_key won't
  // catch it (authored canonical questions have no fact_key), so match on text.
  if (avoidQuestionTexts.has(normalizeQuestionText(row.questionText))) return false;
  return true;
}

// Q5 ranking (BP-7): trust-ranked, dud-excluded candidate ordering for the
// bank. Exported pure so the rule is unit-testable without a DB.
// - Excludes "nobody got it" stock (empiricalCorrectRate === 0 with
//   nAnswered ≥ DUD_MIN_ANSWERS) — the D11 hallucination smell, computed but
//   previously unused at selection time. Exclusion only ever FILTERS: an
//   emptied set returns [] and the caller falls through to generation, so dud
//   stock can never starve a domain toward the 503 path.
// - Ranks author_confirmed > human_validated > machine_verified > unverified,
//   shuffling WITHIN each rank (Fisher–Yates then stable sort) so selection
//   stays varied without becoming quality-blind.
const DUD_MIN_ANSWERS = 5;
const TRUST_RANK: Record<TrustTier, number> = {
  unverified: 0,
  machine_verified: 1,
  human_validated: 2,
  author_confirmed: 3,
};

export function rankAndFilterBankCandidates<
  T extends { trustTier: string; empiricalCorrectRate: number | null; nAnswered: number },
>(rows: readonly T[]): { ranked: T[]; dudsExcluded: number } {
  const kept = rows.filter(
    (row) => !(row.empiricalCorrectRate === 0 && row.nAnswered >= DUD_MIN_ANSWERS),
  );
  const dudsExcluded = rows.length - kept.length;
  const ranked = [...kept];
  for (let i = ranked.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [ranked[i], ranked[j]] = [ranked[j], ranked[i]];
  }
  // Array.prototype.sort is stable, so equal-rank rows keep their shuffled order.
  ranked.sort(
    (a, b) => (TRUST_RANK[b.trustTier as TrustTier] ?? 0) - (TRUST_RANK[a.trustTier as TrustTier] ?? 0),
  );
  return { ranked, dudsExcluded };
}

export async function pickBankSource(
  userId: string,
  domain: string,
  difficulty: BankDifficulty,
  avoidFactKeys: ReadonlySet<string>,
  avoidQuestionTexts: ReadonlySet<string> = new Set(),
): Promise<BankSource | null> {
  let candidates: Array<typeof generatedQuestions.$inferSelect>;
  try {
    candidates = await db
      .select()
      .from(generatedQuestions)
      .where(and(
        // BP-7 / C5: match on the folded domain_key (written by domainKey() at
        // every pool insert) so spelling variants of one domain share stock —
        // with the legacy exact-string predicate as the fallback for rows that
        // pre-date the 0074 backfill. No age predicate: the pool is durable
        // (D8) — recency only biases the window below, it never excludes.
        or(
          eq(generatedQuestions.domainKey, domainKey(domain)),
          eq(generatedQuestions.canonicalSubcategory, domain),
        ),
        eq(generatedQuestions.difficultyEstimate, difficulty),
        isNotNull(generatedQuestions.factKey),
        sql`${generatedQuestions.userId} <> ${userId}`,
        eq(generatedQuestions.isDuplicate, false),
        // B-Report-3: skip generated questions under an open/upheld report.
        notSuppressedByContentReport(generatedQuestions.id, 'generated'),
      ))
      .orderBy(desc(generatedQuestions.createdAt))
      .limit(BANK_RECENCY_WINDOW);
  } catch (error) {
    // Tolerate the brief window where a newly-added column is missing
    // (sub_angles in 0055; is_duplicate in 0062; domain_key in 0074): a hard
    // failure here would silently disable the entire bank-pick path until the
    // migration lands.
    if (pgErrorCode(error) === '42703') return null;
    throw error;
  }

  // Tier-gate (B4 Phase 3): self-practice may only serve tier ≥ machine_verified.
  // Off by default — shadow-logs the would-filter count and serves today's set
  // until the enforcement flag is flipped.
  candidates = applyTierGate(
    'self-practice/bank',
    candidates,
    (row) => row.trustTier as TrustTier,
    SELF_PRACTICE_TIERS,
  ).rows;

  // Q5: dud-excluded, trust-ranked, shuffled within rank (see helper above).
  // BANK_RECENCY_WINDOW stays 50: duds should be rare, the window is per
  // domain+tier, and tier-adjacent fallback (BP-7) already widens effective
  // reach — revisit with the bank-telemetry hit-rate data, not by guessing.
  const { ranked, dudsExcluded } = rankAndFilterBankCandidates(candidates);
  if (dudsExcluded > 0) {
    console.info('[daily/bank] excluded dud stock (nobody-got-it, D11)', {
      domain,
      difficulty,
      dudsExcluded,
    });
  }

  for (const row of ranked) {
    if (!isBankRowServable(row, avoidFactKeys, avoidQuestionTexts)) continue;
    // isBankRowServable guarantees a non-null factKey; this narrows it for TS.
    if (!row.factKey) continue;
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
      insideJoke: row.insideJoke ?? null,
      trustTier: row.trustTier as TrustTier,
      askToAnswerVerified: row.askToAnswerVerified ?? false,
      acceptableVariants: Array.isArray(row.acceptableVariants) ? row.acceptableVariants : [],
      sourceRefs: Array.isArray(row.sourceRefs) ? row.sourceRefs : [],
      perishable: row.perishable ?? false,
    };
  }
  return null;
}

// Counts of recent generations per canonical_subcategory for a user, scoped
// to a lookback window. Used by `selectDiverseDomains` to deprioritise
// over-saturated domains so a user with 10 active interests doesn't see
// the same 2-3 domains every day.
//
// The map is keyed by domainKey() — the same apostrophe-folded, whitespace-
// collapsed, lowercased key the knowledge/mastery code uses — so that spelling
// variants of one subcategory ("90's Hip-Hop" / "90’s Hip-Hop", "T.S. Eliot" /
// "T. S. Eliot", "Jazz" / "jazz") collapse into a single bucket. Without this
// fold each variant counts separately, so the weekly cap and least-recent
// ordering treat them as distinct domains and the cooldown silently leaks.
// Callers must look up with domainKey(domain) to match.
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

  // SQL groups by the raw column, so two spelling variants arrive as separate
  // rows; sum them into the one canonical key here.
  const result = new Map<string, number>();
  for (const row of rows) {
    if (!row.domain) continue;
    const key = domainKey(row.domain);
    result.set(key, (result.get(key) ?? 0) + (Number(row.count) || 0));
  }
  return result;
}

// Recently-answered CANONICAL question texts for a user (BP-6 / audit Q8).
// Canonical questions reached socially — a friend's authored question via a
// feed send or a milestone click-through, a forwarded curated question, a
// house question — carry NO fact_key, so they never enter the fact-key avoid
// set and the generator can re-create the same fact the player answered
// yesterday. This read feeds those texts into the ADVISORY avoid list (the
// prompt block + the Haiku history gate window); it does not add any new hard
// enforcement path. Rows with source='daily_generated' are excluded: their
// texts are the persisted twins of generated rows the viewer's existing
// avoid list already covers.
//
// Windowed and capped (C3: the avoid lists are already the prompt's biggest
// cost); callers additionally scope the fold to the round's domains.
export type AnsweredCanonicalTextEntry = { domain: string; text: string };

export async function getRecentAnsweredCanonicalTexts(
  userId: string,
  windowDays = 30,
  limit = 100,
): Promise<AnsweredCanonicalTextEntry[]> {
  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
  const rows = await db
    .select({
      domain: canonicalQuestions.canonicalSubcategory,
      text: canonicalQuestions.questionText,
    })
    .from(masteryEvents)
    .innerJoin(canonicalQuestions, eq(masteryEvents.questionId, canonicalQuestions.id))
    .where(and(
      eq(masteryEvents.answeredByUserId, userId),
      isNotNull(masteryEvents.questionId),
      gte(masteryEvents.createdAt, since),
      sql`${canonicalQuestions.source} <> 'daily_generated'`,
      isNull(canonicalQuestions.deletedAt),
    ))
    .orderBy(desc(masteryEvents.createdAt))
    .limit(limit);

  const out: AnsweredCanonicalTextEntry[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (!row.text) continue;
    const key = normalizeQuestionText(row.text);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ domain: row.domain ?? 'unknown', text: row.text });
  }
  return out;
}

// Counts of recent SKIPS ("passes") per canonical_subcategory for a user,
// scoped to a lookback window. Feeds the generation prompt's skip-calibration
// block (buildUserPrompt's `domainSkips`): a domain the player keeps passing
// on gets a "use a different sub-angle / kind of fact" instruction rather
// than more of the same. The block existed since the prompt was written but
// was never wired to this data (audit 2026-06-10, finding Q3a).
//
// Keyed by domainKey() — same fold as getRecentDomainCounts above, for the
// same spelling-variant reason. Callers must look up with domainKey(domain).
export async function getRecentSkipCountsByDomain(
  userId: string,
  lookbackDays = 7,
): Promise<Map<string, number>> {
  const since = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000);
  const rows = await db
    .select({
      domain: skippedDailyQuestions.canonicalSubcategory,
      count: sql<number>`count(*)::int`,
    })
    .from(skippedDailyQuestions)
    .where(and(
      eq(skippedDailyQuestions.userId, userId),
      gte(skippedDailyQuestions.skippedAt, since),
    ))
    .groupBy(skippedDailyQuestions.canonicalSubcategory);

  const result = new Map<string, number>();
  for (const row of rows) {
    if (!row.domain) continue;
    const key = domainKey(row.domain);
    result.set(key, (result.get(key) ?? 0) + (Number(row.count) || 0));
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

// Question texts the viewer has AUTHORED (canonical `questions`, creator =
// viewer). The +2 bonus (and any bank reuse) must never serve a fact the viewer
// personally wrote a question about — they obviously know it, and being handed
// your own composed-and-sent question reads as a routing bug (reported 2026-06).
// The other bonus avoid lists (getRecentDailyQuestionTexts / getRecentFactKeys)
// read only generatedQuestions where userId = viewer, so authored questions —
// which live in the canonical table and never in the generated bank — slip
// through. Returned in the RecentDailyQuestionEntry shape so it composes
// directly with the generation avoid list (the semantic Haiku dedupe gate then
// also catches re-wordings); the bank pick matches the same texts verbatim.
export async function getAuthoredQuestionTexts(
  userId: string,
  limit = 500,
): Promise<RecentDailyQuestionEntry[]> {
  const rows = await db
    .select({
      questionText: canonicalQuestions.questionText,
      domain: canonicalQuestions.canonicalSubcategory,
    })
    .from(canonicalQuestions)
    .where(and(
      eq(canonicalQuestions.creatorId, userId),
      isNull(canonicalQuestions.deletedAt),
    ))
    .orderBy(desc(canonicalQuestions.createdAt))
    .limit(limit);

  return rows.map((row) => ({
    domain: row.domain ?? 'unknown',
    text: row.questionText,
  }));
}

export async function getAnsweredDailyCount(queue: DailyQueueRow): Promise<number> {
  return asQueueSlots(queue.slots).filter((slot) => slot.answered).length;
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
