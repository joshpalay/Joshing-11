import {
  createDailyQueueItem,
  createDailyQueueItemFromAuthored,
  getKnowledgeBase,
  getTodaysDailyQueue,
  pickEligibleAuthoredQuestions,
} from '@/server/db/queries/daily';
import { getDailyPreferences } from '@/server/db/queries/daily-preferences';
import { getFriendAndFoFUserIds } from '@/server/db/queries/friends';
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

  const [knowledgeBase, preferences] = await Promise.all([
    getKnowledgeBase(userId),
    getDailyPreferences(userId),
  ]);
  if (knowledgeBase.length === 0) {
    throw new DailyQueueFillError(
      'no_knowledge_base',
      'Add declared interests before generating Daily Five.',
    );
  }
  if (preferences.domainMode === 'custom' && preferences.selectedDomains.length === 0) {
    throw new DailyQueueFillError(
      'no_knowledge_base',
      'Choose at least one domain before starting a custom Daily Five.',
    );
  }

  // Prefer vetted user-authored questions, prioritised by friends-of-friends,
  // then top up the remaining slots with LLM-generated questions. The
  // QueueSlot schema already supports both bot and friend sources
  // (src/server/daily/types.ts), so this is a picker change — no slot-shape
  // migration required.
  const socialGraph = await getFriendAndFoFUserIds(userId);
  const authored = await pickEligibleAuthoredQuestions(userId, socialGraph, DAILY_QUEUE_SIZE);

  const remaining = DAILY_QUEUE_SIZE - authored.length;
  const generated = remaining > 0
    ? await generateDailyQuestionsFromKnowledgeBase(userId, remaining)
    : [];

  if (authored.length === 0 && generated.length === 0) {
    throw new DailyQueueFillError(
      'generation_failed',
      "Today's Daily Five is taking longer than usual.",
    );
  }

  // Cross-source dedup by normalized question text. The authored picker
  // dedupes by question_id against past queues, and the generator has its
  // own batch/history dedup — but neither knows about the other, so the
  // same prompt can land in two slots of the same queue (e.g. an authored
  // "Apples are in what plant family?" alongside an LLM-generated one).
  const seenTexts = new Set<string>();
  const normalize = (text: string) => text.trim().toLowerCase();
  for (const pick of authored) {
    seenTexts.add(normalize(pick.questionText));
  }
  const dedupedGenerated: typeof generated = [];
  let droppedDuplicates = 0;
  for (const question of generated) {
    const key = normalize(question.questionText);
    if (seenTexts.has(key)) {
      droppedDuplicates += 1;
      continue;
    }
    seenTexts.add(key);
    dedupedGenerated.push(question);
  }
  if (droppedDuplicates > 0) {
    console.warn('[daily/queue-orchestrator] dropped duplicate generated questions', {
      userId,
      droppedDuplicates,
      authoredCount: authored.length,
      generatedCount: generated.length,
    });
  }

  let position = 0;
  for (const pick of authored) {
    await createDailyQueueItemFromAuthored(userId, pick, position);
    position += 1;
  }
  for (const question of dedupedGenerated.slice(0, DAILY_QUEUE_SIZE - position)) {
    await createDailyQueueItem(userId, question.id, position);
    position += 1;
  }
}
