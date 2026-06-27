import { beforeAll, describe, expect, it, vi } from 'vitest';

import { DAILY_QUEUE_SIZE, type QueueSlot } from '@/server/daily/types';

// queue-orchestrator imports @/server/db/queries/daily (→ @/server/db, which
// throws at module load without a connection string). Mock the daily surface with
// faithful PURE slot builders so this unit exercises only mergeCarriedWithFresh.
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
  carryForwardQueueWithSlots: vi.fn(),
  clearStaleShortTodayQueue: vi.fn(),
  countDailyQueues: vi.fn(),
  getKnowledgeBase: vi.fn(),
  getPriorInWindowDailyQueue: vi.fn(),
  getTodaysDailyQueue: vi.fn(),
  persistDailyQueue: vi.fn(),
  pickEligibleAuthoredQuestions: vi.fn(),
  pickHouseQuestions: vi.fn(),
  getRecentAnsweredAnswerKeys: vi.fn(),
  getRecentAnsweredEntities: vi.fn(),
}));

vi.mock('@/server/questions/canonical-subcategory', () => ({
  // A subcategory of 'generic' is treated as a bucket label to drop.
  isGenericSubcategory: (s: string) => s === 'generic',
}));

let mergeCarriedWithFresh: typeof import('@/server/daily/queue-orchestrator').mergeCarriedWithFresh;

beforeAll(async () => {
  process.env.DATABASE_URL ??= 'postgres://user:pass@localhost:5432/joshing_test';
  ({ mergeCarriedWithFresh } = await import('@/server/daily/queue-orchestrator'));
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
