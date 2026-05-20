import { and, eq, inArray, lt, ne, sql } from 'drizzle-orm';

import { getNextDailyResetBoundary } from '@/lib/games/timezone';
import {
  dailyQueues,
  db,
  generatedQuestions,
  masteryEvents,
  playerMastery,
  users,
} from '@/server/db';
import { resolveTier } from '@/server/mastery/tiers';
import { getDeliveredCreatorNotesForQuestions, type DeliveredCreatorNote } from '@/server/creator-notes';
import { checkBankedQuestions } from '@/server/db/queries/bank';
import { getDailyPreferences } from '@/server/db/queries/daily-preferences';
import { getFeedPagePayload } from '@/server/feed/get-feed-page';
import type { QueueSlot } from '@/server/daily/types';
import type { MasteryTier } from '@/types/db';

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

export type DailySummaryView = {
  date: string;
  totalAnswered: number;
  totalCorrect: number;
  totalSkipped: number;
  pointsEarned: number;
  difficultyMode: string | null;
  questions: QuestionRecap[];
  domainGains: DomainGain[];
  newTerritory: string[];
  tierCrossings: TierCrossing[];
  recentFriendBridge: RecentFriendBridge | null;
  isFirstCompletedRound: boolean;
  reminderPromptState: 'show' | 'hidden';
};

export type RecentFriendBridge = {
  friendName: string;
  cardType: string;
  domainDisplayName: string | null;
};

export type QuestionRecap = {
  questionId: string;
  bankQuestionId: string | null;
  questionText: string;
  submittedAnswer: string | null;
  correctAnswer: string;
  isCorrect: boolean;
  isSkipped: boolean;
  explanation: string;
  domain: string;
  domainDisplayName: string;
  isInBank: boolean;
  creatorNote: DeliveredCreatorNote | null;
};

export type DomainGain = {
  domain: string;
  displayName: string;
  broadCategory: string;
  pointsGained: number;
  totalPoints: number;
  currentTier: MasteryTier;
  isNewTerritory: boolean;
};

export type TierCrossing = {
  domain: string;
  fromTier: MasteryTier;
  toTier: MasteryTier;
};

function asIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function asQueueSlots(value: unknown): QueueSlot[] {
  return Array.isArray(value) ? (value as QueueSlot[]) : [];
}

function displayNameForDomain(domain: string): string {
  return domain
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function dateStart(dateString: string): Date {
  return new Date(`${dateString}T00:00:00.000Z`);
}

export async function getDailySummary(userId: string, date: Date): Promise<DailySummaryView> {
  const dateString = asIsoDate(date);
  const [queue] = await db
    .select()
    .from(dailyQueues)
    .where(and(eq(dailyQueues.userId, userId), eq(dailyQueues.queueDate, dateString)))
    .limit(1);

  const slots = asQueueSlots(queue?.slots);
  const generatedIds = slots
    .map((slot) => slot.generated_question_id)
    .filter((id): id is string => Boolean(id));

  const [questions, todayEvents, prefs] = await Promise.all([
    generatedIds.length > 0
      ? db
          .select()
          .from(generatedQuestions)
          .where(and(
            eq(generatedQuestions.userId, userId),
            inArray(generatedQuestions.id, generatedIds),
          ))
      : Promise.resolve([]),
    queue
      ? db
          .select({
            domain: masteryEvents.canonicalSubcategory,
            awardedPoints: masteryEvents.awardedPoints,
          })
          .from(masteryEvents)
          .where(and(
            eq(masteryEvents.userId, userId),
            eq(masteryEvents.sessionContext, 'daily'),
            sql`${masteryEvents.answerId} like ${`daily:${queue.id}:%`}`,
          ))
      : Promise.resolve([]),
    getDailyPreferences(userId),
  ]);

  const questionById = new Map(questions.map((question) => [question.id, question]));
  const pointsByDomain = new Map<string, number>();
  const touchedDomains = new Set<string>();

  for (const event of todayEvents) {
    touchedDomains.add(event.domain);
    pointsByDomain.set(event.domain, (pointsByDomain.get(event.domain) ?? 0) + Number(event.awardedPoints ?? 0));
  }

  const slotPointsByDomain = new Map<string, number>();
  for (const slot of slots) {
    if (!slot.domain) continue;
    touchedDomains.add(slot.domain);

    const slotPoints = Number(slot.awarded_points ?? 0);
    if (slotPoints > 0) {
      slotPointsByDomain.set(slot.domain, (slotPointsByDomain.get(slot.domain) ?? 0) + slotPoints);
    }
  }

  for (const [domain, slotPoints] of slotPointsByDomain) {
    // The queue slot is the source of truth for the visible round total. If the
    // mastery event write is missing or undercounts a domain, keep the per-domain
    // recap in sync with the total card instead of showing +0 under a +N total.
    pointsByDomain.set(domain, Math.max(pointsByDomain.get(domain) ?? 0, slotPoints));
  }

  const priorRows = touchedDomains.size > 0
    ? await db
        .select({
          domain: masteryEvents.canonicalSubcategory,
          count: sql<number>`count(*)`,
        })
        .from(masteryEvents)
        .where(and(
          eq(masteryEvents.userId, userId),
          inArray(masteryEvents.canonicalSubcategory, [...touchedDomains]),
          lt(masteryEvents.createdAt, dateStart(dateString)),
        ))
        .groupBy(masteryEvents.canonicalSubcategory)
    : [];
  const priorEventDomains = new Set(priorRows.filter((row) => Number(row.count) > 0).map((row) => row.domain));
  const newTerritory = [...touchedDomains].filter((domain) => !priorEventDomains.has(domain));

  const masteryRows = touchedDomains.size > 0
    ? await db
        .select({
          domain: playerMastery.canonicalSubcategory,
          broadCategory: playerMastery.broadCategory,
          totalPoints: playerMastery.totalPoints,
          tier: playerMastery.tier,
        })
        .from(playerMastery)
        .where(and(
          eq(playerMastery.userId, userId),
          inArray(playerMastery.canonicalSubcategory, [...touchedDomains]),
        ))
    : [];
  const masteryByDomain = new Map(masteryRows.map((row) => [row.domain, row]));

  const tierCrossings: TierCrossing[] = [...pointsByDomain.entries()]
    .map(([domain, pointsGained]) => {
      const mastery = masteryByDomain.get(domain);
      if (!mastery || pointsGained <= 0) return null;
      const fromTier = resolveTier(Math.max(0, Number(mastery.totalPoints ?? 0) - pointsGained));
      const toTier = mastery.tier;
      return fromTier !== toTier ? { domain, fromTier, toTier } : null;
    })
    .filter((row): row is TierCrossing => Boolean(row));

  const recapQuestionIds = slots
    .map((slot) => slot.question_id)
    .filter((id): id is string => Boolean(id));
  const bankedById = await checkBankedQuestions(userId, recapQuestionIds);
  const creatorNotesByQuestionId = await getDeliveredCreatorNotesForQuestions(userId, recapQuestionIds);

  const recaps = slots.map<QuestionRecap>((slot) => {
    const generated = slot.generated_question_id ? questionById.get(slot.generated_question_id) : null;
    const domain = slot.domain || generated?.canonicalSubcategory || 'General';
    const questionId = slot.question_id ?? slot.generated_question_id ?? `${queue?.id ?? dateString}:${slot.slot_index}`;
    return {
      questionId,
      bankQuestionId: slot.question_id ?? null,
      questionText: slot.question_text || generated?.questionText || '',
      submittedAnswer: slot.submitted_answer ?? null,
      correctAnswer: slot.reveal_canonical_answer ?? generated?.answer ?? '',
      isCorrect: slot.answer_state === 'correct',
      isSkipped: Boolean(slot.skipped),
      explanation: slot.reveal_explainer ?? generated?.explainer ?? '',
      domain,
      domainDisplayName: displayNameForDomain(domain),
      isInBank: slot.question_id ? Boolean(bankedById[slot.question_id]) : false,
      creatorNote: slot.question_id ? creatorNotesByQuestionId.get(slot.question_id) ?? null : null,
    };
  });

  const totalSkipped = slots.filter((slot) => slot.skipped).length;
  const totalAnswered = slots.filter((slot) => slot.answered).length;
  const totalCorrect = slots.filter((slot) => slot.answer_state === 'correct').length;
  const pointsEarned = [...pointsByDomain.values()].reduce((sum, points) => sum + points, 0);
  const gainedDomains = [...touchedDomains].filter((domain) => (pointsByDomain.get(domain) ?? 0) > 0);

  const recentFriendBridge = await getRecentFriendBridge(userId);
  const { isFirstCompletedRound, reminderPromptState } =
    await computeReminderPromptState(userId, dateString, totalAnswered);

  return {
    date: dateString,
    totalAnswered,
    totalCorrect,
    totalSkipped,
    pointsEarned,
    difficultyMode: prefs.difficulty,
    questions: recaps,
    domainGains: gainedDomains
      .map((domain) => ({
        domain,
        displayName: displayNameForDomain(domain),
        broadCategory: masteryByDomain.get(domain)?.broadCategory || domain,
        pointsGained: pointsByDomain.get(domain) ?? 0,
        totalPoints: Number(masteryByDomain.get(domain)?.totalPoints ?? pointsByDomain.get(domain) ?? 0),
        currentTier: masteryByDomain.get(domain)?.tier ?? resolveTier(pointsByDomain.get(domain) ?? 0),
        isNewTerritory: newTerritory.includes(domain),
      }))
      .sort((a, b) => b.pointsGained - a.pointsGained || a.displayName.localeCompare(b.displayName)),
    newTerritory,
    tierCrossings,
    recentFriendBridge,
    isFirstCompletedRound,
    reminderPromptState,
  };
}

async function computeReminderPromptState(
  userId: string,
  todayString: string,
  todayAnswered: number,
): Promise<{ isFirstCompletedRound: boolean; reminderPromptState: 'show' | 'hidden' }> {
  // Today must have at least one answered slot to count as "completed".
  if (todayAnswered <= 0) {
    return { isFirstCompletedRound: false, reminderPromptState: 'hidden' };
  }

  // Did the user complete any earlier daily queue? A queue counts as completed
  // when any of its slots has answered=true. We only need to know whether such
  // a row exists for any prior date, not how many.
  const [prior] = await db
    .select({ id: dailyQueues.id })
    .from(dailyQueues)
    .where(and(
      eq(dailyQueues.userId, userId),
      ne(dailyQueues.queueDate, todayString),
      sql`EXISTS (
        SELECT 1 FROM jsonb_array_elements(${dailyQueues.slots}) slot
        WHERE (slot->>'answered')::boolean IS TRUE
      )`,
    ))
    .limit(1);

  const isFirstCompletedRound = !prior;
  if (!isFirstCompletedRound) {
    return { isFirstCompletedRound: false, reminderPromptState: 'hidden' };
  }

  const [user] = await db
    .select({
      smsOptIn: users.smsOptIn,
      emailOptIn: users.emailOptIn,
      reminderPromptDismissedAt: users.reminderPromptDismissedAt,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!user) {
    return { isFirstCompletedRound: true, reminderPromptState: 'hidden' };
  }

  const show =
    user.smsOptIn === 'not_asked' &&
    user.emailOptIn === 'not_asked' &&
    user.reminderPromptDismissedAt === null;

  return {
    isFirstCompletedRound: true,
    reminderPromptState: show ? 'show' : 'hidden',
  };
}

async function getRecentFriendBridge(userId: string): Promise<RecentFriendBridge | null> {
  const mostRecentReset = new Date(getNextDailyResetBoundary().getTime() - ONE_DAY_MS);
  const page = await getFeedPagePayload(userId, { limit: 5, cursor: null, filter: 'all' });
  for (const item of page.items) {
    if (item.card_type === 'answered_by_you') continue;
    const eventAtRaw = typeof item.source_event_at === 'string' ? item.source_event_at : null;
    if (!eventAtRaw) continue;
    const eventAt = new Date(eventAtRaw);
    if (Number.isNaN(eventAt.getTime())) continue;
    if (eventAt < mostRecentReset) continue;
    return {
      friendName: item.source_friend_display_name ?? 'A friend',
      cardType: item.card_type,
      domainDisplayName: item.domain_pill ?? null,
    };
  }
  return null;
}
