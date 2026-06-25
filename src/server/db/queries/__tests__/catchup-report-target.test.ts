import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// reportTarget wiring for daily catch-up. getCatchupQuestions flattens both
// curated/bank slots and LLM-generated slots into one `questionId` string, so the
// content-report path can't tell which FK (questions.id vs generatedQuestions.id)
// the id belongs to. The added `reportTarget` carries that distinction. This test
// drives the read with one canonical slot and one generated slot and asserts each
// output item reports against the correct target — a generated id must NEVER land
// under `questionId` (it would violate ContentReport's FK + one-target CHECK).
const { TABLES, rowsByTable } = vi.hoisted(() => ({
  TABLES: {
    dailyQueues: { id: 'dq.id', userId: 'dq.userId', queueDate: 'dq.queueDate' },
    questions: { id: 'q.id', visibility: 'visibility', creatorId: 'creatorId', deletedAt: 'deletedAt', broadCategory: 'broadCategory', category: 'category' },
    generatedQuestions: { id: 'gq.id', userId: 'gq.userId' },
    feedItems: { id: 'fi.id', recipientUserId: 'fi.recip', state: 'fi.state', answerResult: 'fi.res', catchupResolvedAt: 'fi.resolved', sourceEventAt: 'fi.evt', questionId: 'fi.q' },
    contentReports: { questionId: 'cr.q', generatedQuestionId: 'cr.gq', category: 'cr.category', status: 'cr.status' },
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
  // Distinct dispatch ids per slot so neither item is dropped by sequencing.
  dailyQueueItemId: (queueId: string, slotIndex: number) => `${queueId}:${slotIndex}`,
  feedCatchupItemId: (id: string) => `feed:${id}`,
  minusUtcDays: () => new Date('2026-06-01T00:00:00Z'),
}));

import { getCatchupQuestions } from '@/server/db/queries/daily';

beforeEach(() => {
  rowsByTable.clear();
  rowsByTable.set(TABLES.dailyQueues, [
    {
      id: 'queue-1',
      queueDate: '2026-06-10',
      slots: [
        { slot_index: 0, question_id: 'cq-1', answered: true },
        { slot_index: 1, generated_question_id: 'gq-1', answered: true },
      ],
    },
  ]);
  rowsByTable.set(TABLES.questions, [
    {
      id: 'cq-1',
      questionText: 'Curated bank question?',
      answerText: 'Bank answer',
      acceptedAlternatives: [],
      canonicalSubcategory: 'Wine Production and Marketing',
      broadCategory: 'Food and Drink',
      category: 'Food',
      calibratedDifficulty: null,
      llmDifficulty: null,
      difficultyEstimate: 'moderate',
      explainerFullWrong: null,
      explainerFull: 'Because.',
      explainerBrief: null,
      factualExplanation: null,
      questionType: 'factual',
      creatorId: null,
      source: 'curated_sent',
      deletedAt: null,
      visibility: 'public',
    },
  ]);
  rowsByTable.set(TABLES.generatedQuestions, [
    {
      id: 'gq-1',
      questionText: 'LLM generated question?',
      answer: 'Generated answer',
      explainer: 'Because.',
      canonicalSubcategory: 'Wine Production and Marketing',
      broadCategory: 'Food and Drink',
      basePoints: 3,
      difficultyEstimate: 'moderate',
    },
  ]);
});
afterEach(() => vi.clearAllMocks());

describe('getCatchupQuestions reportTarget discriminator', () => {
  it('reports a curated/bank slot against questionId and a generated slot against generatedQuestionId', async () => {
    const items = await getCatchupQuestions('viewer-1');

    const bank = items.find((item) => item.questionId === 'cq-1');
    const generated = items.find((item) => item.questionId === 'gq-1');

    expect(bank?.reportTarget).toEqual({ questionId: 'cq-1' });
    // The generated id must travel as generatedQuestionId, never as questionId —
    // otherwise the ContentReport insert points at the wrong (or no) FK.
    expect(generated?.reportTarget).toEqual({ generatedQuestionId: 'gq-1' });
  });
});
