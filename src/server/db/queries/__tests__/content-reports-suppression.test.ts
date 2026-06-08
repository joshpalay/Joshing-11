import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mirrors question-visibility.test.ts: mock drizzle-orm operators as structural
// constructors so we can assert the exact suppression predicate shape — the
// open|upheld scope (and the absence of 'dismissed') is the correctness-critical
// invariant (a dismissed report must NOT suppress), and is caught here.
let capturedWhere: unknown = null;
let chainRows: unknown[] = [];

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...parts) => ({ op: 'and', parts })),
  or: vi.fn((...parts) => ({ op: 'or', parts })),
  eq: vi.fn((column, value) => ({ op: 'eq', column, value })),
  gte: vi.fn((column, value) => ({ op: 'gte', column, value })),
  inArray: vi.fn((column, values) => ({ op: 'inArray', column, values })),
  notExists: vi.fn((query) => ({ op: 'notExists', query })),
  sql: vi.fn(() => ({ op: 'sql' })),
}));

vi.mock('@/server/db', () => {
  const makeChain = () => {
    const chain: Record<string, unknown> = {
      select: vi.fn(() => chain),
      from: vi.fn(() => chain),
      where: vi.fn((cond: unknown) => {
        capturedWhere = cond;
        return chain;
      }),
      limit: vi.fn(() => Promise.resolve(chainRows)),
      then: (resolve: (r: unknown[]) => unknown) => resolve(chainRows),
    };
    return chain;
  };
  return {
    db: { select: vi.fn(() => makeChain()) },
    contentReports: {
      id: 'contentReports.id',
      reporterUserId: 'contentReports.reporterUserId',
      questionId: 'contentReports.questionId',
      generatedQuestionId: 'contentReports.generatedQuestionId',
      category: 'contentReports.category',
      status: 'contentReports.status',
      createdAt: 'contentReports.createdAt',
    },
  };
});

import {
  getViewerHiddenQuestionIds,
  isQuestionReportSuppressed,
  notSuppressedByContentReport,
} from '@/server/db/queries/content-reports';

type Op = { op: string; parts?: unknown[]; column?: unknown; values?: unknown[] };

function findInArrayOnStatus(cond: unknown): Op | undefined {
  const node = cond as Op;
  if (!node || typeof node !== 'object') return undefined;
  if (node.op === 'inArray' && node.column === 'contentReports.status') return node;
  for (const part of node.parts ?? []) {
    const found = findInArrayOnStatus(part);
    if (found) return found;
  }
  return undefined;
}

beforeEach(() => {
  capturedWhere = null;
  chainRows = [];
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('notSuppressedByContentReport', () => {
  it('builds a NOT EXISTS over open|upheld reports matching the curated question id', () => {
    const predicate = notSuppressedByContentReport('questions.id' as never, 'question') as Op;
    expect(predicate.op).toBe('notExists');

    expect(capturedWhere).toMatchObject({
      op: 'and',
      parts: expect.arrayContaining([
        { op: 'eq', column: 'contentReports.questionId', value: 'questions.id' },
        { op: 'inArray', column: 'contentReports.status', values: ['open', 'upheld'] },
      ]),
    });
  });

  it('targets the generatedQuestionId column for generated rows', () => {
    notSuppressedByContentReport('generatedQuestions.id' as never, 'generated');
    expect(capturedWhere).toMatchObject({
      parts: expect.arrayContaining([
        { op: 'eq', column: 'contentReports.generatedQuestionId', value: 'generatedQuestions.id' },
      ]),
    });
  });

  it('never includes dismissed in the suppressing statuses', () => {
    notSuppressedByContentReport('questions.id' as never, 'question');
    const statusFilter = findInArrayOnStatus(capturedWhere);
    expect(statusFilter?.values).toEqual(['open', 'upheld']);
    expect(statusFilter?.values).not.toContain('dismissed');
  });
});

describe('isQuestionReportSuppressed', () => {
  it('is true when an open/upheld report row matches the id (either FK column)', async () => {
    chainRows = [{ id: 'report-1' }];
    expect(await isQuestionReportSuppressed('q-1')).toBe(true);

    // The id is matched against BOTH columns so a report on a GeneratedQuestion
    // still suppresses a send that would mint it into a curated Question.
    expect(capturedWhere).toMatchObject({
      op: 'and',
      parts: expect.arrayContaining([
        {
          op: 'or',
          parts: [
            { op: 'eq', column: 'contentReports.questionId', value: 'q-1' },
            { op: 'eq', column: 'contentReports.generatedQuestionId', value: 'q-1' },
          ],
        },
      ]),
    });
    expect(findInArrayOnStatus(capturedWhere)?.values).toEqual(['open', 'upheld']);
  });

  it('is false when no open/upheld report exists (e.g. only a dismissed one)', async () => {
    chainRows = [];
    expect(await isQuestionReportSuppressed('q-1')).toBe(false);
  });
});

describe('getViewerHiddenQuestionIds', () => {
  it('returns only the viewer-reported candidate ids, mapped from either FK column', async () => {
    chainRows = [
      { questionId: 'q-1', generatedQuestionId: null },
      { questionId: null, generatedQuestionId: 'g-2' },
      { questionId: 'q-other', generatedQuestionId: null }, // not in candidate set
    ];
    const hidden = await getViewerHiddenQuestionIds('viewer-1', ['q-1', 'g-2']);
    expect([...hidden].sort()).toEqual(['g-2', 'q-1']);

    // Reporter-scoped, inappropriate-only, open|upheld.
    expect(capturedWhere).toMatchObject({
      op: 'and',
      parts: expect.arrayContaining([
        { op: 'eq', column: 'contentReports.reporterUserId', value: 'viewer-1' },
        { op: 'eq', column: 'contentReports.category', value: 'inappropriate' },
        { op: 'inArray', column: 'contentReports.status', values: ['open', 'upheld'] },
      ]),
    });
  });

  it('short-circuits with no query when there are no candidate ids', async () => {
    const hidden = await getViewerHiddenQuestionIds('viewer-1', []);
    expect(hidden.size).toBe(0);
    expect(capturedWhere).toBeNull();
  });
});
