import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Regression (QA 2026-10-01 run 2, C1): a question the player hid with "Never
// show this question" came back as catch-up item 1 the next day. Hiding also
// marks the slot skipped, and skipped slots are catch-up eligible; catch-up
// never read HiddenQuestion. getCatchupQuestions now drops hidden questions in
// both id spaces (generated + canonical), on the daily and feed sides.

const { TABLES, rowsByTable } = vi.hoisted(() => ({
  TABLES: {
    dailyQueues: { id: 'dq.id', userId: 'dq.userId', queueDate: 'dq.queueDate' },
    questions: { id: 'q.id', visibility: 'visibility', creatorId: 'creatorId', deletedAt: 'deletedAt' },
    generatedQuestions: { id: 'gq.id', userId: 'gq.userId' },
    feedItems: { id: 'fi.id' },
    contentReports: { questionId: 'cr.q', generatedQuestionId: 'cr.gq' },
    users: { id: 'u.id', displayName: 'u.name' },
  },
  rowsByTable: new Map<unknown, unknown[]>(),
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((column, value) => ({ op: 'eq', column, value })),
  ne: vi.fn((column, value) => ({ op: 'ne', column, value })),
  or: vi.fn((...parts) => ({ op: 'or', parts })),
  and: vi.fn((...parts) => ({ op: 'and', parts })),
  asc: vi.fn((column) => ({ op: 'asc', column })),
  desc: vi.fn((column) => ({ op: 'desc', column })),
  gte: vi.fn((column, value) => ({ op: 'gte', column, value })),
  lte: vi.fn((column, value) => ({ op: 'lte', column, value })),
  inArray: vi.fn((column, values) => ({ op: 'inArray', column, values })),
  isNotNull: vi.fn((column) => ({ op: 'isNotNull', column })),
  isNull: vi.fn((column) => ({ op: 'isNull', column })),
  notExists: vi.fn((query) => ({ op: 'notExists', query })),
  sql: vi.fn(() => ({ op: 'sql', as: vi.fn(() => ({ op: 'sqlAs' })) })),
}));

vi.mock('@/server/db', () => {
  const rowsFor = (table: unknown) => (rowsByTable.get(table) ?? []) as unknown[];
  const makeChain = () => {
    let fromTable: unknown = null;
    const chain: Record<string, unknown> = {
      select: vi.fn(() => chain),
      from: vi.fn((t: unknown) => {
        fromTable = t;
        return chain;
      }),
      innerJoin: vi.fn(() => chain),
      leftJoin: vi.fn(() => chain),
      orderBy: vi.fn(() => chain),
      limit: vi.fn(() => Promise.resolve(rowsFor(fromTable))),
      where: vi.fn(() => chain),
      then: (resolve: (r: unknown[]) => unknown) => resolve(rowsFor(fromTable)),
    };
    return chain;
  };
  return {
    db: { select: vi.fn(() => makeChain()) },
    dailyQueues: TABLES.dailyQueues,
    questions: TABLES.questions,
    generatedQuestions: TABLES.generatedQuestions,
    feedItems: TABLES.feedItems,
    contentReports: TABLES.contentReports,
    users: TABLES.users,
    dailyPreferences: {}, declaredInterests: {}, masteryEvents: {}, playerMastery: {},
    skippedDailyQuestions: {}, userDomainExclusions: {},
  };
});

vi.mock('@/lib/games/timezone', () => ({
  getDailyAssignmentBounds: () => ({ assignmentDateStr: '2026-06-16', assignmentDate: new Date('2026-06-16T00:00:00Z') }),
}));
vi.mock('@/server/play/catch-up-eligibility', () => ({
  isCatchUpQueueDateEligible: () => true,
  isCatchUpSlotEligible: () => true,
  catchUpExpiresAt: () => '2026-07-01',
  expiresWithin24Hours: () => false,
  queueAgeInDays: () => 0,
}));
vi.mock('@/server/daily/catchup', () => ({
  CATCHUP_LOOKBACK_DAYS: 30,
  asQueueSlots: (v: unknown) => (Array.isArray(v) ? v : []),
  dailyQueueItemId: (queueId: string, slotIndex: number) => `${queueId}:${slotIndex}`,
  feedCatchupItemId: () => 'feed-item-id',
  minusUtcDays: () => new Date('2026-06-01T00:00:00Z'),
  orderCatchUpItems: <T>(items: T[]) => items,
  dedupeCatchUpItems: <T>(items: T[]) => items,
}));

const getHiddenQuestionIdsMock = vi.fn();
vi.mock('@/server/db/queries/hidden-questions', () => ({
  EMPTY_HIDDEN_IDS: { questionIds: new Set(), generatedQuestionIds: new Set() },
  getHiddenQuestionIds: (...args: unknown[]) => getHiddenQuestionIdsMock(...args),
}));

const getDailyPreferencesMock = vi.fn();
vi.mock('@/server/db/queries/daily-preferences', () => ({
  getDailyPreferences: (...args: unknown[]) => getDailyPreferencesMock(...args),
}));

import { getCatchupQuestions, isHiddenSlot } from '@/server/db/queries/daily';

function genRow(id: string, subcategory: string) {
  return {
    id,
    questionText: `Question ${id}`,
    answer: `Answer ${id}`,
    explainer: `Because ${id}`,
    canonicalSubcategory: subcategory,
    broadCategory: subcategory,
    basePoints: 10,
    difficultyEstimate: 'accessible',
  };
}

beforeEach(() => {
  rowsByTable.clear();
  getDailyPreferencesMock.mockReset();
  getDailyPreferencesMock.mockResolvedValue({
    userId: 'viewer-1',
    difficulty: 'adaptive',
    domainMode: 'random',
    selectedDomains: [],
    domainPreferenceFrequency: {},
    updatedAt: null,
  });
  getHiddenQuestionIdsMock.mockReset();
  getHiddenQuestionIdsMock.mockResolvedValue({ questionIds: new Set(), generatedQuestionIds: new Set(['gq-hidden']) });

  // One queue: a skipped-then-hidden Spy School bonus and an ordinary miss.
  rowsByTable.set(TABLES.dailyQueues, [
    {
      id: 'queue-1',
      queueDate: '2026-06-10',
      slots: [
        { slot_index: 0, generated_question_id: 'gq-hidden', domain: 'Spy School', skipped: true },
        { slot_index: 1, generated_question_id: 'gq-missed', domain: 'Opera', answered: true, answer_state: 'incorrect' },
      ],
    },
  ]);
  rowsByTable.set(TABLES.generatedQuestions, [genRow('gq-hidden', 'Spy School'), genRow('gq-missed', 'Opera')]);
  rowsByTable.set(TABLES.feedItems, []);
});
afterEach(() => vi.clearAllMocks());

describe('getCatchupQuestions never re-serves a hidden question', () => {
  it('drops the hidden question and keeps the ordinary miss', async () => {
    const items = await getCatchupQuestions('viewer-1');
    const domains = items.map((item) => item.domain);
    expect(domains).toContain('Opera');
    expect(domains).not.toContain('Spy School');
  });

  it('keeps both when the hidden lookup fails (fail-open, like the Daily Five build)', async () => {
    getHiddenQuestionIdsMock.mockRejectedValue(new Error('db blip'));
    const items = await getCatchupQuestions('viewer-1');
    expect(items.map((item) => item.domain).sort()).toEqual(['Opera', 'Spy School']);
  });
});

describe('isHiddenSlot', () => {
  const hidden = { questionIds: new Set(['q-1']), generatedQuestionIds: new Set(['gq-1']) };
  it('matches either id space', () => {
    expect(isHiddenSlot({ generated_question_id: 'gq-1' }, hidden)).toBe(true);
    expect(isHiddenSlot({ question_id: 'q-1' }, hidden)).toBe(true);
    expect(isHiddenSlot({ question_id: 'q-2', generated_question_id: 'gq-2' }, hidden)).toBe(false);
    expect(isHiddenSlot({}, hidden)).toBe(false);
  });
});
