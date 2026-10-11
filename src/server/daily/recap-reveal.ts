import type { QueueSlot } from '@/server/daily/types';

/**
 * What the daily recap may show about one slot.
 *
 * The recap used to carry every slot's answer and explainer, played or not, so
 * opening /daily/summary before finishing the round printed the answers to the
 * questions still waiting (QA 2026-10-11, C1). The answer leaves the server only
 * once the player has seen it: an answered slot (right, wrong, or "Show me the
 * answer", which is stored as answered). A skipped slot keeps it hidden too: it
 * comes back in catch-up, and the recap already says "Saved for Catch up".
 */
export function recapReveal(
  slot: Pick<QueueSlot, 'answered' | 'skipped'>,
  answer: string,
  explanation: string,
): { isPending: boolean; correctAnswer: string; explanation: string } {
  const isPending = !slot.answered && !slot.skipped;
  return slot.answered
    ? { isPending, correctAnswer: answer, explanation }
    : { isPending, correctAnswer: '', explanation: '' };
}
