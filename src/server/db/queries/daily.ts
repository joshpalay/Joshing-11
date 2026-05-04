import { and, asc, eq, inArray, isNotNull, lt, sql } from 'drizzle-orm';

import {
  dailyPreferences,
  dailyQueues,
  db,
  declaredInterests,
  generatedQuestions,
  masteryEvents,
  playerMastery,
} from '@/server/db';
import { getDailyAssignmentBounds } from '@/lib/games/timezone';
import { categoryLabel } from '@/lib/questions-types';
import { asQueueSlots, dailyQueueItemId } from '@/server/daily/catchup';
import type { QueueSlot } from '@/server/daily/types';
import {
  catchUpExpiresAt,
  expiresWithin24Hours,
  isCatchUpQueueDateEligible,
  isCatchUpSlotEligible,
  queueAgeInDays,
} from '@/server/play/catch-up-eligibility';
import { orderCatchUpItems } from '@/server/play/catch-up-turn-sequencing';

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

export type CatchupQueueItem = {
  dailyQueueItemId: string;
  queueId: string;
  queueDate: string;
  queueAge: number;
  expiresAt: string;
  expiresSoon: boolean;
  slotIndex: number;
  questionId: string;
  questionText: string;
  correctAnswer: string;
  alternateAnswers: string[];
  explanation: string | null;
  domain: string;
  domainDisplayName: string;
  broadCategory: string;
  basePoints: number;
  submittedAnswer: string | null;
  wasSkipped: boolean;
};

export type CatchupQuestion = CatchupQueueItem;

function normalizeDomain(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

export async function getKnowledgeBase(userId: string): Promise<KnowledgeBaseDomain[]> {
  const [declared, demonstrated] = await Promise.all([
    db
      .select({
        domain: declaredInterests.domain,
        broadCategory: declaredInterests.broadCategory,
        territoryType: declaredInterests.territoryType,
      })
      .from(declaredInterests)
      .where(and(eq(declaredInterests.userId, userId), eq(declaredInterests.isActive, true)))
      .orderBy(asc(declaredInterests.declaredAt)),
    db
      .select({
        domain: playerMastery.canonicalSubcategory,
        broadCategory: playerMastery.broadCategory,
        totalPoints: playerMastery.totalPoints,
        tier: playerMastery.tier,
      })
      .from(playerMastery)
      .where(and(
        eq(playerMastery.userId, userId),
        sql`exists (
          select 1
          from "MASTERY_EVENTS" me
          where me."user_id" = ${userId}
            and me."canonical_subcategory" = ${playerMastery.canonicalSubcategory}
            and me."source_type" in ('live_correct', 'catchup_correct')
            and me."question_id" is not null
        )`,
      ))
      .orderBy(asc(playerMastery.canonicalSubcategory)),
  ]);

  const domains = new Map<string, KnowledgeBaseDomain>();

  for (const row of declared) {
    const domain = normalizeDomain(row.domain);
    if (!domain) continue;
    const territoryType = row.territoryType ?? 'declared';
    domains.set(domain.toLowerCase(), {
      domain,
      broadCategory: row.broadCategory,
      source: 'declared',
      territoryType,
      totalPoints: 0,
      tier: 'establishing',
    });
  }

  for (const row of demonstrated) {
    const domain = normalizeDomain(row.domain);
    if (!domain) continue;
    const key = domain.toLowerCase();
    const existing = domains.get(key);
    domains.set(key, {
      domain: existing?.domain ?? domain,
      broadCategory: existing?.broadCategory ?? row.broadCategory,
      source: existing?.source ?? 'friend_mediated',
      territoryType: 'demonstrated',
      totalPoints: row.totalPoints,
      tier: row.tier,
    });
  }

  return [...domains.values()];
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

  const queues = await db
    .select()
    .from(dailyQueues)
    .where(and(
      eq(dailyQueues.userId, userId),
      lt(dailyQueues.queueDate, assignmentDateStr),
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

  const mapped = candidateSlots
    .map(({ queue, slot }): CatchupQuestion | null => {
      const question = slot.generated_question_id ? questionById.get(slot.generated_question_id) : null;
      if (!question) return null;
      const queueDate = String(queue.queueDate);
      const expiresAt = catchUpExpiresAt(queueDate);
      const domain = slot.domain || question.canonicalSubcategory;
      return {
        dailyQueueItemId: dailyQueueItemId(queue.id, slot.slot_index),
        queueId: queue.id,
        queueDate,
        queueAge: queueAgeInDays(queueDate, assignmentDateStr),
        expiresAt,
        expiresSoon: expiresWithin24Hours(expiresAt),
        slotIndex: slot.slot_index,
        questionId: question.id,
        questionText: slot.question_text || question.questionText,
        correctAnswer: question.answer,
        alternateAnswers: [] as string[],
        explanation: question.explainer,
        domain,
        domainDisplayName: categoryLabel(domain),
        broadCategory: question.broadCategory,
        basePoints: question.basePoints,
        submittedAnswer: slot.submitted_answer ?? null,
        wasSkipped: Boolean(slot.skipped),
      } satisfies CatchupQuestion;
    })
    .filter((question): question is CatchupQuestion => Boolean(question));

  return orderCatchUpItems(mapped);
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
    question_text: question.questionText,
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
): Promise<void> {
  await db
    .insert(declaredInterests)
    .values({
      userId,
      domain,
      broadCategory: broadCategory ?? null,
      territoryType: 'declared',
    })
    .onConflictDoNothing({
      target: [declaredInterests.userId, declaredInterests.domain],
    });
}

export async function upgradeKBDomainToDemonstrated(userId: string, domain: string): Promise<void> {
  const existing = await getKBDomainEntry(userId, domain);
  if (existing && existing.territoryType === 'declared') {
    await db
      .update(declaredInterests)
      .set({ territoryType: 'demonstrated' })
      .where(and(
        eq(declaredInterests.userId, userId),
        eq(declaredInterests.domain, domain),
      ));
  }
}
