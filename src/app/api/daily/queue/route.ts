import { NextResponse } from 'next/server';

import { getSession } from '@/server/auth/session';
import {
  createDailyQueueItem,
  getKnowledgeBase,
  getTodaysDailyQueue,
} from '@/server/db/queries/daily';
import { generateDailyQuestionsFromKnowledgeBase } from '@/server/daily/generate-questions';
import { DAILY_QUEUE_SIZE, type QueueSlot } from '@/server/daily/types';

export const dynamic = 'force-dynamic';

function asQueueSlots(value: unknown): QueueSlot[] {
  return Array.isArray(value) ? (value as QueueSlot[]) : [];
}

function serializeQueue(queue: NonNullable<Awaited<ReturnType<typeof getTodaysDailyQueue>>>) {
  return {
    queue_id: queue.id,
    queue_date: queue.queueDate,
    slots: asQueueSlots(queue.slots),
  };
}

async function requireUserId() {
  const session = await getSession();
  return session?.userId ?? null;
}

export async function GET() {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const queue = await getTodaysDailyQueue(userId);
  if (!queue) {
    return NextResponse.json({ queue: null, slots: [] });
  }

  return NextResponse.json(serializeQueue(queue));
}

export async function POST() {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const existing = await getTodaysDailyQueue(userId);
  if (existing && asQueueSlots(existing.slots).length > 0) {
    return NextResponse.json(serializeQueue(existing));
  }

  const knowledgeBase = await getKnowledgeBase(userId);
  if (knowledgeBase.length === 0) {
    return NextResponse.json(
      { error: 'no_knowledge_base', message: 'Add declared interests before generating Daily Five.' },
      { status: 409 },
    );
  }

  const generated = await generateDailyQuestionsFromKnowledgeBase(userId, DAILY_QUEUE_SIZE);
  if (generated.length === 0) {
    return NextResponse.json(
      { error: 'generation_failed', message: "Today's Daily Five is taking longer than usual." },
      { status: 503 },
    );
  }

  let queue = existing;
  for (const [index, question] of generated.slice(0, DAILY_QUEUE_SIZE).entries()) {
    queue = await createDailyQueueItem(userId, question.id, index);
  }

  if (!queue) {
    return NextResponse.json({ error: 'queue_not_created' }, { status: 500 });
  }

  return NextResponse.json(serializeQueue(queue));
}
