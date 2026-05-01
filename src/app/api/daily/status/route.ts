import { NextResponse } from 'next/server';

import { getSession } from '@/server/auth/session';
import { getTodaysDailyQueue } from '@/server/db/queries/daily';
import { getDailyPreferences } from '@/server/db/queries/daily-preferences';
import { DAILY_QUEUE_SIZE, type QueueSlot } from '@/server/daily/types';
import { getNextDailyResetBoundary } from '@/lib/games/timezone';

export const dynamic = 'force-dynamic';

function asQueueSlots(value: unknown): QueueSlot[] {
  return Array.isArray(value) ? (value as QueueSlot[]) : [];
}

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const [queue, preferences] = await Promise.all([
    getTodaysDailyQueue(session.userId),
    getDailyPreferences(session.userId),
  ]);
  const nextRoundAt = getNextDailyResetBoundary().toISOString();

  if (!queue) {
    return NextResponse.json({
      questionsRemaining: DAILY_QUEUE_SIZE,
      questionsAnswered: 0,
      isComplete: false,
      nextRoundAt,
      answered: 0,
      total: DAILY_QUEUE_SIZE,
      complete: false,
      queue_id: null,
      queue_date: null,
      preferences: {
        selected_domains: preferences.selectedDomains,
        difficulty_preference: preferences.difficulty,
        domain_mode: preferences.domainMode,
      },
    });
  }

  const slots = asQueueSlots(queue.slots);
  const answered = slots.filter((slot) => slot.answered).length;
  const total = slots.length || DAILY_QUEUE_SIZE;
  const questionsAnswered = Math.min(answered, DAILY_QUEUE_SIZE);
  const questionsRemaining = Math.max(DAILY_QUEUE_SIZE - questionsAnswered, 0);
  const isComplete = questionsAnswered >= DAILY_QUEUE_SIZE;

  return NextResponse.json({
    questionsRemaining,
    questionsAnswered,
    isComplete,
    nextRoundAt,
    answered,
    total,
    complete: isComplete,
    queue_id: queue.id,
    queue_date: queue.queueDate,
    preferences: {
      selected_domains: preferences.selectedDomains,
      difficulty_preference: preferences.difficulty,
      domain_mode: preferences.domainMode,
    },
  });
}
