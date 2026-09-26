import { describe, expect, it } from 'vitest'
import { CATCHUP_RETRY_COOLDOWN_MS, isCatchUpSlotEligible } from '@/server/play/catch-up-eligibility'
import type { QueueSlot } from '@/server/daily/types'

function botSlot(overrides: Partial<QueueSlot> = {}): QueueSlot {
  return {
    slot_index: 0,
    source: 'bot',
    generated_question_id: 'gen-1',
    domain: 'apple trees',
    question_text: 'q?',
    answered: false,
    ...overrides,
  }
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
  }
}

describe('isCatchUpSlotEligible', () => {
  it('accepts an untouched bot slot', () => {
    expect(isCatchUpSlotEligible(botSlot())).toBe(true)
  })

  it('accepts an untouched friend slot', () => {
    expect(isCatchUpSlotEligible(friendSlot())).toBe(true)
  })

  it('accepts a wrong-answered friend slot (regression: was silently dropped)', () => {
    expect(
      isCatchUpSlotEligible(friendSlot({ answered: true, answer_state: 'incorrect' })),
    ).toBe(true)
  })

  it('rejects a correctly-answered friend slot', () => {
    expect(
      isCatchUpSlotEligible(friendSlot({ answered: true, answer_state: 'correct' })),
    ).toBe(false)
  })

  it('rejects a dismissed friend slot', () => {
    expect(
      isCatchUpSlotEligible(friendSlot({ dismissed_at: '2026-05-27T00:00:00.000Z' })),
    ).toBe(false)
  })

  it('rejects a slot missing both question ids', () => {
    expect(
      isCatchUpSlotEligible({
        slot_index: 0,
        source: 'bot',
        domain: 'apple trees',
        question_text: 'q?',
        answered: false,
      }),
    ).toBe(false)
  })

  // Today's round is date-eligible so wrong answers resurface at once, but its
  // unanswered slots are still pending — counting them as "missed" put the same
  // slots behind "Resume round" and "N missed questions" simultaneously.
  describe("today's own queue", () => {
    it('rejects an unanswered slot from today — still pending, not missed', () => {
      expect(isCatchUpSlotEligible(botSlot(), true)).toBe(false)
      expect(isCatchUpSlotEligible(friendSlot(), true)).toBe(false)
    })

    it('rejects a skipped-for-now slot from today, honouring "another day"', () => {
      expect(isCatchUpSlotEligible(botSlot({ skipped: true }), true)).toBe(false)
    })

    it('still accepts a wrong answer from today', () => {
      expect(
        isCatchUpSlotEligible(friendSlot({ answered: true, answer_state: 'incorrect' }), true),
      ).toBe(true)
    })

    it('accepts the same unanswered slot once it is no longer today', () => {
      expect(isCatchUpSlotEligible(botSlot(), false)).toBe(true)
    })
  })

  // "That's the round — 0 of 1. You're all caught up." used to be followed by
  // home re-offering the same question seconds later (QA 2026-09-26, S5).
  describe('after a wrong catch-up attempt', () => {
    const attemptedAt = '2026-09-26T15:30:00.000Z'
    const missedTwice = friendSlot({
      answered: true,
      answer_state: 'incorrect',
      catchup_answer_state: 'incorrect',
      catchup_answered_at: attemptedAt,
    })

    it('sits out right after the attempt', () => {
      expect(
        isCatchUpSlotEligible(missedTwice, true, new Date('2026-09-26T15:31:00.000Z')),
      ).toBe(false)
    })

    it('comes back once the cool-down has passed', () => {
      const later = new Date(new Date(attemptedAt).getTime() + CATCHUP_RETRY_COOLDOWN_MS + 1)
      expect(isCatchUpSlotEligible(missedTwice, false, later)).toBe(true)
    })

    it('a correct catch-up attempt still closes the slot for good', () => {
      expect(
        isCatchUpSlotEligible(
          { ...missedTwice, catchup_answer_state: 'correct' },
          false,
          new Date('2026-10-30T00:00:00.000Z'),
        ),
      ).toBe(false)
    })
  })
})
