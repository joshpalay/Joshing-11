import { NextResponse } from 'next/server';

import { getSession } from '@/server/auth/session';
import { getTodaysDailyQueue } from '@/server/db/queries/daily';
import { getDailyPreferences } from '@/server/db/queries/daily-preferences';
import { DAILY_QUEUE_SIZE, isRoundComplete, type QueueSlot } from '@/server/daily/types';
import { getBonusSlots, getCoreSlots, getLiveCoreSlots } from '@/server/daily/bonus';
import { getNextDailyResetBoundary } from '@/lib/games/timezone';

export const dynamic = 'force-dynamic';

function asQueueSlots(value: unknown): QueueSlot[] {
  return Array.isArray(value) ? (value as QueueSlot[]) : [];
}

type SlotOutcome = 'correct' | 'incorrect' | 'skipped' | 'unanswered';

function buildSlotOutcomes(slots: QueueSlot[]): SlotOutcome[] {
  const outcomes: SlotOutcome[] = Array.from({ length: DAILY_QUEUE_SIZE }, () => 'unanswered');
  // Home is fixed-5: the outcome array reflects core slots only. Bonus slots
  // (D-4 §B +2) are additive and never enter the home card's count. Dots are
  // POSITIONAL over the live five (a skip's replacement takes its dot), not
  // keyed by slot_index — replacements land at slot_index >= 5 and used to be
  // dropped, leaving the skipped originals to fill the row.
  getLiveCoreSlots(slots, DAILY_QUEUE_SIZE)
    .slice(0, DAILY_QUEUE_SIZE)
    .forEach((slot, idx) => {
      if (slot.answered) {
        outcomes[idx] = slot.answer_state === 'incorrect' ? 'incorrect' : 'correct';
      } else if (slot.skipped) {
        outcomes[idx] = 'skipped';
      }
    });
  return outcomes;
}

// Outcomes for the additive +2 bonus slots, in order (0–2). The home card shows
// these as a set-apart bonus dot-group; they never enter the "of 5" count.
function buildBonusOutcomes(slots: QueueSlot[]): SlotOutcome[] {
  return getBonusSlots(slots).map((slot) =>
    slot.answered
      ? slot.answer_state === 'incorrect'
        ? 'incorrect'
        : 'correct'
      : slot.skipped
        ? 'skipped'
        : 'unanswered',
  );
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
      bonusOutcomes: buildBonusOutcomes([]),
      preferences: {
        selected_domains: preferences.selectedDomains,
        difficulty_preference: preferences.difficulty,
        domain_mode: preferences.domainMode,
      },
    });
  }

  const slots = asQueueSlots(queue.slots);
  // A1 finding F3 (end-to-end-gameplay-ux-audit.md): count only CORE answers
  // here. Bonus (+2) and missed-question-return slots are additive and never
  // count toward the five (D-F3 canon, bonus.ts), but this used to count
  // every answered slot before clamping to DAILY_QUEUE_SIZE below — so a
  // player who answered 3 of 5 core questions plus both bonus slots got
  // questionsAnswered: 5 / questionsRemaining: 0 here (looking complete)
  // while isComplete (isRoundComplete, already core-scoped) correctly still
  // said false. slotOutcomes/bonusOutcomes already derive from
  // getCoreSlots/getBonusSlots below; this brings the raw count in line with
  // them instead of leaking bonus/return answers into the "of 5" status.
  const answered = getCoreSlots(slots).filter((slot) => slot.answered).length;
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
    bonusOutcomes: buildBonusOutcomes(slots),
    preferences: {
      selected_domains: preferences.selectedDomains,
      difficulty_preference: preferences.difficulty,
      domain_mode: preferences.domainMode,
    },
  });
}
