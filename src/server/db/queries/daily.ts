import {
  and,
  asc,
  cosineDistance,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  ne,
  or,
  sql,
} from 'drizzle-orm';

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
import type { GradableQuestionType } from '@/server/grading';
import { getActiveDeclaredInterests } from '@/server/db/queries/declared-interests';
import { getDailyPreferences } from '@/server/db/queries/daily-preferences';
import {
  notBlockedGeneratedByContentReport,
  notSuppressedByContentReport,
} from '@/server/db/queries/content-reports';
import { notBlocked } from '@/server/feed/visibility';
import { pgErrorCode } from '@/server/db/pg-error';
import {
  CATEGORIES,
  categoryLabel,
  HOUSE_AUTHOR,
  resolveAuthorDisplay,
} from '@/lib/questions-types';
import {
  CATCHUP_LOOKBACK_DAYS,
  asQueueSlots,
  dailyQueueItemId,
  feedCatchupItemId,
  minusUtcDays,
} from '@/server/daily/catchup';
import { DAILY_QUEUE_SIZE, type QueueSlot } from '@/server/daily/types';
import { answerCooldownKey } from '@/server/daily/answer-cooldown';
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
import { dedupeCatchUpItems, orderCatchUpItems } from '@/server/play/catch-up-turn-sequencing';
import { getBasePoints } from '@/server/mastery/scoring';
import { isGenericSubcategory } from '@/server/questions/canonical-subcategory';
import { domainKey } from '@/lib/knowledge/domain-key';
import { masteryDomainFeedsRotation } from '@/lib/knowledge/rotation-eligibility';

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
   * The grader's leniency policy branches on this — 'personal' questions grade
   * against the creator's intended answer. Canonical (friend-authored) items
   * carry the stored Question.question_type; daily-generated items are
   * 'factual' by construction (generatedQuestions has no question_type column).
   */
  questionType: GradableQuestionType;
  /**
   * Display name of the human author, when one exists. Null for LLM-origin
   * questions (daily-generated, or curated_sent feed items with no creator) —
   * the client renders the non-person LLM_QUESTION_ATTRIBUTION label for those
   * rather than implying a person wrote it.
   */
  authorName: string | null;
  /**
   * Human author's `users.id`, so the recap can link the name to their profile
   * (parity with the daily-five summary's `authorId`). Null for house/editorial
   * and LLM-origin questions, which have no `users.id` to link to.
   */
  authorId: string | null;
  /**
   * D-3: the author is the non-human house/editorial author. `authorName` is the
   * house name ('Joshing') and the client renders the persistent Editorial badge
   * with no relational copy. Set explicitly (not inferred from the name string).
   */
  authorIsHouse: boolean;
  /**
   * The target a content report (incorrect / inappropriate) points at, mirroring
   * daily-summary and archive. Exactly one id is set — curated/bank and feed
   * questions carry `questionId` (a `questions.id`), LLM-origin daily questions
   * carry `generatedQuestionId` (a `generatedQuestions.id`). The flat `questionId`
   * field above can't disambiguate the two FK targets, so the report path reads
   * this instead of guessing.
   */
  reportTarget:
    | { questionId: string; generatedQuestionId?: undefined }
    | { generatedQuestionId: string; questionId?: undefined };
};

export type CatchupQuestion = CatchupQueueItem;

function normalizeDomain(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

export type ScopedExclusions = {
  subcategories: Set<string>;
  broadCategories: Set<string>;
};

// Exported for the queue orchestrator: custom-mode selection is constrained to
// the player's explicit selectedDomains list, which getKnowledgeBase never
// touches, so exclusions (permanent Mutes and active Rests) must be re-applied
// there directly. Returns only ACTIVE exclusions (expired Rests already dropped).
export async function getExcludedKnowledgeDomains(userId: string): Promise<ScopedExclusions> {
  // D-DOMAIN-REST-01: a row only excludes while it is ACTIVE — permanent mutes
  // (rest_until IS NULL) always, and Rest rows only until their expiry. An
  // expired Rest simply stops matching here, so the domain returns to
  // circulation on the next queue build with no cron. Evaluated in SQL against
  // now() so it's consistent with the DB clock.
  const activeExclusion = and(
    eq(userDomainExclusions.userId, userId),
    or(isNull(userDomainExclusions.restUntil), sql`${userDomainExclusions.restUntil} > now()`),
  );
  let rows: { domain: string; scope: 'subcategory' | 'broad_category' | 'category' }[];
  try {
    rows = await db
      .select({
        domain: userDomainExclusions.canonicalSubcategory,
        scope: userDomainExclusions.scope,
      })
      .from(userDomainExclusions)
      .where(activeExclusion);
  } catch (error) {
    if (pgErrorCode(error) === '42P01')
      return { subcategories: new Set(), broadCategories: new Set() };
    // 42703 = the scope OR rest_until column is missing on a database where the
    // additive migration (0036 / 0124) hasn't landed yet. Fall back to a
    // scope='subcategory', treat-all-as-permanent read so the feature degrades
    // to its pre-migration behavior instead of failing. No Rest rows can exist
    // before 0124, so treating every row as active is correct in that window.
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
      const knownCategories = categoryEnums.filter((value): value is (typeof CATEGORIES)[number] =>
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
    .where(
      and(
        eq(masteryEvents.userId, userId),
        inArray(masteryEvents.sourceType, ['live_correct', 'catchup_correct']),
      ),
    )
    .groupBy(masteryEvents.canonicalSubcategory);

  return new Map(
    rows.map((row) => [normalizeDomain(row.domain).toLowerCase(), Number(row.count ?? 0)]),
  );
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
        rotationEligible: playerMastery.rotationEligible,
      })
      .from(playerMastery)
      .where(eq(playerMastery.userId, userId))
      .orderBy(asc(playerMastery.canonicalSubcategory));
  } catch (error) {
    if (pgErrorCode(error) !== '42703') throw error;

    // territory_type and/or rotation_eligible not present yet (pre-migration on a
    // partially-recorded DB). Fail open: every domain stays demonstrated and
    // rotation-eligible, i.e. the pre-B-DOMAIN-BONUS-ROTATION-01 behaviour.
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

    return rows.map((row) => ({
      ...row,
      territoryType: 'demonstrated' as const,
      rotationEligible: true,
    }));
  }
}

export async function getKnowledgeBase(userId: string): Promise<KnowledgeBaseDomain[]> {
  const [masteryRows, declaredRows, excludedDomains, correctCountsByDomain, preferences] =
    await Promise.all([
      getPlayerMasteryKnowledgeRows(userId),
      getActiveDeclaredInterests(userId),
      getExcludedKnowledgeDomains(userId),
      getCorrectAnswerCountsByDomain(userId),
      getDailyPreferences(userId),
    ]);

  const isExcluded = (domain: string, broadCategory: string | null): boolean => {
    if (excludedDomains.subcategories.has(domain.toLowerCase())) return true;
    if (broadCategory && excludedDomains.broadCategories.has(broadCategory.toLowerCase()))
      return true;
    return false;
  };

  // B-DOMAIN-BONUS-ROTATION-01: a demonstrated domain first opened by a +2 bonus
  // answer carries rotation_eligible=false. It may still feed the core five if the
  // player has since DECLARED it or ADOPTED it — set any non-resting frequency
  // (Often / Sometimes / Blue Moon) on the bonus reveal card. Keys are lowercased
  // to match the rest of this function.
  const declaredKeys = new Set(
    declaredRows.map((row) => normalizeDomain(row.domain).toLowerCase()).filter(Boolean),
  );
  const adoptedKeys = new Set(
    Object.entries(preferences.domainPreferenceFrequency)
      .filter(([, frequency]) => frequency !== 'resting')
      .map(([domain]) => domain.toLowerCase()),
  );

  const domainsByKey = new Map<string, KnowledgeBaseDomain>();

  for (const row of masteryRows) {
    const domain = normalizeDomain(row.domain);
    if (!domain) continue;
    const key = domain.toLowerCase();
    if (isExcluded(domain, row.broadCategory)) continue;
    // Park a bonus-only domain out of the core rotation until adopted or declared.
    // Existing/legacy rows are rotation_eligible=true (column default) and so are
    // never skipped here.
    if (
      !masteryDomainFeedsRotation({
        rotationEligible: row.rotationEligible,
        declared: declaredKeys.has(key),
        adopted: adoptedKeys.has(key),
      })
    ) {
      continue;
    }
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
 * Overwrite each slot's denormalized `question_text` with the live text from
 * its source row (GeneratedQuestion or canonical Question). Slots snapshot the
 * text at assignment time, so an admin edit made after assignment never reaches
 * the player otherwise — but grading always resolves the live row, so serving
 * the snapshot risks grading against an answer the displayed question no longer
 * asks for. Read-time only (nothing is persisted); a slot whose source row is
 * gone keeps its snapshot, which is also why history surfaces (archive,
 * summary, content reports) deliberately stay snapshot-first.
 */
export async function refreshQueueSlotQuestionTexts(slots: QueueSlot[]): Promise<QueueSlot[]> {
  const generatedIds = [
    ...new Set(
      slots.map((slot) => slot.generated_question_id).filter((id): id is string => Boolean(id)),
    ),
  ];
  const canonicalIds = [
    ...new Set(
      slots
        .filter((slot) => !slot.generated_question_id)
        .map((slot) => slot.question_id)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  if (generatedIds.length === 0 && canonicalIds.length === 0) return slots;

  const [generatedRows, canonicalRows] = await Promise.all([
    generatedIds.length > 0
      ? db
          .select({ id: generatedQuestions.id, questionText: generatedQuestions.questionText })
          .from(generatedQuestions)
          .where(inArray(generatedQuestions.id, generatedIds))
      : Promise.resolve<{ id: string; questionText: string }[]>([]),
    canonicalIds.length > 0
      ? db
          .select({ id: canonicalQuestions.id, questionText: canonicalQuestions.questionText })
          .from(canonicalQuestions)
          .where(inArray(canonicalQuestions.id, canonicalIds))
      : Promise.resolve<{ id: string; questionText: string }[]>([]),
  ]);
  const liveTextById = new Map(
    [...generatedRows, ...canonicalRows]
      .filter((row) => row.questionText)
      .map((row) => [row.id, row.questionText]),
  );

  return slots.map((slot) => {
    const sourceId = slot.generated_question_id ?? slot.question_id;
    const liveText = sourceId ? liveTextById.get(sourceId) : undefined;
    return liveText && liveText !== slot.question_text
      ? { ...slot, question_text: liveText }
      : slot;
  });
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

/** Atomically claim this queue's one allowed daily SMS reminder. */
export async function claimDailySmsReminder(queueId: string): Promise<boolean> {
  const claimed = await db
    .update(dailyQueues)
    .set({ smsReminderSentAt: new Date() })
    .where(and(eq(dailyQueues.id, queueId), isNull(dailyQueues.smsReminderSentAt)))
    .returning({ id: dailyQueues.id });

  return claimed.length > 0;
}

/** Release a failed SMS claim so a later cron pass can retry delivery. */
export async function releaseDailySmsReminder(queueId: string): Promise<void> {
  await db.update(dailyQueues).set({ smsReminderSentAt: null }).where(eq(dailyQueues.id, queueId));
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
    .where(
      and(
        eq(dailyQueues.userId, userId),
        lte(dailyQueues.queueDate, assignmentDateStr),
        gte(dailyQueues.queueDate, oldestEligible),
      ),
    );

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
    .where(
      and(
        eq(dailyQueues.userId, userId),
        lt(dailyQueues.queueDate, assignmentDateStr),
        gte(dailyQueues.queueDate, oldestEligible),
      ),
    )
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
 * The most recent prior daily queue still inside the catch-up window — the row the
 * carry-forward / top-up paths reconcile against. Shared by the orchestrator's
 * partial/short top-up path (carryForwardUntouchedDailyQueue keeps its own inline
 * copy of this query for the full-untouched case).
 */
export async function getPriorInWindowDailyQueue(userId: string): Promise<DailyQueueRow | null> {
  const { assignmentDateStr } = getDailyAssignmentBounds();
  const oldestEligible = minusUtcDays(assignmentDateStr, CATCHUP_LOOKBACK_DAYS);
  const [prior] = await db
    .select()
    .from(dailyQueues)
    .where(
      and(
        eq(dailyQueues.userId, userId),
        lt(dailyQueues.queueDate, assignmentDateStr),
        gte(dailyQueues.queueDate, oldestEligible),
      ),
    )
    .orderBy(desc(dailyQueues.queueDate))
    .limit(1);
  return prior ?? null;
}

/**
 * Re-date a prior in-window queue onto today with a REPLACED slots array — the
 * top-up sibling of carryForwardUntouchedDailyQueue. The orchestrator builds the
 * merged set (the prior queue's unplayed slots + freshly generated top-up slots),
 * then calls this to land it on today's date IN PLACE, so the carried questions
 * move out of catch-up and into today's Five without a second row (no double
 * surface). Mirrors carry-forward's empty-today cleanup + first-writer-wins (23505)
 * handling, and flags the freshly generated questions usedInQueue. Returns false
 * (writing nothing) if a full today-queue won the race.
 */
export async function carryForwardQueueWithSlots(
  userId: string,
  priorQueueId: string,
  slots: QueueSlot[],
  newGeneratedQuestionIds: string[],
): Promise<boolean> {
  const { assignmentDateStr } = getDailyAssignmentBounds();

  const today = await getTodaysDailyQueue(userId);
  if (today && asQueueSlots(today.slots).length > 0) return false;
  if (today) {
    await db.delete(dailyQueues).where(eq(dailyQueues.id, today.id));
  }

  try {
    await db.transaction(async (tx) => {
      await tx
        .update(dailyQueues)
        .set({ queueDate: assignmentDateStr, slots })
        .where(eq(dailyQueues.id, priorQueueId));
      if (newGeneratedQuestionIds.length > 0) {
        await tx
          .update(generatedQuestions)
          .set({ usedInQueue: true })
          .where(inArray(generatedQuestions.id, newGeneratedQuestionIds));
      }
    });
    return true;
  } catch (error) {
    // 23505: a today-row was created concurrently — let the caller fall through.
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

  return db.select().from(generatedQuestions).where(inArray(generatedQuestions.id, generatedIds));
}

// Resolve creator display names for a set of (possibly null/duplicate) creator
// ids, returning a id→name map. Null/absent ids are skipped — their questions
// are LLM-origin and the client labels them non-relationally.
export async function resolveCreatorNames(
  creatorIds: Array<string | null>,
): Promise<Map<string, string | null>> {
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
  const [queues, preferences] = await Promise.all([
    db
      .select()
      .from(dailyQueues)
      .where(and(eq(dailyQueues.userId, userId), lte(dailyQueues.queueDate, assignmentDateStr)))
      .orderBy(asc(dailyQueues.queueDate)),
    getDailyPreferences(userId),
  ]);

  // Resting is the strongest "not now / not mine" signal a player can set on a
  // domain. The "This is {Name}'s bag but not mine" opt-out on a +2 bonus rests
  // the whole domain (via the domain-frequency route), and every other daily-
  // selection surface — rotation, authored picks, house picks — already excludes
  // rested domains (see resting-domains.test.ts). Catch-up was the one daily
  // surface still replaying them, so a rested domain's missed questions kept
  // nagging in "Catch up" — the exact "someone else's bag shouldn't come back as
  // a missed question for me" complaint. Drop rested domains here too, keyed on
  // the same normalized domain the preference is stored under.
  const restingKeys = new Set(
    Object.entries(preferences.domainPreferenceFrequency)
      .filter(([, frequency]) => frequency === 'resting')
      .map(([domain]) => normalizeDomain(domain).toLowerCase())
      .filter(Boolean),
  );
  const isRestingDomain = (domain: string | null | undefined): boolean =>
    typeof domain === 'string' && restingKeys.has(normalizeDomain(domain).toLowerCase());

  const candidateSlots = queues.flatMap((queue) =>
    asQueueSlots(queue.slots)
      .filter(
        (slot) =>
          isCatchUpQueueDateEligible(String(queue.queueDate), assignmentDateStr) &&
          isCatchUpSlotEligible(slot) &&
          !isRestingDomain(slot.domain),
      )
      .map((slot) => ({ queue, slot })),
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
          .where(
            and(
              eq(generatedQuestions.userId, userId),
              inArray(generatedQuestions.id, generatedIds),
              // Terminal hard-block for LLM-origin content: an upheld-inappropriate
              // report is the generated equivalent of visibility='blocked'.
              notBlockedGeneratedByContentReport(generatedQuestions.id),
            ),
          )
      : Promise.resolve<(typeof generatedQuestions.$inferSelect)[]>([]),
    canonicalIds.length > 0
      ? db
          .select()
          .from(canonicalQuestions)
          .where(
            and(
              inArray(canonicalQuestions.id, canonicalIds),
              // Safety hard-block: a question blocked after assignment (cron re-vet,
              // upheld report) must not resurface in catch-up.
              notBlocked(),
              // AUTHORSHIP-EXCLUSION INVARIANT (B-CRAFTER-LIFECYCLE-01 Phase 3):
              // never serve the viewer their own authored question. Structurally
              // catch-up replays the viewer's own assigned slots (you aren't
              // assigned your own questions), but with player authoring live the
              // explicit predicate is load-bearing. NULL creators (house/LLM)
              // must still pass — hence the isNull arm.
              or(isNull(canonicalQuestions.creatorId), ne(canonicalQuestions.creatorId, userId)),
            ),
          )
      : Promise.resolve<(typeof canonicalQuestions.$inferSelect)[]>([]),
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
          // Live text first: catch-up items are still answerable, and the
          // answer/explainer beside them are read live — a post-assignment
          // admin edit must reach the text too, or the player is graded
          // against an answer the displayed question no longer asks for.
          // The slot snapshot is only a fallback for a vanished row.
          questionText: question.questionText || slot.question_text,
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
          // generatedQuestions has no question_type column — factual by construction.
          questionType: 'factual',
          authorName: null, // daily-generated: LLM origin, no human author
          authorId: null,
          authorIsHouse: false,
          reportTarget: { generatedQuestionId: slot.generated_question_id },
        } satisfies CatchupQuestion;
      }

      if (!slot.question_id) return null;
      const question = canonicalById.get(slot.question_id);
      if (!question || question.deletedAt) return null;
      const domain =
        slot.domain || question.canonicalSubcategory || question.broadCategory || question.category;
      if (!domain || isGenericSubcategory(domain)) return null;
      const difficulty =
        asQueueSlotDifficulty(
          question.calibratedDifficulty ??
            question.llmDifficulty ??
            question.difficultyEstimate ??
            null,
        ) ?? null;
      const explanation =
        question.explainerFullWrong ??
        question.explainerFull ??
        question.explainerBrief ??
        question.factualExplanation ??
        null;
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
        // Live-first for the same reason as the generated branch above.
        questionText: question.questionText || slot.question_text,
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
        questionType: question.questionType,
        authorId: question.creatorId ?? null,
        ...resolveAuthorDisplay(
          question.creatorId,
          question.source,
          question.creatorId ? (authorNameById.get(question.creatorId) ?? null) : null,
        ),
        reportTarget: { questionId: slot.question_id },
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

  let rows: Array<{
    feedItem: typeof feedItems.$inferSelect;
    question: typeof canonicalQuestions.$inferSelect;
  }>;
  try {
    rows = await db
      .select({ feedItem: feedItems, question: canonicalQuestions })
      .from(feedItems)
      .innerJoin(canonicalQuestions, eq(feedItems.questionId, canonicalQuestions.id))
      .where(
        and(
          eq(feedItems.recipientUserId, userId),
          eq(feedItems.state, 'answered'),
          eq(feedItems.answerResult, 'incorrect'),
          isNull(feedItems.catchupResolvedAt),
          gte(feedItems.sourceEventAt, oldestDate),
          // Safety hard-block: a question blocked after the original answer
          // (cron re-vet, upheld report) must not resurface in catch-up.
          ne(canonicalQuestions.visibility, 'blocked'),
          // AUTHORSHIP-EXCLUSION INVARIANT (B-CRAFTER-LIFECYCLE-01 Phase 3):
          // never serve the viewer their own authored question, even via a feed
          // replay. NULL creators (house/LLM) still pass.
          or(isNull(canonicalQuestions.creatorId), ne(canonicalQuestions.creatorId, userId)),
        ),
      )
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
      const difficulty =
        asQueueSlotDifficulty(
          question.calibratedDifficulty ??
            question.llmDifficulty ??
            question.difficultyEstimate ??
            null,
        ) ?? null;
      const basePoints = getBasePoints(difficulty, 'first_correct');
      const explanation =
        question.explainerFullWrong ??
        question.explainerFull ??
        question.explainerBrief ??
        question.factualExplanation ??
        null;
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
        questionType: question.questionType,
        authorId: question.creatorId ?? null,
        ...resolveAuthorDisplay(
          question.creatorId,
          question.source,
          question.creatorId ? (authorNameById.get(question.creatorId) ?? null) : null,
        ),
        reportTarget: { questionId: question.id },
      } satisfies CatchupQuestion;
    })
    .filter((item): item is CatchupQuestion => Boolean(item));
}

/**
 * Pure QueueSlot builder for a bot (LLM-generated) core slot. Extracted so the
 * orchestrator can assemble the whole queue in memory and persist it atomically
 * (persistDailyQueue) instead of one transaction per slot. The structural param
 * type accepts a full GeneratedQuestionRow.
 */
export function buildBotSlot(
  question: {
    id: string;
    questionText: string;
    canonicalSubcategory: string;
    broadCategory: string | null;
    difficultyEstimate: string | null;
  },
  position: number,
): QueueSlot {
  return {
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
    .where(
      and(
        eq(generatedQuestions.id, generatedQuestionId),
        eq(generatedQuestions.userId, userId),
        isNotNull(generatedQuestions.id),
      ),
    )
    .limit(1);

  if (!question) {
    throw new Error('Generated question not found for user.');
  }

  const slot = buildBotSlot(question, position);

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

/**
 * Atomically persist a freshly-built Daily Five (core + bonus) as a SINGLE write.
 *
 * Why this exists (B-DAILY-PARTIAL-QUEUE-01): the per-slot createDailyQueueItem*
 * helpers each commit in their own transaction, and the +2 bonus is generated in
 * a separate later pass — so during a build the DailyQueue.slots JSONB is
 * observable in partial states. A concurrent GET /api/daily/queue could read 2 of
 * 6 slots and the player would play that partial set to "completion." Writing the
 * complete slots array in one statement closes that window: a reader sees either
 * the pre-build state or the whole queue, never an intermediate prefix.
 *
 * Concurrency guard — FIRST WRITER WINS (B-DAILY-QUEUE-SWAP-01): ON CONFLICT DO
 * NOTHING. Once a row exists for (user, queueDate), a second builder that raced
 * the first leaves it untouched and returns the existing queue. This is stronger
 * than the previous "overwrite an untouched row" rule, which clobbered a queue
 * that had been SERVED but not yet answered — the exact window the login pre-warm
 * (commit 09585230) opened: a returning user was served build A, and build B
 * (the background pre-warm) overwrote it with a different question set while they
 * were still reading question 1, so their answer 409'd as `slot_changed` and an
 * entirely new five appeared. Two concurrent builds are non-deterministic and
 * produce DIFFERENT sets, so the only safe rule is that whichever lands first
 * stands. The single legitimate "regenerate today" paths (preference change →
 * invalidateUntouchedDailyQueues, stale-short → clearStaleShortTodayQueue) DELETE
 * the row first, so they insert cleanly and never reach this conflict.
 *
 * The only cost of a lost race is one re-billed build whose questions are
 * discarded; the loser's generatedQuestionIds are intentionally NOT flagged
 * usedInQueue, since they never entered the persisted queue.
 */
export async function persistDailyQueue(
  userId: string,
  slots: QueueSlot[],
  generatedQuestionIds: string[],
): Promise<DailyQueueRow | null> {
  const { assignmentDateStr } = getDailyAssignmentBounds();
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(dailyQueues)
      // target_size is the builder's TARGET, not a measurement of what it
      // achieved. It is DAILY_QUEUE_SIZE, full stop -- the constant the fill
      // loop, the top-up rounds and borrow-back are all trying to reach.
      //
      // IT MUST NOT BE DERIVED FROM `slots`. An earlier cut wrote
      // getCoreSlots(slots).length, which is the ACHIEVED count, and that
      // reintroduces the defect 0137 was written to remove one layer down: a
      // build that misses and persists four core slots would record
      // target_size 4, and `answered >= target_size` would then read that
      // queue as COMPLETE at four answers. The under-delivery becomes the
      // target, and the short queue is certified rather than detected.
      //
      // Nothing would have caught that. On every healthy build intended and
      // achieved are both 5, so the two formulas are indistinguishable in
      // tests, in review, and in every row where the system worked -- they
      // diverge only on the builds this column exists to identify. Same shape
      // as `slot_index < 5` and as 0136's `target_size = actual_slots`.
      //
      // No build intends fewer than five: DAILY_QUEUE_MIN_SIZE is a tolerated
      // graceful-degrade FLOOR, not an intent, and a queue below five is always
      // a shortfall. If a build ever legitimately targets a smaller round, this
      // becomes a parameter -- but it still comes from the target, never the
      // array, because reading the array is what makes a failure look like a
      // plan.
      //
      // Written EXACTLY ONCE, here. The deferred bonus append never touches it.
      .values({
        userId,
        queueDate: assignmentDateStr,
        slots,
        targetSize: DAILY_QUEUE_SIZE,
      })
      .onConflictDoNothing({
        target: [dailyQueues.userId, dailyQueues.queueDate],
      })
      .returning();

    if (row && generatedQuestionIds.length > 0) {
      await tx
        .update(generatedQuestions)
        .set({ usedInQueue: true })
        .where(inArray(generatedQuestions.id, generatedQuestionIds));
    }

    if (row) return row;

    // Conflict hit an existing row, so DO NOTHING was a no-op and RETURNING
    // produced nothing. This build lost the race; hand back the queue that won
    // (unchanged) so the caller serves the one the player is already on.
    const [existing] = await tx
      .select()
      .from(dailyQueues)
      .where(and(eq(dailyQueues.userId, userId), eq(dailyQueues.queueDate, assignmentDateStr)))
      .limit(1);
    return existing ?? null;
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
/** Pure QueueSlot builder for a Daily Five +2 bonus slot (presence-attributed). */
export function buildPresenceSlot(
  question: {
    id: string;
    questionText: string;
    canonicalSubcategory: string;
    broadCategory: string | null;
    difficultyEstimate: string | null;
  },
  presence: BonusPresence,
  position: number,
): QueueSlot {
  return {
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
}

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
    .where(
      and(
        eq(generatedQuestions.id, generatedQuestionId),
        eq(generatedQuestions.userId, userId),
        isNotNull(generatedQuestions.id),
      ),
    )
    .limit(1);

  if (!question) {
    throw new Error('Generated bonus question not found for user.');
  }

  const slot = buildPresenceSlot(question, presence, position);

  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(dailyQueues)
      .where(and(eq(dailyQueues.userId, userId), eq(dailyQueues.queueDate, assignmentDateStr)))
      .limit(1);

    if (!existing) {
      const [created] = await tx
        .insert(dailyQueues)
        // No queue exists yet -- anomalous for a bonus append, since the
        // deferred path runs after persist. Stamp the target anyway so a queue
        // can never be born with a NULL target_size through a side door; the
        // build still intended five, it just has no core slots yet.
        .values({
          userId,
          queueDate: assignmentDateStr,
          slots: [slot],
          targetSize: DAILY_QUEUE_SIZE,
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
  subjectEntity: string | null;
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
  subjectEntity: string | null;
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
      .where(
        and(
          eq(masteryEvents.userId, viewerUserId),
          inArray(masteryEvents.sourceType, ['live_correct', 'catchup_correct']),
          isNotNull(masteryEvents.questionId),
        ),
      ),
    db
      .select({ questionId: feedItems.questionId })
      .from(feedItems)
      .where(and(eq(feedItems.recipientUserId, viewerUserId), isNotNull(feedItems.questionId))),
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
      subjectEntity: canonicalQuestions.subjectEntity,
      creatorNote: canonicalQuestions.creatorNote,
      publicEligibilityScore: canonicalQuestions.publicEligibilityScore,
      trustTier: canonicalQuestions.trustTier,
      createdAt: canonicalQuestions.createdAt,
    })
    .from(canonicalQuestions)
    .where(
      and(
        eq(canonicalQuestions.publicStatus, 'eligible_pending'),
        eq(canonicalQuestions.visibility, 'public'),
        isNotNull(canonicalQuestions.creatorId),
        isNotNull(canonicalQuestions.canonicalSubcategory),
        inArray(canonicalQuestions.canonicalSubcategory, [...allowedSubcategories]),
        isNull(canonicalQuestions.deletedAt),
        // B-Report-3: never draw a reported question into a new daily queue.
        notSuppressedByContentReport(canonicalQuestions.id, 'question'),
      ),
    )
    .orderBy(desc(canonicalQuestions.publicEligibilityScore), desc(canonicalQuestions.createdAt))
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
  const authorIds = [
    ...new Set(filtered.map((c) => c.row.creatorId).filter((id): id is string => Boolean(id))),
  ];
  const authorRows = await db
    .select({ id: users.id, displayName: users.displayName })
    .from(users)
    .where(inArray(users.id, authorIds));
  const nameById = new Map(authorRows.map((u) => [u.id, u.displayName] as const));

  return filtered.map(
    ({ row }) =>
      ({
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
        subjectEntity: row.subjectEntity ?? null,
        authorName: row.creatorId ? (nameById.get(row.creatorId) ?? null) : null,
        authorNote: row.creatorNote ?? null,
      }) satisfies AuthoredPick,
  );
}

/**
 * Inserts a vetted user-authored question into the viewer's daily queue
 * as a `source: 'friend'` slot. Counterpart to `createDailyQueueItem`,
 * which only handles bot-generated questions. The QueueSlot schema
 * already supports both shapes (src/server/daily/types.ts).
 */
/** Pure QueueSlot builder for a vetted user-authored ('friend') core slot. */
export function buildAuthoredSlot(authored: AuthoredPick, position: number): QueueSlot {
  return {
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
}

/**
 * Build an APPENDED missed-question return slot (D-MISSED-RETURN-01 §2 R3).
 *
 * The question is an existing canonical Question the viewer previously got wrong
 * or let expire, so this looks like an authored slot — same `source: 'friend'`,
 * same `question_id` — plus the `return_*` markers that designate it a return and
 * keep it out of the core five (see isReturnSlot / getCoreSlots).
 *
 * `return_last_seen_at` carries the honest provenance the return label needs
 * (R9): a wrong-scope return is visibly a return, never disguised as new. The
 * expired scope carries the field too (it is cheap and true) but its copy must
 * NOT use return framing — it has never been seen, so it reads as a normal
 * question arriving late (§2). That distinction is the renderer's job, on
 * `return_scope`, and it is the highest-risk surface in this build (§6).
 */
export function buildReturnSlot(
  question: ReturnSlotQuestion,
  candidate: {
    kind: 'canonical' | 'generated';
    scope: 'wrong' | 'expired';
    lastSeenAt: Date;
    returnCount: number;
  },
  position: number,
): QueueSlot {
  // The Daily Five serves both kinds and so does the return slot. A generated
  // question is source='bot' with generated_question_id (never question_id) —
  // getting this backwards would point the answer route at the wrong table and,
  // for the dismiss path, violate the FK.
  const isCanonical = candidate.kind === 'canonical';
  return {
    slot_index: position,
    source: isCanonical ? 'friend' : 'bot',
    question_id: isCanonical ? question.id : undefined,
    generated_question_id: isCanonical ? undefined : question.id,
    // LLM-origin questions have no human author; the client renders its own
    // non-person attribution for those rather than implying someone wrote it.
    author_id: isCanonical ? (question.creatorId ?? undefined) : undefined,
    author_name: isCanonical ? (question.authorName ?? null) : null,
    author_note: isCanonical ? (question.creatorNote ?? null) : null,
    return_scope: candidate.scope,
    return_last_seen_at: candidate.lastSeenAt.toISOString(),
    // 1-based: the return the player is about to see. Expired first appearances
    // stay at 0 + 1 = 1 but never advance the stored count (§2).
    return_count: candidate.returnCount + 1,
    domain:
      question.canonicalSubcategory ?? question.broadCategory ?? question.category ?? 'general',
    broad_category: question.broadCategory ?? null,
    category: question.category || null,
    question_text: question.questionText,
    difficulty_estimate: asQueueSlotDifficulty(question.difficultyEstimate) ?? undefined,
    answered: false,
    difficulty_stepped_up: false,
  };
}

export type ReturnSlotQuestion = {
  id: string;
  questionText: string;
  creatorId: string | null;
  authorName?: string | null;
  creatorNote?: string | null;
  canonicalSubcategory: string | null;
  broadCategory: string | null;
  category: string | null;
  difficultyEstimate: string | null;
};

export async function createDailyQueueItemFromAuthored(
  userId: string,
  authored: AuthoredPick,
  position: number,
): Promise<DailyQueueRow> {
  const { assignmentDateStr } = getDailyAssignmentBounds();

  const slot = buildAuthoredSlot(authored, position);

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
  subjectEntity: string | null;
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
    .map(
      (row) =>
        ({
          id: row.id,
          questionText: row.questionText,
          answerText: row.answerText,
          alternateAnswers: row.alternateAnswers ?? [],
          factualExplanation: row.factualExplanation,
          canonicalSubcategory: row.canonicalSubcategory ?? '',
          broadCategory: row.broadCategory,
          category: String(row.category ?? ''),
          difficultyEstimate: asQueueSlotDifficulty(row.difficultyEstimate ?? null) ?? null,
          subjectEntity: row.subjectEntity ?? null,
          authorNote: row.creatorNote ?? null,
        }) satisfies HousePick,
    );
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
      .where(
        and(
          eq(masteryEvents.userId, viewerUserId),
          inArray(masteryEvents.sourceType, ['live_correct', 'catchup_correct']),
          isNotNull(masteryEvents.questionId),
        ),
      ),
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
      subjectEntity: canonicalQuestions.subjectEntity,
      creatorNote: canonicalQuestions.creatorNote,
      trustTier: canonicalQuestions.trustTier,
      createdAt: canonicalQuestions.createdAt,
    })
    .from(canonicalQuestions)
    .where(
      and(
        eq(canonicalQuestions.source, 'house_authored'),
        isNull(canonicalQuestions.creatorId),
        eq(canonicalQuestions.visibility, 'public'),
        isNotNull(canonicalQuestions.canonicalSubcategory),
        inArray(canonicalQuestions.canonicalSubcategory, [...allowedSubcategories]),
        isNull(canonicalQuestions.deletedAt),
        // B-Report-3: a reported house question is suppressed from new queues too.
        notSuppressedByContentReport(canonicalQuestions.id, 'question'),
      ),
    )
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
  // B-LLM-PROVIDER-AB-SWITCH B3: carried so the serving copy keeps the
  // provider that originally generated this bank row.
  generatedByProvider: string | null;
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
    (a, b) =>
      (TRUST_RANK[b.trustTier as TrustTier] ?? 0) - (TRUST_RANK[a.trustTier as TrustTier] ?? 0),
  );
  return { ranked, dudsExcluded };
}

// Own-unused bank reuse (kill-switch, default ON). By default the bank serves
// only OTHER users' stock (cross-user reuse). At small scale with niche interests
// that pool is thin, so a queue burns fresh Sonnet calls even though the viewer's
// OWN over-provisioned / unfinished stock — rows persisted but never placed
// (used_in_queue = false) — sits serveable in the pool. Including them cuts fresh
// generation (fewer short queues, faster builds). Repeat-safe: used_in_queue flips
// true the instant a row is placed (persistDailyQueue), and the fact-key /
// question-text avoid sets below dedup anything already seen. Disable with
// BANK_INCLUDE_OWN_UNUSED=false.
function isBankIncludeOwnUnusedEnabled(): boolean {
  const raw = process.env.BANK_INCLUDE_OWN_UNUSED?.trim().toLowerCase();
  return !(raw === 'false' || raw === '0' || raw === 'no' || raw === 'off');
}

export async function pickBankSource(
  userId: string,
  domain: string,
  difficulty: BankDifficulty,
  avoidFactKeys: ReadonlySet<string>,
  avoidQuestionTexts: ReadonlySet<string> = new Set(),
): Promise<BankSource | null> {
  // Cross-user stock, plus (when enabled) the viewer's own never-served rows.
  const viewerClause = isBankIncludeOwnUnusedEnabled()
    ? or(
        sql`${generatedQuestions.userId} <> ${userId}`,
        and(eq(generatedQuestions.userId, userId), eq(generatedQuestions.usedInQueue, false)),
      )
    : sql`${generatedQuestions.userId} <> ${userId}`;

  let candidates: Array<typeof generatedQuestions.$inferSelect>;
  try {
    candidates = await db
      .select()
      .from(generatedQuestions)
      .where(
        and(
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
          viewerClause,
          eq(generatedQuestions.isDuplicate, false),
          // B-Report-3: skip generated questions under an open/upheld report.
          notSuppressedByContentReport(generatedQuestions.id, 'generated'),
          // Full-set dedup (D-SUPPLY-NEVER-REPEAT-01): exclude ANY row whose fact
          // the viewer has already answered, on any surface, however long ago —
          // the MASTERY_EVENTS → canonical-twin → fact_key bridge, enforced in
          // SQL so it cannot be capped. The in-memory avoidFactKeys set below
          // still covers same-build/batch avoidance, but it is built from the
          // recency-limited getRecentFactKeys (200) and a 445-fact history
          // already overflows it — this clause is the uncapped guarantee.
          sql`NOT EXISTS (
          SELECT 1 FROM "MASTERY_EVENTS" me
          JOIN "Question" cq ON me.question_id = cq.id
          JOIN "GeneratedQuestion" agq ON cq.generated_question_id = agq.id
          WHERE me.answered_by_user_id = ${userId}
            AND agq.fact_key = ${generatedQuestions.factKey}
        )`,
        ),
      )
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
      generatedByProvider: row.generatedByProvider ?? null,
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
    .where(and(eq(generatedQuestions.userId, userId), gte(generatedQuestions.createdAt, since)))
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
// Embedding-based per-user history dedup (B-DEDUP-SEMANTIC-01). The exact-
// question_id "already seen" filters above (pickEligibleAuthoredQuestions /
// pickHouseQuestions) miss a near-identical PARAPHRASE: a freshly generated
// question gets a brand-new id, so the same fact can be re-served weeks apart
// (observed 2026-06-21 — a "name the 1911 Triangle Shirtwaist factory" question
// re-served 16 days after the user answered an all-but-identical one; cosine
// 0.89). Returns the smallest cosine DISTANCE (1 - similarity) between
// `embedding` and any canonical question the user has already answered correctly
// (live or catch-up) within `sinceDays`, so the generator can drop candidates
// that are semantically a repeat. Returns null when the user has no embedded
// answered history in the window (no comparison possible → never drops). Reuses
// the same Voyage embeddings the pool dedup already stores on Question.embedding.
export async function getNearestAnsweredQuestionDistance(
  userId: string,
  embedding: number[],
  sinceDays: number,
): Promise<number | null> {
  const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);
  const distance = cosineDistance(canonicalQuestions.embedding, embedding);
  const [row] = await db
    .select({ distance })
    .from(masteryEvents)
    .innerJoin(canonicalQuestions, eq(masteryEvents.questionId, canonicalQuestions.id))
    .where(
      and(
        eq(masteryEvents.userId, userId),
        inArray(masteryEvents.sourceType, ['live_correct', 'catchup_correct']),
        isNotNull(masteryEvents.questionId),
        isNotNull(canonicalQuestions.embedding),
        isNull(canonicalQuestions.deletedAt),
        gte(masteryEvents.createdAt, since),
      ),
    )
    .orderBy(distance)
    .limit(1);
  return row ? Number(row.distance) : null;
}

/**
 * Answer-cooldown history (B-DEDUP-ANSWER-COOLDOWN, Tier 1). The set of
 * answerCooldownKey values for every canonical question this user answered
 * (live or catch-up) within `sinceDays` — feeds the serve-time answer-cooldown
 * gate so a fresh question whose answer the player just gave is deflected before
 * it reaches the queue. Mirrors getNearestAnsweredQuestionDistance's history
 * scope (same source types, same per-user `userId`) but keyed on the answer
 * string rather than the embedding, which is what catches exact-answer repeats
 * the 0.88 embedding gate lets through. Blank/generic answers fold to '' in
 * answerCooldownKey and are dropped here, so they never seed a false block.
 */
export async function getRecentAnsweredAnswerKeys(
  userId: string,
  sinceDays: number,
): Promise<Set<string>> {
  const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);
  const rows = await db
    .select({ answerText: canonicalQuestions.answerText })
    .from(masteryEvents)
    .innerJoin(canonicalQuestions, eq(masteryEvents.questionId, canonicalQuestions.id))
    .where(
      and(
        eq(masteryEvents.userId, userId),
        inArray(masteryEvents.sourceType, ['live_correct', 'catchup_correct']),
        isNotNull(masteryEvents.questionId),
        isNull(canonicalQuestions.deletedAt),
        gte(masteryEvents.createdAt, since),
      ),
    );
  const keys = new Set<string>();
  for (const row of rows) {
    const key = answerCooldownKey(row.answerText);
    if (key) keys.add(key);
  }
  return keys;
}

/**
 * Recent-entity history (B-DEDUP-SUBJECT-COOLDOWN, Tier 2). The set of entity
 * keys — folding BOTH the subject_entity and the answer of every canonical
 * question this user answered within `sinceDays` — that feeds the subject-
 * cooldown gate. Folding both into one key space is what lets the gate catch the
 * case where an entity is a question's ANSWER in one place and its SUBJECT in
 * another (the Peter Pettigrew repeat). answerCooldownKey doubles as the entity
 * normalizer (see entityKey in subject-cooldown.ts).
 */
export async function getRecentAnsweredEntities(
  userId: string,
  sinceDays: number,
): Promise<Set<string>> {
  const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);
  const rows = await db
    .select({
      answerText: canonicalQuestions.answerText,
      subjectEntity: canonicalQuestions.subjectEntity,
    })
    .from(masteryEvents)
    .innerJoin(canonicalQuestions, eq(masteryEvents.questionId, canonicalQuestions.id))
    .where(
      and(
        eq(masteryEvents.userId, userId),
        inArray(masteryEvents.sourceType, ['live_correct', 'catchup_correct']),
        isNotNull(masteryEvents.questionId),
        isNull(canonicalQuestions.deletedAt),
        gte(masteryEvents.createdAt, since),
      ),
    );
  const entities = new Set<string>();
  for (const row of rows) {
    const answerKey = answerCooldownKey(row.answerText);
    if (answerKey) entities.add(answerKey);
    const subjectKey = answerCooldownKey(row.subjectEntity);
    if (subjectKey) entities.add(subjectKey);
  }
  return entities;
}

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
    .where(
      and(
        eq(masteryEvents.answeredByUserId, userId),
        isNotNull(masteryEvents.questionId),
        gte(masteryEvents.createdAt, since),
        sql`${canonicalQuestions.source} <> 'daily_generated'`,
        isNull(canonicalQuestions.deletedAt),
      ),
    )
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
    .where(
      and(eq(skippedDailyQuestions.userId, userId), gte(skippedDailyQuestions.skippedAt, since)),
    )
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
      .where(
        and(
          eq(generatedQuestions.userId, userId),
          inArray(generatedQuestions.canonicalSubcategory, domains),
        ),
      )
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
  // Two sources, unioned (B-DEDUP-ANSWERED-FACTS, 2026-07-06). This is the ONE
  // durable (non-windowed) dedup — the answer/subject cooldowns are short windows,
  // so a fact answered >window days ago can still repeat unless it lives here.
  //  (1) Facts the viewer ANSWERED on ANY surface (daily / feed / catch-up),
  //      resolved to the answered row's fact_key — INCLUDING questions ANOTHER
  //      user generated (a friend's question surfaced in the feed). The
  //      "generated-for-you" source alone misses those, which is how a feed-
  //      answered fact came back as a +2 bonus (the Optimus report). This is the
  //      "never re-serve a fact I've already answered" guarantee.
  //  (2) Facts GENERATED for the viewer (served but maybe unanswered) — the prior
  //      behavior, so we still avoid re-creating something already put in front of
  //      them. Answered facts are listed first so they win the cap.
  const [answered, generated] = await Promise.all([
    db
      .select({
        factKey: generatedQuestions.factKey,
        domain: generatedQuestions.canonicalSubcategory,
      })
      .from(masteryEvents)
      // MASTERY_EVENTS.question_id references the canonical Question twin, not the
      // GeneratedQuestion — bridge via the twin's generated_question_id to read the
      // fact_key. This is what makes a feed-answered question whose GENERATED row
      // another user owns still land in the viewer's avoid set.
      .innerJoin(canonicalQuestions, eq(masteryEvents.questionId, canonicalQuestions.id))
      .innerJoin(
        generatedQuestions,
        eq(canonicalQuestions.generatedQuestionId, generatedQuestions.id),
      )
      .where(and(eq(masteryEvents.answeredByUserId, userId), isNotNull(generatedQuestions.factKey)))
      .orderBy(sql`${masteryEvents.createdAt} desc`)
      .limit(limit),
    db
      .select({
        factKey: generatedQuestions.factKey,
        domain: generatedQuestions.canonicalSubcategory,
      })
      .from(generatedQuestions)
      .where(and(eq(generatedQuestions.userId, userId), isNotNull(generatedQuestions.factKey)))
      .orderBy(sql`${generatedQuestions.createdAt} desc`)
      .limit(limit),
  ]);

  const out: RecentFactKeyEntry[] = [];
  const seen = new Set<string>();
  for (const row of [...answered, ...generated]) {
    if (!row.factKey || seen.has(row.factKey)) continue;
    seen.add(row.factKey);
    out.push({ domain: row.domain ?? 'unknown', factKey: row.factKey });
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * Full-set dedup check (D-SUPPLY-NEVER-REPEAT-01): of the given candidate
 * fact_keys, which has the viewer ALREADY ANSWERED on any surface? Exact and
 * UNCAPPED — unlike getRecentFactKeys (whose answered arm is recency-limited
 * for prompt sizing), this checks the full answered history via the same
 * MASTERY_EVENTS → canonical-twin → fact_key bridge, so "never re-serve an
 * answered fact" holds no matter how large the history grows (the 200-cap
 * leak: a 445-fact history left the oldest ~245 invisible to the in-memory
 * avoid set). Bounded by the candidate batch (≤ ~10 keys per call).
 */
export async function getAnsweredFactKeysAmong(
  userId: string,
  factKeys: readonly (string | null | undefined)[],
): Promise<Set<string>> {
  const keys = [...new Set(factKeys.filter((key): key is string => Boolean(key)))];
  if (keys.length === 0) return new Set();
  const rows = await db
    .selectDistinct({ factKey: generatedQuestions.factKey })
    .from(masteryEvents)
    .innerJoin(canonicalQuestions, eq(masteryEvents.questionId, canonicalQuestions.id))
    .innerJoin(
      generatedQuestions,
      eq(canonicalQuestions.generatedQuestionId, generatedQuestions.id),
    )
    .where(
      and(eq(masteryEvents.answeredByUserId, userId), inArray(generatedQuestions.factKey, keys)),
    );
  return new Set(rows.map((row) => row.factKey).filter((key): key is string => Boolean(key)));
}

/**
 * Demand-pull replenish (D-SUPPLY-DEMAND-PULL-01): how much SERVEABLE own-bank
 * stock does the viewer have right now, per domain? A row counts only if the
 * next build could actually place it: never served (used_in_queue=false), not a
 * duplicate, fact-keyed, in the viewer's current palette, AND its fact not
 * already answered by the viewer on any surface (the same MASTERY_EVENTS →
 * canonical-twin → fact_key bridge getRecentFactKeys uses — a stale flute row
 * is not stock). Domains are matched on the folded domain_key with the exact
 * canonical string as fallback, mirroring pickBankSource.
 */
export async function countServeableOwnBankStock(
  userId: string,
  domains: string[],
): Promise<Map<string, number>> {
  if (domains.length === 0) return new Map();
  const keys = [...new Set(domains.map((domain) => domainKey(domain)))];
  const rows = await db
    .select({
      domain: generatedQuestions.canonicalSubcategory,
      count: sql<number>`count(*)::int`,
    })
    .from(generatedQuestions)
    .where(
      and(
        eq(generatedQuestions.userId, userId),
        eq(generatedQuestions.usedInQueue, false),
        eq(generatedQuestions.isDuplicate, false),
        isNotNull(generatedQuestions.factKey),
        or(
          inArray(generatedQuestions.domainKey, keys),
          inArray(generatedQuestions.canonicalSubcategory, domains),
        ),
        sql`NOT EXISTS (
        SELECT 1 FROM "MASTERY_EVENTS" me
        JOIN "Question" cq ON me.question_id = cq.id
        JOIN "GeneratedQuestion" agq ON cq.generated_question_id = agq.id
        WHERE me.answered_by_user_id = ${userId}
          AND agq.fact_key = ${generatedQuestions.factKey}
      )`,
      ),
    )
    .groupBy(generatedQuestions.canonicalSubcategory);
  const out = new Map<string, number>();
  for (const row of rows) {
    if (row.domain) out.set(row.domain, row.count);
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
    .where(and(eq(canonicalQuestions.creatorId, userId), isNull(canonicalQuestions.deletedAt)))
    .orderBy(desc(canonicalQuestions.createdAt))
    .limit(limit);

  return rows.map((row) => ({
    domain: row.domain ?? 'unknown',
    text: row.questionText,
  }));
}

/**
 * Up to `perDomainLimit` authored questions per domain (from the given `authorIds`
 * only), as (question, answer) pairs, for seeding generation. These are
 * GROUND-TRUTH anchors fed into buildUserPrompt so the model writes NEW questions
 * grounded in real canon instead of inventing details — the fix for niche domains
 * it doesn't truly know (e.g. "Spy School"). Scoped to a TRUSTED author allowlist
 * (callers pass adminUserIds()) on purpose: a seed is treated as canon, so an
 * untrusted author's mistake must never become a generation anchor. Empty
 * `authorIds` → no seeds (the feature is inert until an admin authors examples).
 * Non-deleted, non-blocked; newest first; domains with no examples are absent.
 */
export async function getAuthoredExamplesForDomains(
  domains: readonly string[],
  perDomainLimit: number,
  authorIds: readonly string[],
): Promise<Map<string, Array<{ questionText: string; answerText: string }>>> {
  const result = new Map<string, Array<{ questionText: string; answerText: string }>>();
  if (domains.length === 0 || perDomainLimit <= 0 || authorIds.length === 0) return result;

  const rows = await db
    .select({
      domain: canonicalQuestions.canonicalSubcategory,
      questionText: canonicalQuestions.questionText,
      answerText: canonicalQuestions.answerText,
    })
    .from(canonicalQuestions)
    .where(
      and(
        inArray(canonicalQuestions.canonicalSubcategory, [...domains]),
        inArray(canonicalQuestions.creatorId, [...authorIds]),
        isNull(canonicalQuestions.deletedAt),
        ne(canonicalQuestions.visibility, 'blocked'),
      ),
    )
    .orderBy(desc(canonicalQuestions.createdAt));

  for (const row of rows) {
    if (!row.domain) continue;
    const existing = result.get(row.domain);
    if (existing) {
      if (existing.length < perDomainLimit) {
        existing.push({ questionText: row.questionText, answerText: row.answerText });
      }
    } else {
      result.set(row.domain, [{ questionText: row.questionText, answerText: row.answerText }]);
    }
  }
  return result;
}

export async function getAnsweredDailyCount(queue: DailyQueueRow): Promise<number> {
  return asQueueSlots(queue.slots).filter((slot) => slot.answered).length;
}

export async function getKBDomainEntry(userId: string, domain: string) {
  const [row] = await db
    .select()
    .from(declaredInterests)
    .where(
      and(
        eq(declaredInterests.userId, userId),
        eq(declaredInterests.domain, domain),
        eq(declaredInterests.isActive, true),
      ),
    )
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
