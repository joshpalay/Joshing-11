/**
 * Daily Five +2 bonus — single source of truth (D-F5 / B-BONUS-QUESTION-STANDARDIZE-01).
 *
 * Bonus-ness used to be re-derived ad hoc in ~5 read sites, each re-checking
 * `presence_source_id` (or, worse, doing `idx >= DAILY_QUEUE_SIZE` index math).
 * These pure selectors are now the ONLY place that derives bonus-ness from a
 * slot's presence fields at read time. The write-time truth still lives in the
 * queue orchestrator (`buildPresenceSlot` in db/queries/daily.ts) — that builds
 * the slots; this reads them back.
 *
 * Canon (D-F3): the daily set is FIVE. Bonus slots are additive and never count
 * toward the set size. Track length may be 5–7 (you still navigate the bonus
 * questions), but the spoken/written COUNT is always 5 (= core).
 *
 * A slot is a bonus slot iff it carries a non-empty `presence_source_id`. The
 * presence of that field is the marker (types.ts:37-55). Malformed or missing
 * presence is treated as CORE — bonus is opt-in, never inferred from position.
 *
 * TWO CALLERS, OPPOSITE REQUIREMENTS — read this before deriving any number
 * from these helpers.
 *
 *   For COMPLETENESS (isRoundComplete), marker-less-means-core is exactly
 *   right: the failure mode is a player answering one extra question, which is
 *   strictly better than a player stranded on a round that never completes.
 *
 *   For ANALYTICS, the same default is WRONG and silently so. Any slot written
 *   before the marker existed classifies as core, so a bonus rate computed
 *   across all history is understated with nothing in the data to say so.
 *   Scope every such figure to BONUS_MARKER_FLOOR below, or label it unscoped.
 *
 * The helpers do not need to change. The split needs to be known.
 */

import type { QueueSlot } from './types';

/**
 * First date a bonus marker was written to a live queue.
 *
 * `presence_source_id` entered the schema 2026-06-02 (replacing the retired
 * `answerer_id`), and the first production queue carrying one was written
 * 2026-06-04. 117 of 309 queues — 38% of all history — predate it and therefore
 * classify as ALL CORE regardless of what they actually contained.
 *
 * Consequences, both real:
 *   - a retroactive core/bonus split is only valid from this date forward;
 *   - a pre-floor queue with a stranded bonus slot is undetectable by the
 *     core-resolved test, so measured stranding incidence is a LOWER BOUND
 *     historically, though it is the correct rate going forward.
 */
export const BONUS_MARKER_FLOOR = '2026-06-04';

/**
 * Presence attribution for a bonus slot: WHERE the question's domain came from
 * ("from {name}'s knowledge"), not who authored or answered it. `extraCount` > 0
 * means additional followed friends surface this domain beyond the named one.
 */
export interface BonusPresence {
  id: string;
  name: string | null;
  extraCount: number;
}

/** True iff the slot carries a non-empty presence_source_id (the bonus marker). */
export function isBonusSlot(slot: QueueSlot): boolean {
  return typeof slot.presence_source_id === 'string' && slot.presence_source_id.trim() !== '';
}

/**
 * True iff the slot carries a `return_scope` (the missed-question return marker,
 * D-MISSED-RETURN-01 §2 R3). Same opt-in rule as bonus: the marker field's
 * presence is the truth, never position.
 */
export function isReturnSlot(slot: QueueSlot): boolean {
  return slot.return_scope === 'wrong' || slot.return_scope === 'expired';
}

/**
 * True iff the slot is APPENDED rather than part of the five — a +2 bonus slot or
 * a missed-question return slot.
 */
export function isAdditiveSlot(slot: QueueSlot): boolean {
  return isBonusSlot(slot) || isReturnSlot(slot);
}

/**
 * Core slots, input order preserved. The canonical "five".
 *
 * Excludes BOTH additive kinds. A return slot appends beyond the five exactly as
 * the +2 does (D-MISSED-RETURN-01 R3: "a friend's fresh question never loses its
 * seat to a repeat") — counting one here would quietly make the Daily Five a six
 * and break the D-F3 canon that the spoken count is always 5.
 */
export function getCoreSlots(slots: QueueSlot[]): QueueSlot[] {
  return slots.filter((slot) => !isAdditiveSlot(slot));
}

/**
 * The core slots that hold one of the five progress dots, in slot order.
 *
 * Skipping keeps the skipped slot and APPENDS a replacement core slot at the
 * next slot_index (api/daily/skip), so after N skips there are 5+N core slots.
 * The replacement takes over the skipped slot's dot: while there are more than
 * `size` core slots, the earliest skipped one is dropped. A skip whose
 * replacement failed to generate keeps its dot (shown as skipped). Without
 * this, home drew the five dots from slot_index 0-4 only — three skips read as
 * "all five done" while their replacements were still waiting (QA 2026-09-25).
 */
export function getLiveCoreSlots(slots: QueueSlot[], size: number): QueueSlot[] {
  const live = getCoreSlots(slots).sort((a, b) => a.slot_index - b.slot_index);
  while (live.length > size) {
    const skippedAt = live.findIndex((slot) => slot.skipped && !slot.answered);
    if (skippedAt === -1) break;
    live.splice(skippedAt, 1);
  }
  return live;
}

/**
 * The number (1..size) each core slot shows in the round. A skip keeps the
 * skipped slot and appends a replacement at the next slot_index, so numbering
 * by slot_index made the replacement "6." The replacement instead takes the
 * number the skip freed, the same way it takes the skipped slot's dot in
 * getLiveCoreSlots (QA 2026-09-25, S7). A replacement that is itself skipped
 * passes its number on again.
 */
export function getCoreNumbers(slots: QueueSlot[], size: number): Map<number, number> {
  const numbers = new Map<number, number>();
  const freed: number[] = [];
  getCoreSlots(slots)
    .sort((a, b) => a.slot_index - b.slot_index)
    .forEach((slot, index) => {
      const number = index < size ? index + 1 : (freed.shift() ?? index + 1);
      numbers.set(slot.slot_index, number);
      if (slot.skipped && !slot.answered) freed.push(number);
    });
  return numbers;
}

/** Return slots, input order preserved. */
export function getReturnSlots(slots: QueueSlot[]): QueueSlot[] {
  return slots.filter(isReturnSlot);
}

/** Bonus slots, input order preserved. */
export function getBonusSlots(slots: QueueSlot[]): QueueSlot[] {
  return slots.filter(isBonusSlot);
}

/** Live bonus count — the N in "+N friend bonus" (0 → no label). */
export function getBonusCount(slots: QueueSlot[]): number {
  return getBonusSlots(slots).length;
}

/**
 * Presence accessor: `{ id, name, extraCount }` for a bonus slot, else `null`.
 * Consumers use the null to decide whether to render attribution at all.
 */
export function getSlotPresence(slot: QueueSlot): BonusPresence | null {
  if (!isBonusSlot(slot)) return null;
  return {
    id: slot.presence_source_id as string,
    name: slot.presence_source_name ?? null,
    extraCount: slot.presence_source_extra_count ?? 0,
  };
}
