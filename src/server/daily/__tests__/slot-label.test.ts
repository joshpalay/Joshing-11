import { describe, expect, it } from 'vitest';

import type { QueueSlot } from '@/server/daily/types';
import { slotCategoryLabel } from '@/server/daily/slot-label';

function slot(overrides: Partial<QueueSlot>): QueueSlot {
  return {
    slot_index: 0,
    source: 'bot',
    domain: 'Renaissance Florence',
    question_text: 'q',
    answered: false,
    ...overrides,
  };
}

describe('slotCategoryLabel', () => {
  it('keeps the specific chosen topic ahead of a broad category', () => {
    expect(slotCategoryLabel(slot({ broad_category: 'History' }))).toBe('Renaissance Florence');
  });

  // The regression this function exists for. Caught live: a new player's first
  // two questions were both tagged Renaissance Florence and both badged
  // "General Knowledge", on the screen promising questions made from their own
  // topics.
  it('skips the General Knowledge bucket and falls through to the domain', () => {
    expect(
      slotCategoryLabel(
        slot({ broad_category: 'General Knowledge', category: 'general_knowledge' }),
      ),
    ).toBe('Renaissance Florence');
  });

  it('skips the generic bucket in its mapped form too', () => {
    // categoryLabel('general_knowledge') renders "General Knowledge", so the
    // guard has to catch the mapped string, not just the raw column.
    expect(slotCategoryLabel(slot({ category: 'general_knowledge' }))).toBe(
      'Renaissance Florence',
    );
  });

  it('falls back to the mapped category when broad_category is generic but category is not', () => {
    expect(
        slotCategoryLabel(slot({ domain: '', broad_category: 'Other', category: 'pop_culture' })),
    ).toBe('Pop Culture');
  });

  it('ignores a whitespace-only broad_category', () => {
    expect(slotCategoryLabel(slot({ broad_category: '   ' }))).toBe('Renaissance Florence');
  });

  it('returns the domain when nothing else is present', () => {
    expect(slotCategoryLabel(slot({}))).toBe('Renaissance Florence');
  });

  it('trims a specific domain before displaying it', () => {
    expect(slotCategoryLabel(slot({ domain: '  Renaissance Florence  ', broad_category: 'History' })))
      .toBe('Renaissance Florence');
  });

  it('uses a meaningful category when the domain is generic or missing', () => {
    expect(slotCategoryLabel(slot({ domain: 'General Knowledge', broad_category: 'History' })))
      .toBe('History');
    expect(slotCategoryLabel(slot({ domain: '', broad_category: 'History' }))).toBe('History');
  });

  // Callers render no badge for an empty label rather than a blank chip, so the
  // empty string has to survive rather than becoming a literal.
  it('yields an empty string when the slot carries no usable label at all', () => {
    expect(slotCategoryLabel(slot({ domain: '' }))).toBe('');
  });
});
