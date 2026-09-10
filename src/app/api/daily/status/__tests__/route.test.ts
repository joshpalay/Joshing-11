import { beforeEach, describe, expect, it, vi } from 'vitest';

// F3 (end-to-end-gameplay-ux-audit.md): "daily/status counts all answered
// slots before clamping to five, while outcome dots exclude additive slots."
// These are the "route tests for core/bonus/return counting" the audit's
// fix plan called for.

const { getSessionMock, getTodaysDailyQueueMock, getDailyPreferencesMock } = vi.hoisted(() => ({
  getSessionMock: vi.fn(),
  getTodaysDailyQueueMock: vi.fn(),
  getDailyPreferencesMock: vi.fn(),
}));

vi.mock('@/server/auth/session', () => ({ getSession: getSessionMock }));
vi.mock('@/server/db/queries/daily', () => ({ getTodaysDailyQueue: getTodaysDailyQueueMock }));
vi.mock('@/server/db/queries/daily-preferences', () => ({
  getDailyPreferences: getDailyPreferencesMock,
}));

import { GET } from '@/app/api/daily/status/route';
import type { QueueSlot } from '@/server/daily/types';

function coreSlot(index: number, overrides: Partial<QueueSlot> = {}): QueueSlot {
  return {
    slot_index: index,
    source: 'bot',
    domain: 'History',
    question_text: `Core question ${index}`,
    answered: false,
    ...overrides,
  };
}

// A +2 bonus slot: the presence_source_id marker is what makes it bonus, per
// bonus.ts's isBonusSlot — position alone is never the signal.
function bonusSlot(index: number, overrides: Partial<QueueSlot> = {}): QueueSlot {
  return {
    slot_index: index,
    source: 'bot',
    domain: 'Friend territory',
    question_text: `Bonus question ${index}`,
    answered: false,
    presence_source_id: 'friend-1',
    presence_source_name: 'Robyn',
    ...overrides,
  };
}

// An appended missed-question-return slot: the return_scope marker makes it
// additive, same convention as bonus (see isReturnSlot).
function returnSlot(index: number, overrides: Partial<QueueSlot> = {}): QueueSlot {
  return {
    slot_index: index,
    source: 'bot',
    domain: 'Missed topic',
    question_text: `Return question ${index}`,
    answered: false,
    return_scope: 'wrong',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  getSessionMock.mockResolvedValue({ userId: 'user-1' });
  getDailyPreferencesMock.mockResolvedValue({
    selectedDomains: [],
    difficulty: 'moderate',
    domainMode: 'declared',
  });
});

describe('GET /api/daily/status', () => {
  it('401s without a session', async () => {
    getSessionMock.mockResolvedValue(null);
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it('reports the no-queue defaults (5 remaining, 0 answered, incomplete)', async () => {
    getTodaysDailyQueueMock.mockResolvedValue(null);
    const res = await GET();
    const body = await res.json();
    expect(body.answered).toBe(0);
    expect(body.questionsAnswered).toBe(0);
    expect(body.questionsRemaining).toBe(5);
    expect(body.isComplete).toBe(false);
  });

  it('counts a fully-answered core round as 5 of 5, complete', async () => {
    getTodaysDailyQueueMock.mockResolvedValue({
      id: 'queue-1',
      queueDate: '2026-09-10',
      slots: [0, 1, 2, 3, 4].map((i) => coreSlot(i, { answered: true, answer_state: 'correct' })),
    });
    const res = await GET();
    const body = await res.json();
    expect(body.answered).toBe(5);
    expect(body.questionsAnswered).toBe(5);
    expect(body.questionsRemaining).toBe(0);
    expect(body.isComplete).toBe(true);
  });

  // The exact regression F3 describes: 3 of 5 core questions answered, 2
  // core questions still pending, but BOTH bonus slots answered. Before the
  // fix, `answered` summed every answered slot (3 core + 2 bonus = 5) and
  // got clamped to 5 -- reporting questionsAnswered: 5, questionsRemaining: 0
  // (looking fully done) while isComplete correctly still said false, a
  // direct contradiction between the two fields in one response.
  it('does not let bonus answers inflate the core "of 5" count', async () => {
    getTodaysDailyQueueMock.mockResolvedValue({
      id: 'queue-1',
      queueDate: '2026-09-10',
      slots: [
        coreSlot(0, { answered: true, answer_state: 'correct' }),
        coreSlot(1, { answered: true, answer_state: 'correct' }),
        coreSlot(2, { answered: true, answer_state: 'correct' }),
        coreSlot(3), // still pending
        coreSlot(4), // still pending
        bonusSlot(5, { answered: true, answer_state: 'correct' }),
        bonusSlot(6, { answered: true, answer_state: 'correct' }),
      ],
    });
    const res = await GET();
    const body = await res.json();
    expect(body.answered).toBe(3);
    expect(body.questionsAnswered).toBe(3);
    expect(body.questionsRemaining).toBe(2);
    expect(body.isComplete).toBe(false);
    // The two duplicate response shapes (camelCase + legacy) must agree.
    expect(body.total).toBe(5);
    expect(body.complete).toBe(false);
  });

  // Same leak, but via a missed-question-return slot instead of a bonus
  // slot -- isAdditiveSlot/getCoreSlots treats both the same way, and the
  // fix must too.
  it('does not let a missed-question-return answer inflate the core count either', async () => {
    getTodaysDailyQueueMock.mockResolvedValue({
      id: 'queue-1',
      queueDate: '2026-09-10',
      slots: [
        coreSlot(0, { answered: true, answer_state: 'correct' }),
        coreSlot(1), // pending
        coreSlot(2), // pending
        coreSlot(3), // pending
        coreSlot(4), // pending
        returnSlot(5, { answered: true, answer_state: 'correct' }),
      ],
    });
    const res = await GET();
    const body = await res.json();
    expect(body.answered).toBe(1);
    expect(body.questionsAnswered).toBe(1);
    expect(body.questionsRemaining).toBe(4);
    expect(body.isComplete).toBe(false);
  });

  // A skipped-but-unreplaced core slot still completes the round (per
  // isRoundComplete's "no pending slot" rule) even though fewer than 5 were
  // ANSWERED -- confirms the fix doesn't couple answered-count to completion.
  it('treats a round with a skipped core slot as complete without answered hitting 5', async () => {
    getTodaysDailyQueueMock.mockResolvedValue({
      id: 'queue-1',
      queueDate: '2026-09-10',
      slots: [
        coreSlot(0, { answered: true, answer_state: 'correct' }),
        coreSlot(1, { answered: true, answer_state: 'correct' }),
        coreSlot(2, { answered: true, answer_state: 'correct' }),
        coreSlot(3, { answered: true, answer_state: 'correct' }),
        coreSlot(4, { skipped: true }),
      ],
    });
    const res = await GET();
    const body = await res.json();
    expect(body.answered).toBe(4);
    expect(body.questionsAnswered).toBe(4);
    expect(body.isComplete).toBe(true);
    expect(body.questionsRemaining).toBe(0);
  });

  it('keeps bonusOutcomes reporting bonus answers separately, untouched by the core-count fix', async () => {
    getTodaysDailyQueueMock.mockResolvedValue({
      id: 'queue-1',
      queueDate: '2026-09-10',
      slots: [
        ...[0, 1, 2, 3, 4].map((i) => coreSlot(i, { answered: true, answer_state: 'correct' })),
        bonusSlot(5, { answered: true, answer_state: 'incorrect' }),
        bonusSlot(6), // unanswered
      ],
    });
    const res = await GET();
    const body = await res.json();
    expect(body.answered).toBe(5); // core only, bonus not counted here
    expect(body.bonusOutcomes).toEqual(['incorrect', 'unanswered']);
    expect(body.slotOutcomes).toEqual(['correct', 'correct', 'correct', 'correct', 'correct']);
  });
});
