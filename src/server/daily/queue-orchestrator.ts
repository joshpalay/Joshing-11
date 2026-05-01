import {
  createDailyQueueItem,
  getKnowledgeBase,
  getTodaysDailyQueue,
} from '@/server/db/queries/daily';
import { generateDailyQuestionsFromKnowledgeBase } from '@/server/daily/generate-questions';
import { DAILY_QUEUE_SIZE, type QueueSlot } from '@/server/daily/types';

export type DailyQueueFillErrorCode = 'no_knowledge_base' | 'generation_failed';

export class DailyQueueFillError extends Error {
  constructor(readonly code: DailyQueueFillErrorCode, message: string) {
    super(message);
    this.name = 'DailyQueueFillError';
  }
}

function asQueueSlots(value: unknown): QueueSlot[] {
  return Array.isArray(value) ? (value as QueueSlot[]) : [];
}

export async function fillDailyQueueForUser(userId: string): Promise<void> {
  const existing = await getTodaysDailyQueue(userId);
  if (existing && asQueueSlots(existing.slots).length > 0) return;

  const knowledgeBase = await getKnowledgeBase(userId);
  if (knowledgeBase.length === 0) {
    throw new DailyQueueFillError(
      'no_knowledge_base',
      'Add declared interests before generating Daily Five.',
    );
  }

  const generated = await generateDailyQuestionsFromKnowledgeBase(userId, DAILY_QUEUE_SIZE);
  if (generated.length === 0) {
    throw new DailyQueueFillError(
      'generation_failed',
      "Today's Daily Five is taking longer than usual.",
    );
  }

  for (const [index, question] of generated.slice(0, DAILY_QUEUE_SIZE).entries()) {
    await createDailyQueueItem(userId, question.id, index);
  }
}
