import { describe, expect, it } from 'vitest';

import { hasPendingSlot, isRoundComplete, type QueueSlot } from '@/server/daily/types';

// Minimal slot factory — only the fields the completion predicates read.
function slot(
  slot_index: number,
  state: { answered?: boolean; skipped?: boolean } = {},
): QueueSlot {
  return {
    slot_index,
    source: 'bot',
    domain: 'test',
    question_text: 'q',
    answered: state.answered ?? false,
    skipped: state.skipped,
  } as QueueSlot;
}

describe('isRoundComplete / hasPendingSlot', () => {
  it('a fresh round (all pending) is not complete', () => {
    const slots = [0, 1, 2, 3, 4].map((i) => slot(i));
    expect(hasPendingSlot(slots)).toBe(true);
    expect(isRoundComplete(slots)).toBe(false);
  });

  it('four answered + one pending is not complete', () => {
    const slots = [
      slot(0, { answered: true }),
      slot(1, { answered: true }),
      slot(2, { answered: true }),
      slot(3, { answered: true }),
      slot(4),
    ];
    expect(isRoundComplete(slots)).toBe(false);
  });

  it('four answered + one skipped with no replacement is complete (the bug case)', () => {
    const slots = [
      slot(0, { answered: true }),
      slot(1, { answered: true }),
      slot(2, { answered: true }),
      slot(3, { answered: true }),
      slot(4, { skipped: true }),
    ];
    expect(hasPendingSlot(slots)).toBe(false);
    expect(isRoundComplete(slots)).toBe(true);
  });

  it('a skipped slot with a generated replacement keeps the round resumable', () => {
    const slots = [
      slot(0, { answered: true }),
      slot(1, { answered: true }),
      slot(2, { answered: true }),
      slot(3, { answered: true }),
      slot(4, { skipped: true }),
      slot(5), // replacement question
    ];
    expect(hasPendingSlot(slots)).toBe(true);
    expect(isRoundComplete(slots)).toBe(false);
  });

  it('an empty queue is not complete', () => {
    expect(isRoundComplete([])).toBe(false);
  });
});

// Daily Five +2: the queue is variable-length (core 5 + 0–2 bonus slots), so
// completion must track the ACTUAL slot count at 5, 6, and 7 — not a fixed five.
describe('isRoundComplete — variable 5–7 slot queues (Daily Five +2)', () => {
  function bonusSlot(slot_index: number, answered: boolean): QueueSlot {
    return {
      ...slot(slot_index, { answered }),
      answerer_id: `answerer-${slot_index}`,
      answerer_name: 'Robyn',
      difficulty_estimate: 'accessible',
    } as QueueSlot;
  }

  for (const total of [5, 6, 7]) {
    it(`a ${total}-slot queue is incomplete until the last slot is answered`, () => {
      const indices = Array.from({ length: total }, (_, i) => i);
      const partial = indices.map((i) =>
        i < total - 1
          ? i < 5
            ? slot(i, { answered: true })
            : bonusSlot(i, true)
          : i < 5
            ? slot(i)
            : bonusSlot(i, false),
      );
      expect(isRoundComplete(partial)).toBe(false);

      const full = indices.map((i) => (i < 5 ? slot(i, { answered: true }) : bonusSlot(i, true)));
      expect(isRoundComplete(full)).toBe(true);
      expect(hasPendingSlot(full)).toBe(false);
    });
  }
});
