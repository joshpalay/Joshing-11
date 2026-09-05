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

// Daily Five +2: the queue is variable-length (core 5 + 0-2 bonus slots).
//
// REVERSED BY A1a. This block previously asserted that completion tracks the
// ACTUAL slot count -- a 7-slot queue stayed incomplete until all seven were
// answered. That was a deliberate decision, made to stop completion being
// hardcoded to five, and the variable-length concern behind it is still valid.
// But applied to ADDITIVE slots it stranded the modal queue: bonus questions
// are optional, so a player who answers the five core questions and stops
// leaves them pending forever and the round never completes. Measured on the
// live database: 5 queues permanently in that state, four of them
// 5-answered-of-5 with a bonus slot open. Completion also gates the demand-pull
// bank replenish, so those rounds never restocked.
//
// The rule is now: completion tracks the actual CORE count (still not a
// hardcoded five), and additive slots -- bonus and missed-question returns --
// never hold the round open. That matches the D-F3 canon these helpers already
// enforce everywhere else: bonus slots never count toward the five, so they
// must not decide whether the five are done.
describe('isRoundComplete -- variable-length queues, core-scoped (A1a)', () => {
  function bonusSlot(slot_index: number, answered: boolean): QueueSlot {
    return {
      ...slot(slot_index, { answered }),
      presence_source_id: `friend-${slot_index}`,
      presence_source_name: 'Robyn',
      difficulty_estimate: 'accessible',
    } as QueueSlot;
  }

  // The original concern, preserved: completion must follow the real core
  // count, never a hardcoded 5.
  for (const coreCount of [3, 4, 5]) {
    it(`a ${coreCount}-core queue is incomplete until the last CORE slot is resolved`, () => {
      const indices = Array.from({ length: coreCount }, (_, i) => i);
      const partial = indices.map((i) =>
        i < coreCount - 1 ? slot(i, { answered: true }) : slot(i),
      );
      expect(isRoundComplete(partial)).toBe(false);

      const full = indices.map((i) => slot(i, { answered: true }));
      expect(isRoundComplete(full)).toBe(true);
    });
  }

  for (const bonusCount of [1, 2]) {
    it(`${bonusCount} unanswered bonus slot(s) do NOT hold the round open`, () => {
      const slots = [
        ...[0, 1, 2, 3, 4].map((i) => slot(i, { answered: true })),
        ...Array.from({ length: bonusCount }, (_, b) => bonusSlot(5 + b, false)),
      ];
      expect(isRoundComplete(slots)).toBe(true);
      // ...but they remain playable: navigation still sees them.
      expect(hasPendingSlot(slots)).toBe(true);
    });
  }

  it('answering the bonus slots too still reads complete', () => {
    const slots = [
      ...[0, 1, 2, 3, 4].map((i) => slot(i, { answered: true })),
      bonusSlot(5, true),
      bonusSlot(6, true),
    ];
    expect(isRoundComplete(slots)).toBe(true);
    expect(hasPendingSlot(slots)).toBe(false);
  });
});
