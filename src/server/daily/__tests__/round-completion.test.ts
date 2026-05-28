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
