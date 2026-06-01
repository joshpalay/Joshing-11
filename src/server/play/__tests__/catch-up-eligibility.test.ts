import { describe, expect, it } from 'vitest';
import { isCatchUpSlotEligible } from '@/server/play/catch-up-eligibility';
import type { QueueSlot } from '@/server/daily/types';

function botSlot(overrides: Partial<QueueSlot> = {}): QueueSlot {
  return {
    slot_index: 0,
    source: 'bot',
    generated_question_id: 'gen-1',
    domain: 'apple trees',
    question_text: 'q?',
    answered: false,
    ...overrides,
  };
}

function friendSlot(overrides: Partial<QueueSlot> = {}): QueueSlot {
  return {
    slot_index: 0,
    source: 'friend',
    question_id: 'canonical-1',
    domain: 'apple trees',
    question_text: 'q?',
    answered: false,
    ...overrides,
  };
}

describe('isCatchUpSlotEligible', () => {
  it('accepts an untouched bot slot', () => {
    expect(isCatchUpSlotEligible(botSlot())).toBe(true);
  });

  it('accepts an untouched friend slot', () => {
    expect(isCatchUpSlotEligible(friendSlot())).toBe(true);
  });

  it('accepts a wrong-answered friend slot (regression: was silently dropped)', () => {
    expect(isCatchUpSlotEligible(friendSlot({ answered: true, answer_state: 'incorrect' }))).toBe(
      true,
    );
  });

  it('rejects a correctly-answered friend slot', () => {
    expect(isCatchUpSlotEligible(friendSlot({ answered: true, answer_state: 'correct' }))).toBe(
      false,
    );
  });

  it('rejects a dismissed friend slot', () => {
    expect(isCatchUpSlotEligible(friendSlot({ dismissed_at: '2026-05-27T00:00:00.000Z' }))).toBe(
      false,
    );
  });

  it('rejects a slot missing both question ids', () => {
    expect(
      isCatchUpSlotEligible({
        slot_index: 0,
        source: 'bot',
        domain: 'apple trees',
        question_text: 'q?',
        answered: false,
      }),
    ).toBe(false);
  });
});
