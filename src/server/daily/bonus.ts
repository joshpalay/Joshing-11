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
 */

import type { QueueSlot } from './types';

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

/** Core (non-bonus) slots, input order preserved. The canonical "five". */
export function getCoreSlots(slots: QueueSlot[]): QueueSlot[] {
  return slots.filter((slot) => !isBonusSlot(slot));
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
