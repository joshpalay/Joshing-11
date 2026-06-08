import { beforeEach, describe, expect, it, vi } from 'vitest';

// Structural drizzle mock (mirrors content-reports-suppression.test.ts) so we can
// assert the exact author-facing reads: the house guard (creator_id = author AND
// source <> 'house_authored'), the open|upheld scoping, that reporter identity is
// NEVER selected, and the author-edit resolution transition.
let capturedWhere: unknown = null;
let capturedSet: unknown = null;
let capturedProjection: Record<string, unknown> | null = null;
let selectRows: unknown[] = [];
let returningRows: unknown[] = [];

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...parts) => ({ op: 'and', parts })),
  or: vi.fn((...parts) => ({ op: 'or', parts })),
  eq: vi.fn((column, value) => ({ op: 'eq', column, value })),
  ne: vi.fn((column, value) => ({ op: 'ne', column, value })),
  gte: vi.fn((column, value) => ({ op: 'gte', column, value })),
  desc: vi.fn((column) => ({ op: 'desc', column })),
  inArray: vi.fn((column, values) => ({ op: 'inArray', column, values })),
  notExists: vi.fn((query) => ({ op: 'notExists', query })),
  sql: vi.fn(() => ({ op: 'sql' })),
}));

vi.mock('@/server/db', () => {
  const selectChain: Record<string, unknown> = {
    from: () => selectChain,
    innerJoin: () => selectChain,
    where: (cond: unknown) => {
      capturedWhere = cond;
      return selectChain;
    },
    orderBy: () => selectChain,
    then: (resolve: (r: unknown[]) => unknown) => resolve(selectRows),
  };
  const updateChain: Record<string, unknown> = {
    set: (vals: unknown) => {
      capturedSet = vals;
      return updateChain;
    },
    where: (cond: unknown) => {
      capturedWhere = cond;
      return updateChain;
    },
    returning: () => Promise.resolve(returningRows),
  };
  return {
    db: {
      select: (proj: Record<string, unknown>) => {
        capturedProjection = proj;
        return selectChain;
      },
      update: () => updateChain,
    },
    contentReports: {
      id: 'cr.id',
      reporterUserId: 'cr.reporterUserId',
      questionId: 'cr.questionId',
      generatedQuestionId: 'cr.generatedQuestionId',
      category: 'cr.category',
      incorrectKind: 'cr.incorrectKind',
      note: 'cr.note',
      suggestedAnswer: 'cr.suggestedAnswer',
      status: 'cr.status',
      reviewDecision: 'cr.reviewDecision',
      reviewReason: 'cr.reviewReason',
      reviewedAt: 'cr.reviewedAt',
      createdAt: 'cr.createdAt',
    },
    questions: { id: 'q.id', creatorId: 'q.creatorId', source: 'q.source' },
  };
});

import {
  getOpenIncorrectReportsForAuthor,
  getUpheldInappropriateForAuthor,
  resolveOpenIncorrectReportsForQuestion,
} from '@/server/db/queries/content-reports';

type Op = { op?: string; parts?: Op[]; column?: unknown; value?: unknown; values?: unknown[] };

beforeEach(() => {
  capturedWhere = null;
  capturedSet = null;
  capturedProjection = null;
  selectRows = [];
  returningRows = [];
});

describe('getOpenIncorrectReportsForAuthor', () => {
  it('maps the most recent open incorrect report per question and never selects reporter identity', async () => {
    selectRows = [
      { questionId: 'q1', note: 'newest', incorrectKind: 'answer_key', suggestedAnswer: 'Paris' },
      { questionId: 'q1', note: 'older', incorrectKind: 'premise', suggestedAnswer: null },
      { questionId: 'q2', note: 'n2', incorrectKind: null, suggestedAnswer: null },
    ];

    const result = await getOpenIncorrectReportsForAuthor('author-1', ['q1', 'q2']);

    expect(result.get('q1')).toEqual({
      questionId: 'q1',
      note: 'newest',
      incorrectKind: 'answer_key',
      suggestedAnswer: 'Paris',
    });
    expect(result.get('q2')?.note).toBe('n2');

    // The author must never learn who reported — reporterUserId is not projected.
    expect(Object.keys(capturedProjection ?? {})).not.toContain('reporterUserId');
  });

  it('scopes to open incorrect reports on the author own non-house questions (house guard)', async () => {
    await getOpenIncorrectReportsForAuthor('author-1', ['q1']);

    expect((capturedWhere as Op).parts).toEqual(
      expect.arrayContaining([
        { op: 'eq', column: 'cr.category', value: 'incorrect' },
        { op: 'eq', column: 'cr.status', value: 'open' },
        { op: 'eq', column: 'q.creatorId', value: 'author-1' },
        { op: 'ne', column: 'q.source', value: 'house_authored' },
      ]),
    );
  });

  it('short-circuits with no query for an empty id list', async () => {
    const result = await getOpenIncorrectReportsForAuthor('author-1', []);
    expect(result.size).toBe(0);
    expect(capturedWhere).toBeNull();
  });
});

describe('getUpheldInappropriateForAuthor', () => {
  it('returns only upheld inappropriate question ids, house-guarded', async () => {
    selectRows = [{ questionId: 'q1' }, { questionId: 'q3' }];

    const result = await getUpheldInappropriateForAuthor('author-1', ['q1', 'q3']);

    expect([...result].sort()).toEqual(['q1', 'q3']);
    expect((capturedWhere as Op).parts).toEqual(
      expect.arrayContaining([
        { op: 'eq', column: 'cr.category', value: 'inappropriate' },
        { op: 'eq', column: 'cr.status', value: 'upheld' },
        { op: 'eq', column: 'q.creatorId', value: 'author-1' },
        { op: 'ne', column: 'q.source', value: 'house_authored' },
      ]),
    );
  });
});

describe('resolveOpenIncorrectReportsForQuestion', () => {
  it('dismisses open incorrect reports with an author_edited marker and returns the count', async () => {
    returningRows = [{ id: 'r1' }, { id: 'r2' }];

    const count = await resolveOpenIncorrectReportsForQuestion('q1');

    expect(count).toBe(2);
    expect(capturedSet).toMatchObject({
      status: 'dismissed',
      reviewDecision: 'author_edited',
      reviewReason: 'Author edited the answer key',
    });
    expect((capturedSet as { reviewedAt: unknown }).reviewedAt).toBeInstanceOf(Date);

    expect((capturedWhere as Op).parts).toEqual(
      expect.arrayContaining([
        { op: 'eq', column: 'cr.questionId', value: 'q1' },
        { op: 'eq', column: 'cr.category', value: 'incorrect' },
        { op: 'eq', column: 'cr.status', value: 'open' },
      ]),
    );
  });
});
