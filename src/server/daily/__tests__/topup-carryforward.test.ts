import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { DAILY_QUEUE_SIZE, type QueueSlot } from '@/server/daily/types';

// queue-orchestrator imports @/server/db/queries/daily (→ @/server/db, which
// throws at module load without a connection string). Mock the daily surface with
// faithful PURE slot builders so this unit exercises only mergeCarriedWithFresh.
const mocks = vi.hoisted(() => ({
  getPriorInWindowDailyQueue: vi.fn(),
  carryForwardQueueWithSlots: vi.fn(),
  generateDailyQuestionsFromKnowledgeBase: vi.fn(),
}));

vi.mock('@/server/db/queries/daily', () => ({
  buildBotSlot: (q: { id: string; canonicalSubcategory: string; questionText: string }, position: number) => ({
    slot_index: position,
    source: 'bot',
    generated_question_id: q.id,
    domain: q.canonicalSubcategory,
    question_text: q.questionText,
    answered: false,
  }),
  // Unused by mergeCarriedWithFresh but imported by the module under test.
  buildAuthoredSlot: vi.fn(),
  buildHouseSlot: vi.fn(),
  buildPresenceSlot: vi.fn(),
  carryForwardUntouchedDailyQueue: vi.fn(),
  carryForwardQueueWithSlots: mocks.carryForwardQueueWithSlots,
  clearStaleShortTodayQueue: vi.fn(),
  countDailyQueues: vi.fn(),
  getKnowledgeBase: vi.fn(),
  getPriorInWindowDailyQueue: mocks.getPriorInWindowDailyQueue,
  getTodaysDailyQueue: vi.fn(),
  persistDailyQueue: vi.fn(),
  pickEligibleAuthoredQuestions: vi.fn(),
  pickHouseQuestions: vi.fn(),
  getRecentAnsweredAnswerKeys: vi.fn(),
  getRecentAnsweredEntities: vi.fn(),
}));

vi.mock('@/server/daily/generate-questions', () => ({
  generateDailyQuestionsFromKnowledgeBase: mocks.generateDailyQuestionsFromKnowledgeBase,
}));

vi.mock('@/server/questions/canonical-subcategory', () => ({
  // A subcategory of 'generic' is treated as a bucket label to drop.
  isGenericSubcategory: (s: string) => s === 'generic',
}));

let mergeCarriedWithFresh: typeof import('@/server/daily/queue-orchestrator').mergeCarriedWithFresh;
let topUpAndCarryForwardPartialQueue: typeof import('@/server/daily/queue-orchestrator').topUpAndCarryForwardPartialQueue;

beforeAll(async () => {
  process.env.DATABASE_URL ??= 'postgres://user:pass@localhost:5432/joshing_test';
  ({ mergeCarriedWithFresh, topUpAndCarryForwardPartialQueue } = await import(
    '@/server/daily/queue-orchestrator'
  ));
});

function carriedSlot(text: string, index: number, answered = false): QueueSlot {
  return {
    slot_index: index,
    source: 'bot',
    generated_question_id: `carried-${index}`,
    domain: 'History',
    broad_category: null,
    category: null,
    question_text: text,
    difficulty_estimate: null,
    answered,
    difficulty_stepped_up: false,
  } as QueueSlot;
}

function freshQuestion(id: string, text: string, subcategory = 'History') {
  return {
    id,
    questionText: text,
    canonicalSubcategory: subcategory,
    broadCategory: null,
    difficultyEstimate: null,
  } as Parameters<typeof mergeCarriedWithFresh>[1][number];
}

describe('mergeCarriedWithFresh', () => {
  it('keeps carried slots first (re-indexed) and tops up with fresh to five', () => {
    const carried = [carriedSlot('Q1', 7), carriedSlot('Q2', 9), carriedSlot('Q3', 4)];
    const fresh = [freshQuestion('f1', 'Q4'), freshQuestion('f2', 'Q5')];

    const { merged, newGeneratedIds } = mergeCarriedWithFresh(carried, fresh);

    expect(merged).toHaveLength(DAILY_QUEUE_SIZE);
    expect(merged.map((s) => s.slot_index)).toEqual([0, 1, 2, 3, 4]);
    expect(merged.slice(0, 3).map((s) => s.question_text)).toEqual(['Q1', 'Q2', 'Q3']);
    expect(merged.slice(3).map((s) => s.question_text)).toEqual(['Q4', 'Q5']);
    expect(newGeneratedIds).toEqual(['f1', 'f2']);
  });

  it('does not duplicate a fresh question whose text matches a carried slot', () => {
    const carried = [carriedSlot('Repeat', 0), carriedSlot('Q2', 1), carriedSlot('Q3', 2)];
    // ' repeat ' normalizes to the carried 'Repeat' and must be dropped.
    const fresh = [freshQuestion('dup', ' repeat '), freshQuestion('f1', 'Q4'), freshQuestion('f2', 'Q5')];

    const { merged, newGeneratedIds } = mergeCarriedWithFresh(carried, fresh);

    expect(newGeneratedIds).toEqual(['f1', 'f2']);
    expect(merged.map((s) => s.question_text)).toEqual(['Repeat', 'Q2', 'Q3', 'Q4', 'Q5']);
  });

  it('skips generic-subcategory fresh questions', () => {
    const carried = [carriedSlot('Q1', 0), carriedSlot('Q2', 1), carriedSlot('Q3', 2)];
    const fresh = [freshQuestion('g', 'GenericQ', 'generic'), freshQuestion('f1', 'Q4'), freshQuestion('f2', 'Q5')];

    const { newGeneratedIds } = mergeCarriedWithFresh(carried, fresh);
    expect(newGeneratedIds).toEqual(['f1', 'f2']);
  });

  it('caps at DAILY_QUEUE_SIZE — extra fresh questions are ignored', () => {
    const carried = [carriedSlot('Q1', 0), carriedSlot('Q2', 1), carriedSlot('Q3', 2)];
    const fresh = [freshQuestion('f1', 'Q4'), freshQuestion('f2', 'Q5'), freshQuestion('f3', 'Q6')];

    const { merged, newGeneratedIds } = mergeCarriedWithFresh(carried, fresh);
    expect(merged).toHaveLength(DAILY_QUEUE_SIZE);
    expect(newGeneratedIds).toEqual(['f1', 'f2']); // f3 dropped at the cap
  });

  it('adds nothing when the carried set already fills five', () => {
    const carried = Array.from({ length: 5 }, (_, i) => carriedSlot(`Q${i}`, i));
    const fresh = [freshQuestion('f1', 'extra')];

    const { merged, newGeneratedIds } = mergeCarriedWithFresh(carried, fresh);
    expect(merged).toHaveLength(DAILY_QUEUE_SIZE);
    expect(newGeneratedIds).toEqual([]);
  });
});

// Regression: an unanswered +2 bonus slot or missed-return "Second look" slot
// left over from a FINISHED prior round must never be carried forward as a
// core slot of the next day's queue — that re-indexes it to slot_index 0 and
// hands it back as the FIRST question of the next game, ahead of five fresh
// core questions (the bug reported against B-MISSED-RETURN-01 / the +2 bonus).
describe('topUpAndCarryForwardPartialQueue — bonus/return exclusion', () => {
  function coreSlot(text: string, index: number, answered: boolean): QueueSlot {
    return {
      slot_index: index,
      source: 'bot',
      generated_question_id: `core-${index}`,
      domain: 'History',
      question_text: text,
      answered,
    } as QueueSlot;
  }

  function bonusSlot(text: string, index: number): QueueSlot {
    return {
      slot_index: index,
      source: 'bot',
      generated_question_id: `bonus-${index}`,
      domain: 'History',
      question_text: text,
      answered: false,
      presence_source_id: 'friend-1',
      presence_source_name: 'Friend',
    } as QueueSlot;
  }

  function returnSlot(text: string, index: number): QueueSlot {
    return {
      slot_index: index,
      source: 'bot',
      generated_question_id: `return-${index}`,
      domain: 'History',
      question_text: text,
      answered: false,
      return_scope: 'wrong',
    } as QueueSlot;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DAILY_TOPUP_CARRYFORWARD_ENABLED = 'true';
  });

  it('does not carry an unanswered bonus/return leftover when the core five are all resolved', async () => {
    const priorSlots = [
      ...Array.from({ length: 5 }, (_, i) => coreSlot(`Core${i}`, i, true)),
      bonusSlot('Bonus', 5),
      returnSlot('SecondLook', 6),
    ];
    mocks.getPriorInWindowDailyQueue.mockResolvedValue({ id: 'prior-1', slots: priorSlots });

    const built = await topUpAndCarryForwardPartialQueue('user-1');

    // Nothing core-level is left to preserve, so this falls through to a fresh
    // build rather than smuggling the bonus/return leftover in as slot 0.
    expect(built).toBe(false);
    expect(mocks.carryForwardQueueWithSlots).not.toHaveBeenCalled();
  });

  it('carries only unanswered CORE slots, never the bonus/return leftovers riding along', async () => {
    const priorSlots = [
      coreSlot('Core0', 0, true),
      coreSlot('Core1', 1, true),
      coreSlot('Core2', 2, true),
      coreSlot('CoreUnplayed', 3, false),
      coreSlot('CoreUnplayed2', 4, false),
      bonusSlot('Bonus', 5),
      returnSlot('SecondLook', 6),
    ];
    mocks.getPriorInWindowDailyQueue.mockResolvedValue({ id: 'prior-1', slots: priorSlots });
    mocks.generateDailyQuestionsFromKnowledgeBase.mockResolvedValue([
      { id: 'f1', questionText: 'Fresh1', canonicalSubcategory: 'History', broadCategory: null, difficultyEstimate: null },
      { id: 'f2', questionText: 'Fresh2', canonicalSubcategory: 'History', broadCategory: null, difficultyEstimate: null },
      { id: 'f3', questionText: 'Fresh3', canonicalSubcategory: 'History', broadCategory: null, difficultyEstimate: null },
    ]);
    mocks.carryForwardQueueWithSlots.mockResolvedValue(true);

    const built = await topUpAndCarryForwardPartialQueue('user-1');

    expect(built).toBe(true);
    expect(mocks.carryForwardQueueWithSlots).toHaveBeenCalledTimes(1);
    const [, , mergedSlots, , carriedSlotIndexes] = mocks.carryForwardQueueWithSlots.mock.calls[0];
    // The two unanswered CORE slots land first (re-indexed 0/1); no slot in the
    // merged queue carries a bonus/return marker.
    expect(mergedSlots.map((s: QueueSlot) => s.question_text).slice(0, 2)).toEqual([
      'CoreUnplayed',
      'CoreUnplayed2',
    ]);
    expect(mergedSlots.some((s: QueueSlot) => s.presence_source_id || s.return_scope)).toBe(false);
    // Only the original CORE indexes (3, 4) are reported as carried — the prior
    // day's bonus/return slots (5, 6) stay put on the old row, not stripped out.
    expect(carriedSlotIndexes).toEqual([3, 4]);
  });
});
