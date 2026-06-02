import { and, desc, eq, inArray } from 'drizzle-orm';

import { categoryLabel, resolveAuthorDisplay } from '@/lib/questions-types';
import { asQueueSlots, dailyQueueItemId } from '@/server/daily/catchup';
import { dailyQueues, db, generatedQuestions, questions as canonicalQuestions, users } from '@/server/db';
import type { ReplayItem } from '@/server/replay/session';

export async function getReplayWrongQuestions(userId: string): Promise<ReplayItem[]> {
  const queues = await db
    .select()
    .from(dailyQueues)
    .where(eq(dailyQueues.userId, userId))
    .orderBy(desc(dailyQueues.queueDate));

  // A slot is replayable when the user answered it wrong AND there is some
  // question row to fetch the prompt/answer from. Bot slots carry
  // generated_question_id; friend-authored slots carry question_id (canonical).
  const candidates = queues.flatMap((queue) =>
    asQueueSlots(queue.slots)
      .filter((slot) =>
        slot.answered
          && slot.answer_state === 'incorrect'
          && (Boolean(slot.generated_question_id) || Boolean(slot.question_id))
      )
      .map((slot) => ({ queue, slot }))
  );

  const generatedIds = candidates
    .map(({ slot }) => slot.generated_question_id)
    .filter((id): id is string => Boolean(id));
  const canonicalIds = candidates
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

  // Resolve human author names for friend-authored slots; bot slots have no
  // creator and the client labels them non-relationally.
  const creatorIds = [...new Set(canonicalRows.map((q) => q.creatorId).filter((id): id is string => Boolean(id)))];
  const authorNameById = creatorIds.length > 0
    ? new Map(
        (await db
          .select({ id: users.id, displayName: users.displayName })
          .from(users)
          .where(inArray(users.id, creatorIds))).map((row) => [row.id, row.displayName]),
      )
    : new Map<string, string | null>();

  return candidates
    .map(({ queue, slot }): ReplayItem | null => {
      if (slot.generated_question_id) {
        const question = generatedById.get(slot.generated_question_id);
        if (!question) return null;
        const domain = slot.domain || question.canonicalSubcategory;
        return {
          dailyQueueItemId: dailyQueueItemId(queue.id, slot.slot_index),
          queueDate: String(queue.queueDate),
          slotIndex: slot.slot_index,
          questionId: question.id,
          questionText: slot.question_text || question.questionText,
          correctAnswer: question.answer,
          explanation: question.explainer,
          domain,
          domainDisplayName: categoryLabel(domain),
          originalSubmittedAnswer: slot.submitted_answer ?? null,
          authorName: null, // bot slot: LLM origin, no human author
          authorIsHouse: false,
        } satisfies ReplayItem;
      }

      if (!slot.question_id) return null;
      const question = canonicalById.get(slot.question_id);
      if (!question || question.deletedAt) return null;
      const domain = slot.domain || question.canonicalSubcategory || question.broadCategory || question.category;
      if (!domain) return null;
      const explanation = question.explainerFullWrong
        ?? question.explainerFull
        ?? question.explainerBrief
        ?? question.factualExplanation
        ?? null;
      return {
        dailyQueueItemId: dailyQueueItemId(queue.id, slot.slot_index),
        queueDate: String(queue.queueDate),
        slotIndex: slot.slot_index,
        questionId: question.id,
        questionText: slot.question_text || question.questionText,
        correctAnswer: question.answerText,
        explanation,
        domain,
        domainDisplayName: categoryLabel(domain),
        originalSubmittedAnswer: slot.submitted_answer ?? null,
        ...resolveAuthorDisplay(question.creatorId, question.source, question.creatorId ? authorNameById.get(question.creatorId) ?? null : null),
      } satisfies ReplayItem;
    })
    .filter((item): item is ReplayItem => Boolean(item));
}
