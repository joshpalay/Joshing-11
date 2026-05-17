import { and, desc, eq, inArray } from 'drizzle-orm';

import { categoryLabel } from '@/lib/questions-types';
import { asQueueSlots, dailyQueueItemId } from '@/server/daily/catchup';
import { dailyQueues, db, generatedQuestions } from '@/server/db';
import type { ReplayItem } from '@/server/replay/session';

export async function getReplayWrongQuestions(userId: string): Promise<ReplayItem[]> {
  const queues = await db
    .select()
    .from(dailyQueues)
    .where(eq(dailyQueues.userId, userId))
    .orderBy(desc(dailyQueues.queueDate));

  const candidates = queues.flatMap((queue) =>
    asQueueSlots(queue.slots)
      .filter((slot) => slot.answered && slot.answer_state === 'incorrect' && Boolean(slot.generated_question_id))
      .map((slot) => ({ queue, slot }))
  );

  const generatedIds = candidates
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

  return candidates
    .map(({ queue, slot }): ReplayItem | null => {
      const question = slot.generated_question_id ? questionById.get(slot.generated_question_id) : null;
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
      } satisfies ReplayItem;
    })
    .filter((item): item is ReplayItem => Boolean(item));
}
