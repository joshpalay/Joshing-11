import { describe, expect, it, vi } from 'vitest';

import { asQueueSlots } from '@/server/daily/catchup';
import { type QueueSlot, queueSlotSchema } from '@/server/daily/types';

// Minimal slot carrying every required field of queueSlotSchema.
function validSlot(slotIndex: number): QueueSlot {
  return {
    slot_index: slotIndex,
    source: 'bot',
    domain: 'film_tv',
    question_text: `Question ${slotIndex}?`,
    answered: false,
  };
}

describe('asQueueSlots', () => {
  it('returns [] for non-array input', () => {
    expect(asQueueSlots(null)).toEqual([]);
    expect(asQueueSlots(undefined)).toEqual([]);
    expect(asQueueSlots({ slot_index: 0 })).toEqual([]);
    expect(asQueueSlots('nope')).toEqual([]);
  });

  it('returns a fully-valid array unchanged', () => {
    const slots = [validSlot(0), validSlot(1), validSlot(2)];
    const result = asQueueSlots(slots);
    expect(result).toHaveLength(3);
    expect(result).toEqual(slots);
  });

  it('salvages only the valid slots from a mixed array (exercises the previously-broken path)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const good = validSlot(0);
    const alsoGood = validSlot(2);
    // Malformed: missing required `question_text` and wrong-typed `answered`.
    const malformed = { slot_index: 1, source: 'bot', domain: 'film_tv', answered: 'yes' };

    const result = asQueueSlots([good, malformed, alsoGood]);

    expect(result).toHaveLength(2);
    expect(result).toEqual([good, alsoGood]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('returns [] when every element is malformed', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = asQueueSlots([{ slot_index: 'x' }, { nope: true }, 42]);
    expect(result).toEqual([]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('never returns an element that fails queueSlotSchema.safeParse (regression pin)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = asQueueSlots([validSlot(0), { broken: true }, validSlot(1)]);
    for (const slot of result) {
      expect(queueSlotSchema.safeParse(slot).success).toBe(true);
    }
    warn.mockRestore();
  });
});
