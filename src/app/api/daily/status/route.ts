import { NextResponse } from 'next/server';

import { getSession } from '@/server/auth/session';
import { getTodaysDailyQueue } from '@/server/db/queries/daily';
import { getDailyPreferences } from '@/server/db/queries/daily-preferences';
import { DAILY_QUEUE_SIZE, isRoundComplete, type QueueSlot } from '@/server/daily/types';
import { getCoreSlots } from '@/server/daily/bonus';
import { getNextDailyResetBoundary } from '@/lib/games/timezone';

export const dynamic = 'force-dynamic';

function asQueueSlots(value: unknown): QueueSlot[] {
  return Array.isArray(value) ? (value as QueueSlot[]) : [];
}

type SlotOutcome = 'correct' | 'incorrect' | 'skipped' | 'unanswered';

function buildSlotOutcomes(slots: QueueSlot[]): SlotOutcome[] {
  const outcomes: SlotOutcome[] = Array.from({ length: DAILY_QUEUE_SIZE }, () => 'unanswered');
  // Home is fixed-5: the outcome array reflects core slots only. Bonus slots
  // (D-4 §B +2) are additive and never enter the home card's count, so we drive
  // this off the shared selector rather than the old `idx >= DAILY_QUEUE_SIZE`
  // index math (same output, intention-revealing — D-F5).
  for (const slot of getCoreSlots(slots)) {
    const idx = slot.slot_index;
    if (!Number.isInteger(idx) || idx < 0 || idx >= DAILY_QUEUE_SIZE) continue;
    if (slot.answered) {
      outcomes[idx] = slot.answer_state === 'incorrect' ? 'incorrect' : 'correct';
    } else if (slot.skipped) {
      outcomes[idx] = 'skipped';
    }
  }
  return outcomes;
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
      slotOutcomes: buildSlotOutcomes([]),
      preferences: {
        selected_domains: preferences.selectedDomains,
        difficulty_preference: preferences.difficulty,
        domain_mode: preferences.domainMode,
      },
    });
  }

  const slots = asQueueSlots(queue.slots);
  const answered = slots.filter((slot) => slot.answered).length;
  const total = DAILY_QUEUE_SIZE;
  const questionsAnswered = Math.min(answered, DAILY_QUEUE_SIZE);
  // Completion follows "no slot left to play", not "5 answered" — a skipped
  // slot whose replacement failed to generate leaves nothing pending, so the
  // round is genuinely over even though fewer than five were answered.
  const isComplete = isRoundComplete(slots);
  const questionsRemaining = isComplete
    ? 0
    : Math.max(DAILY_QUEUE_SIZE - questionsAnswered, 0);

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
    slotOutcomes: buildSlotOutcomes(slots),
    preferences: {
      selected_domains: preferences.selectedDomains,
      difficulty_preference: preferences.difficulty,
      domain_mode: preferences.domainMode,
    },
  });
}
