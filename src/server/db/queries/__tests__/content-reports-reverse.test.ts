import { beforeEach, describe, expect, it, vi } from 'vitest';

// B-Report-6: the blocked/actioned list + reversal. Structural drizzle mock (like
// content-reports-admin.test.ts), extended so selects resolve per FROM-table and
// updates support .returning(). Asserts: the blocked list carries source/creatorId
// for the human-vs-house badge; reverse restores authored visibility→public AND
// dismisses the upheld report; generated reverse dismisses the upheld report.
const { CONTENT_REPORTS, QUESTIONS, GENERATED, USERS, state } = vi.hoisted(() => ({
  CONTENT_REPORTS: { __t: 'contentReports', id: 'cr.id', status: 'cr.status', category: 'cr.category', questionId: 'cr.questionId', generatedQuestionId: 'cr.generatedQuestionId', reviewDecision: 'cr.reviewDecision', reviewReason: 'cr.reviewReason', reviewedAt: 'cr.reviewedAt' },
  QUESTIONS: { __t: 'questions', id: 'q.id', questionText: 'q.questionText', answerText: 'q.answerText', visibility: 'q.visibility', creatorId: 'q.creatorId', source: 'q.source', deletedAt: 'q.deletedAt', updatedAt: 'q.updatedAt' },
  GENERATED: { __t: 'generatedQuestions', id: 'g.id', questionText: 'g.questionText', answer: 'g.answer' },
  USERS: { __t: 'users', id: 'u.id', displayName: 'u.displayName' },
  state: {
    rowsByTable: new Map<unknown, unknown[]>(),
    updates: [] as Array<{ table: unknown; set: Record<string, unknown>; where: unknown }>,
    returningRows: [] as unknown[],
  },
}));

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...parts) => ({ op: 'and', parts })),
  or: vi.fn((...parts) => ({ op: 'or', parts })),
  eq: vi.fn((column, value) => ({ op: 'eq', column, value })),
  ne: vi.fn((column, value) => ({ op: 'ne', column, value })),
  gte: vi.fn((column, value) => ({ op: 'gte', column, value })),
  asc: vi.fn((column) => ({ op: 'asc', column })),
  desc: vi.fn((column) => ({ op: 'desc', column })),
  inArray: vi.fn((column, values) => ({ op: 'inArray', column, values })),
  isNull: vi.fn((column) => ({ op: 'isNull', column })),
  notExists: vi.fn((query) => ({ op: 'notExists', query })),
  sql: vi.fn(() => ({ op: 'sql' })),
}));

vi.mock('@/server/db', () => {
  const rowsFor = (table: unknown) => state.rowsByTable.get(table) ?? [];
  const makeSelect = () => {
    let fromTable: unknown = null;
    const chain: Record<string, unknown> = {
      from: (t: unknown) => {
        fromTable = t;
        return chain;
      },
      leftJoin: () => chain,
      innerJoin: () => chain,
      where: () => chain,
      orderBy: () => chain,
      limit: () => Promise.resolve(rowsFor(fromTable)),
      then: (resolve: (r: unknown[]) => unknown) => resolve(rowsFor(fromTable)),
    };
    return chain;
  };
  return {
    db: {
      select: () => makeSelect(),
      update: (table: unknown) => ({
        set: (vals: Record<string, unknown>) => ({
          where: (cond: unknown) => {
            state.updates.push({ table, set: vals, where: cond });
            const result: Record<string, unknown> = {
              returning: () => Promise.resolve(state.returningRows),
              then: (resolve: (v: unknown) => unknown) => resolve(undefined),
            };
            return result;
          },
        }),
      }),
    },
    contentReports: CONTENT_REPORTS,
    questions: QUESTIONS,
    generatedQuestions: GENERATED,
    users: USERS,
  };
});

import {
  getBlockedQuestionsForReview,
  reverseBlock,
} from '@/server/db/queries/content-reports';

const questionUpdates = () => state.updates.filter((u) => u.table === QUESTIONS);
const reportUpdates = () => state.updates.filter((u) => u.table === CONTENT_REPORTS);

beforeEach(() => {
  state.rowsByTable.clear();
  state.updates.length = 0;
  state.returningRows = [];
});

describe('getBlockedQuestionsForReview', () => {
  it('lists blocked authored + upheld-inappropriate generated, carrying source/creatorId and a human/house/LLM badge', async () => {
    state.rowsByTable.set(QUESTIONS, [
      { id: 'q1', questionText: 'human q', answer: 'A', source: 'authored', creatorId: 'user-1', authorName: 'Alice' },
      { id: 'qh', questionText: 'house q', answer: 'H', source: 'house_authored', creatorId: null, authorName: null },
    ]);
    state.rowsByTable.set(GENERATED, [
      { id: 'g1', questionText: 'gen q', answer: 'G', reportId: 'r-g1', reviewedAt: new Date('2026-06-10') },
    ]);
    // The authored upheld-inappropriate report lookup.
    state.rowsByTable.set(CONTENT_REPORTS, [
      { questionId: 'q1', id: 'r-q1', reviewedAt: new Date('2026-06-09') },
    ]);

    const items = await getBlockedQuestionsForReview();

    const human = items.find((i) => i.target.table === 'question' && i.target.id === 'q1')!;
    expect(human).toMatchObject({
      source: 'authored', // the open-report query omits this; it's required here
      creatorId: 'user-1',
      authorName: 'Alice',
      authorIsHouse: false,
      reportId: 'r-q1',
    });

    const house = items.find((i) => i.target.table === 'question' && i.target.id === 'qh')!;
    expect(house).toMatchObject({ authorIsHouse: true, authorName: 'Joshing' });

    const generated = items.find((i) => i.target.table === 'generated')!;
    expect(generated).toMatchObject({
      target: { table: 'generated', id: 'g1' },
      source: null, // LLM-origin: no source/creator
      creatorId: null,
      authorName: null,
      authorIsHouse: false,
      reportId: 'r-g1',
    });
  });

  it('returns nothing when no content is blocked', async () => {
    expect(await getBlockedQuestionsForReview()).toEqual([]);
  });
});

describe('reverseBlock — authored', () => {
  it('restores visibility to public AND dismisses the upheld report (admin_reversed)', async () => {
    state.rowsByTable.set(QUESTIONS, [{ visibility: 'blocked' }]);

    const result = await reverseBlock({ table: 'question', id: 'q1' }, 'cleared on review');

    expect(result).toEqual({ ok: true, action: 'reversed', table: 'question', restoredVisibility: 'public' });
    expect(questionUpdates()[0]?.set).toMatchObject({ visibility: 'public' });
    expect(reportUpdates()[0]?.set).toMatchObject({
      status: 'dismissed',
      reviewDecision: 'admin_reversed',
      reviewReason: 'cleared on review',
    });
  });

  it('is a no-op for a missing question', async () => {
    state.rowsByTable.set(QUESTIONS, []);
    expect(await reverseBlock({ table: 'question', id: 'missing' })).toEqual({ ok: false, reason: 'not_found' });
    expect(state.updates).toHaveLength(0);
  });

  it('refuses to act on a question that is not blocked', async () => {
    state.rowsByTable.set(QUESTIONS, [{ visibility: 'public' }]);
    expect(await reverseBlock({ table: 'question', id: 'q1' })).toEqual({ ok: false, reason: 'not_blocked' });
    expect(state.updates).toHaveLength(0);
  });
});

describe('reverseBlock — generated', () => {
  it('dismisses the upheld-inappropriate report (the terminal state) and reports success', async () => {
    state.returningRows = [{ id: 'r-g1' }];

    const result = await reverseBlock({ table: 'generated', id: 'g1' });

    expect(result).toEqual({ ok: true, action: 'reversed', table: 'generated', restoredVisibility: null });
    expect(reportUpdates()[0]?.set).toMatchObject({ status: 'dismissed', reviewDecision: 'admin_reversed' });
    // No visibility column exists for generated content.
    expect(questionUpdates()).toHaveLength(0);
  });

  it('is a no-op when there is no upheld report to reverse', async () => {
    state.returningRows = [];
    expect(await reverseBlock({ table: 'generated', id: 'gX' })).toEqual({ ok: false, reason: 'not_found' });
  });
});
