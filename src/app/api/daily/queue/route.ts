import { NextResponse } from 'next/server';

import { getSession } from '@/server/auth/session';
import { getTodaysDailyQueue } from '@/server/db/queries/daily';
import { DailyQueueFillError, fillDailyQueueForUser } from '@/server/daily/queue-orchestrator';
import { type QueueSlot } from '@/server/daily/types';

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

  try {
    await fillDailyQueueForUser(userId);
  } catch (error) {
    if (error instanceof DailyQueueFillError) {
      return NextResponse.json(
        { error: error.code, message: error.message },
        { status: error.code === 'no_knowledge_base' ? 409 : 503 },
      );
    }
    throw error;
  }

  const queue = await getTodaysDailyQueue(userId);
  if (!queue) {
    return NextResponse.json({ error: 'queue_not_created' }, { status: 500 });
  }

  return NextResponse.json(serializeQueue(queue));
}
