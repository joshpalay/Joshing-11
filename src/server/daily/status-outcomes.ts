import { getBonusSlots, getLiveCoreSlots } from '@/server/daily/bonus';
import { DAILY_QUEUE_SIZE, type QueueSlot } from '@/server/daily/types';

export type SlotOutcome = 'correct' | 'incorrect' | 'skipped' | 'unanswered';

function outcomeOf(slot: QueueSlot): SlotOutcome {
  if (slot.answered) return slot.answer_state === 'incorrect' ? 'incorrect' : 'correct';
  return slot.skipped ? 'skipped' : 'unanswered';
}

/**
 * The home card's core dots — one per LIVE core slot, positional, the same
 * track the round (/daily) and the summary draw. Home's server render and
 * /api/daily/status used to build this separately: the server render keyed
 * dots by slot_index 0-4 without excluding bonus / second-look slots, so a
 * graceful-degraded round (2 core + 3 additive at slot_index 2-4) drew five
 * core dots plus the bonus group — 7 dots on home against 5 on the summary
 * (QA 2026-09-25, S5). A short round shows fewer dots, never padded ones.
 * No queue (or no slots) yet: the five the round will hold.
 */
export function buildCoreOutcomes(slots: QueueSlot[]): SlotOutcome[] {
  const live = getLiveCoreSlots(slots, DAILY_QUEUE_SIZE).slice(0, DAILY_QUEUE_SIZE);
  if (live.length === 0) return Array.from({ length: DAILY_QUEUE_SIZE }, () => 'unanswered');
  return live.map(outcomeOf);
}

/** The additive +2 bonus dots, in order; never counted toward the five. */
export function buildBonusOutcomes(slots: QueueSlot[]): SlotOutcome[] {
  return getBonusSlots(slots).map(outcomeOf);
}
