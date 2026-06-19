import { describe, expect, it } from 'vitest';

import type { QueueSlot } from '@/server/daily/types';
import {
  getBonusCount,
  getBonusSlots,
  getCoreSlots,
  getSlotPresence,
  isBonusSlot,
} from '@/server/daily/bonus';

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
