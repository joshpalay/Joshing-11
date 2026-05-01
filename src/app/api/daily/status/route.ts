import { NextResponse } from 'next/server';

import { getSession } from '@/server/auth/session';
import { getDailyPreferences, getTodaysDailyQueue } from '@/server/db/queries/daily';
import { DAILY_QUEUE_SIZE, type QueueSlot } from '@/server/daily/types';

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

  if (!queue) {
    return NextResponse.json({
      answered: 0,
      total: DAILY_QUEUE_SIZE,
      complete: false,
      queue_id: null,
      queue_date: null,
      preferences: preferences
        ? {
            selected_domains: preferences.selectedDomains,
            difficulty_preference: preferences.difficultyPreference,
          }
        : null,
    });
  }

  const slots = asQueueSlots(queue.slots);
  const answered = slots.filter((slot) => slot.answered).length;

  return NextResponse.json({
    answered,
    total: slots.length || DAILY_QUEUE_SIZE,
    complete: answered >= DAILY_QUEUE_SIZE,
    queue_id: queue.id,
    queue_date: queue.queueDate,
    preferences: preferences
      ? {
          selected_domains: preferences.selectedDomains,
          difficulty_preference: preferences.difficultyPreference,
        }
      : null,
  });
}
