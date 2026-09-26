import { describe, expect, it } from 'vitest';

import type { QueueSlot } from '@/server/daily/types';
import {
  getBonusCount,
  getBonusSlots,
  getCoreNumbers,
  getCoreSlots,
  getLiveCoreSlots,
  getSlotPresence,
  isBonusSlot,
} from '@/server/daily/bonus';
import { buildBonusOutcomes, buildCoreOutcomes } from '@/server/daily/status-outcomes';

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

function core(slot_index: number): QueueSlot {
  return slot({ slot_index, source: 'bot' });
}

function bonus(slot_index: number, presence: Partial<QueueSlot> = {}): QueueSlot {
  return slot({
    slot_index,
    presence_source_id: `friend-${slot_index}`,
    presence_source_name: `Friend ${slot_index}`,
    ...presence,
  });
}

describe('bonus selector', () => {
  it('treats a slot with a non-empty presence_source_id as bonus', () => {
    expect(isBonusSlot(bonus(5))).toBe(true);
    expect(isBonusSlot(core(0))).toBe(false);
  });

  describe('0 bonus', () => {
    const slots = [core(0), core(1), core(2), core(3), core(4)];

    it('all five are core, none bonus', () => {
      expect(getCoreSlots(slots)).toHaveLength(5);
      expect(getBonusSlots(slots)).toHaveLength(0);
      expect(getBonusCount(slots)).toBe(0);
    });
  });

  describe('1 bonus', () => {
    const slots = [core(0), core(1), core(2), core(3), core(4), bonus(5)];

    it('splits 5 core / 1 bonus', () => {
      expect(getCoreSlots(slots)).toHaveLength(5);
      expect(getBonusSlots(slots).map((s) => s.slot_index)).toEqual([5]);
      expect(getBonusCount(slots)).toBe(1);
    });
  });

  describe('2 bonus', () => {
    const slots = [core(0), core(1), core(2), core(3), core(4), bonus(5), bonus(6)];

    it('splits 5 core / 2 bonus', () => {
      expect(getCoreSlots(slots)).toHaveLength(5);
      expect(getBonusSlots(slots).map((s) => s.slot_index)).toEqual([5, 6]);
      expect(getBonusCount(slots)).toBe(2);
    });
  });

  describe('mixed order', () => {
    // Bonus slots are appended in practice, but the selector must not assume
    // position — it derives purely from presence, preserving input order.
    const slots = [bonus(5), core(0), bonus(6), core(1)];

    it('partitions by presence, preserving input order', () => {
      expect(getCoreSlots(slots).map((s) => s.slot_index)).toEqual([0, 1]);
      expect(getBonusSlots(slots).map((s) => s.slot_index)).toEqual([5, 6]);
      expect(getBonusCount(slots)).toBe(2);
    });
  });

  describe('malformed / missing presence → core', () => {
    it('empty-string and whitespace presence_source_id is core', () => {
      expect(isBonusSlot(slot({ presence_source_id: '' }))).toBe(false);
      expect(isBonusSlot(slot({ presence_source_id: '   ' }))).toBe(false);
    });

    it('missing presence_source_id is core even if a name slipped through', () => {
      expect(isBonusSlot(slot({ presence_source_name: 'Ghost' }))).toBe(false);
    });
  });

  describe('getSlotPresence', () => {
    it('returns null for a core slot', () => {
      expect(getSlotPresence(core(0))).toBeNull();
    });

    it('returns id/name/extraCount for a bonus slot', () => {
      expect(
        getSlotPresence(
          bonus(5, { presence_source_name: 'Ada', presence_source_extra_count: 2 }),
        ),
      ).toEqual({ id: 'friend-5', name: 'Ada', extraCount: 2 });
    });

    it('defaults name to null and extraCount to 0 when absent', () => {
      expect(
        getSlotPresence(
          slot({ slot_index: 5, presence_source_id: 'friend-5' }),
        ),
      ).toEqual({ id: 'friend-5', name: null, extraCount: 0 });
    });
  });
});

describe('getLiveCoreSlots', () => {
  const skipped = (i: number) => slot({ slot_index: i, skipped: true });
  const answered = (i: number) => slot({ slot_index: i, answered: true, answer_state: 'correct' });

  it('gives a skipped slot the replacement dot (QA 2026-09-25)', () => {
    // 2 answered, 3 skipped, 3 replacements appended at 5-7, bonus at 8.
    const slots = [answered(0), skipped(1), answered(2), skipped(3), skipped(4), core(5), core(6), core(7), bonus(8)];
    expect(getLiveCoreSlots(slots, 5).map((s) => s.slot_index)).toEqual([0, 2, 5, 6, 7]);
  });

  it('keeps a skip whose replacement never arrived', () => {
    const slots = [answered(0), skipped(1), core(2), core(3), core(4)];
    expect(getLiveCoreSlots(slots, 5).map((s) => s.slot_index)).toEqual([0, 1, 2, 3, 4]);
  });

  it('never counts bonus or second-look slots', () => {
    const slots = [core(0), bonus(1), core(2), slot({ slot_index: 3, return_scope: 'wrong' })];
    expect(getLiveCoreSlots(slots, 5).map((s) => s.slot_index)).toEqual([0, 2]);
  });
});

describe('getCoreNumbers (QA 2026-09-25, S7)', () => {
  it('gives a skip replacement the number the skip freed, never "6"', () => {
    const slots = [
      core(0),
      core(1),
      slot({ slot_index: 2, skipped: true }),
      core(3),
      core(4),
      core(5), // replacement for slot 2
    ];
    const numbers = getCoreNumbers(slots, 5);
    expect(numbers.get(2)).toBe(3);
    expect(numbers.get(5)).toBe(3);
    expect(Math.max(...numbers.values())).toBe(5);
  });

  it('passes the number on again when the replacement is skipped too', () => {
    const slots = [
      slot({ slot_index: 0, skipped: true }),
      core(1),
      core(2),
      core(3),
      core(4),
      slot({ slot_index: 5, skipped: true }),
      core(6),
    ];
    const numbers = getCoreNumbers(slots, 5);
    expect([numbers.get(0), numbers.get(5), numbers.get(6)]).toEqual([1, 1, 1]);
  });

  it('leaves bonus slots out of the numbering', () => {
    expect(getCoreNumbers([core(0), bonus(1)], 5).has(1)).toBe(false);
  });
});

describe('home dots match the round and summary (QA 2026-09-25, S5)', () => {
  it('a short round with additive slots at slot_index 2-4 draws 2 core dots, not 5', () => {
    const slots = [
      slot({ slot_index: 0, answered: true, answer_state: 'correct' }),
      slot({ slot_index: 1, answered: true, answer_state: 'incorrect' }),
      slot({ slot_index: 2, return_scope: 'wrong', answered: true, answer_state: 'correct' }),
      bonus(3, { answered: true, answer_state: 'incorrect' }),
      bonus(4, { answered: true, answer_state: 'correct' }),
    ];
    expect(buildCoreOutcomes(slots)).toEqual(['correct', 'incorrect']);
    expect(buildBonusOutcomes(slots)).toEqual(['incorrect', 'correct']);
  });

  it('a skip replacement takes the skipped dot', () => {
    const slots = [
      core(0),
      core(1),
      slot({ slot_index: 2, skipped: true }),
      core(3),
      core(4),
      slot({ slot_index: 5, answered: true, answer_state: 'correct' }),
    ];
    expect(buildCoreOutcomes(slots)).toEqual([
      'unanswered',
      'unanswered',
      'unanswered',
      'unanswered',
      'correct',
    ]);
  });

  it('no queue yet: the five the round will hold', () => {
    expect(buildCoreOutcomes([])).toHaveLength(5);
  });
});
