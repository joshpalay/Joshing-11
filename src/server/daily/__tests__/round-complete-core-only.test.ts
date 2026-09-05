import { describe, expect, it } from 'vitest';

import { hasPendingSlot, isRoundComplete, type QueueSlot } from '@/server/daily/types';

function slot(overrides: Partial<QueueSlot>): QueueSlot {
  return {
    slot_index: 0,
    source: 'bot',
    domain: 'general',
    question_text: 'q',
    answered: false,
    ...overrides,
  };
}

const core = (i: number, o: Partial<QueueSlot> = {}) => slot({ slot_index: i, ...o });
const bonus = (i: number, o: Partial<QueueSlot> = {}) =>
  slot({ slot_index: i, presence_source_id: 'friend-1', ...o });
const ret = (i: number, o: Partial<QueueSlot> = {}) =>
  slot({ slot_index: i, return_scope: 'wrong', ...o });

describe('isRoundComplete — core-only (A1a)', () => {
  it('COMPLETES the modal queue when all five core are answered and bonus is untouched', () => {
    // The live stranding bug. 5 core + 2 bonus; the player answers the five and
    // stops, because the bonus two are optional. Under the old all-slots rule
    // the bonus slots stayed pending and the round NEVER completed -- measured
    // on 5 production queues, four of them exactly this shape.
    const slots = [
      ...[0, 1, 2, 3, 4].map((i) => core(i, { answered: true })),
      bonus(5),
      bonus(6),
    ];
    expect(isRoundComplete(slots)).toBe(true);
  });

  it('COMPLETES when a return slot is left pending', () => {
    // Return slots are additive by the same rule as bonus (D-MISSED-RETURN-01
    // R3), so they must not hold the round open either.
    const slots = [...[0, 1, 2, 3, 4].map((i) => core(i, { answered: true })), ret(5)];
    expect(isRoundComplete(slots)).toBe(true);
  });

  it('stays INCOMPLETE while a core slot is pending, even if every bonus is answered', () => {
    const slots = [
      ...[0, 1, 2, 3].map((i) => core(i, { answered: true })),
      core(4),
      bonus(5, { answered: true }),
    ];
    expect(isRoundComplete(slots)).toBe(false);
  });

  it('treats a skipped core slot as resolved, not pending', () => {
    // Pre-existing behaviour, preserved: a skipped slot whose replacement
    // failed to generate leaves nothing to play, so the round is genuinely over.
    const slots = [
      ...[0, 1, 2, 3].map((i) => core(i, { answered: true })),
      core(4, { skipped: true }),
    ];
    expect(isRoundComplete(slots)).toBe(true);
  });

  it('completes a SHORT queue once its core slots are resolved', () => {
    // A1a deliberately does NOT fix short-queue over-completion -- that needs
    // target_size compared at persist (A1b) and is under-delivery, not
    // stranding. Pinned here so A1b's arrival is a visible change.
    const slots = [...[0, 1, 2].map((i) => core(i, { answered: true })), bonus(3)];
    expect(isRoundComplete(slots)).toBe(true);
  });

  it('is false for an empty queue', () => {
    expect(isRoundComplete([])).toBe(false);
  });

  it('falls back to all slots when a queue has no core slots at all', () => {
    // Degenerate shape the core-only rule was not designed for; falling back
    // keeps it completable instead of stranding it forever.
    expect(isRoundComplete([bonus(0, { answered: true })])).toBe(true);
    expect(isRoundComplete([bonus(0)])).toBe(false);
  });

  it('leaves hasPendingSlot alone — navigation must still see bonus slots', () => {
    // The player can still PLAY a pending bonus slot; only the completeness
    // verdict is core-scoped. If this ever changes, /daily stops offering the
    // bonus questions at all.
    const slots = [...[0, 1, 2, 3, 4].map((i) => core(i, { answered: true })), bonus(5)];
    expect(hasPendingSlot(slots)).toBe(true);
    expect(isRoundComplete(slots)).toBe(true);
  });
});
