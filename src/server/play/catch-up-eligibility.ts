import { CATCHUP_LOOKBACK_DAYS, minusUtcDays } from '@/server/daily/catchup';
import type { QueueSlot } from '@/server/daily/types';

export function catchUpExpiresAt(queueDate: string, lookbackDays = CATCHUP_LOOKBACK_DAYS): string {
  const date = new Date(`${queueDate}T23:59:59.999Z`);
  date.setUTCDate(date.getUTCDate() + lookbackDays);
  return date.toISOString();
}

export function queueAgeInDays(queueDate: string, assignmentDate: string): number {
  const current = new Date(`${assignmentDate}T00:00:00.000Z`).getTime();
  const queued = new Date(`${queueDate}T00:00:00.000Z`).getTime();
  if (Number.isNaN(current) || Number.isNaN(queued)) return 0;
  return Math.max(0, Math.floor((current - queued) / 86_400_000));
}

export function isCatchUpQueueDateEligible(
  queueDate: string,
  assignmentDate: string,
  lookbackDays = CATCHUP_LOOKBACK_DAYS,
): boolean {
  const oldestDate = minusUtcDays(assignmentDate, lookbackDays);
  // Today's queue is eligible so wrong answers from today's Daily 5 surface
  // immediately rather than waiting until tomorrow.
  return queueDate <= assignmentDate && queueDate >= oldestDate;
}

/**
 * `isTodaysQueue` narrows what today's own round contributes to catch-up.
 *
 * Today's queue is date-eligible on purpose, so a wrong answer resurfaces
 * immediately instead of waiting until tomorrow. But the unanswered arm below
 * swept in slots the player simply has not reached yet, so a round played
 * 2-of-5 reported the other three as "missed" while home was concurrently
 * offering "Pick up where you left off · Resume round" — the same slots
 * counted as pending and missed at once. It also broke the promise the skip
 * sheet makes out loud ("It'll come back another day"): a slot skipped for
 * now reappeared as catch-up debt the same afternoon.
 *
 * So for TODAY only, an unanswered slot is still pending, not missed. It
 * becomes ordinary catch-up tomorrow, when its queue is no longer today's.
 * Wrong answers from today are unaffected and still surface immediately.
 */
export function isCatchUpSlotEligible(slot: QueueSlot, isTodaysQueue = false): boolean {
  if (slot.dismissed_at) return false;
  // Bot slots carry generated_question_id; friend-authored slots carry
  // question_id (the canonical Question.id). Either is sufficient to
  // re-serve the slot in catch-up.
  if (!slot.generated_question_id && !slot.question_id) return false;
  // Already recovered in a prior catch-up attempt — a correct catch-up answer
  // closes the slot for good. We key off catchup_answer_state (NOT answer_state)
  // because recovery deliberately leaves the live verdict untouched so the
  // daily-five dots keep showing the original wrong/skipped result.
  if (slot.catchup_answer_state === 'correct') return false;
  // Wrong daily-5 answers are eligible for re-attempt; correct ones are not.
  if (slot.answered) return slot.answer_state === 'incorrect';
  // Unanswered: genuinely missed on a past day, still pending on today's.
  return !isTodaysQueue;
}

export function expiresWithin24Hours(expiresAt: string, now = new Date()): boolean {
  const expiresTime = new Date(expiresAt).getTime();
  if (Number.isNaN(expiresTime)) return false;
  const msRemaining = expiresTime - now.getTime();
  return msRemaining > 0 && msRemaining <= 86_400_000;
}
