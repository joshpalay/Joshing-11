import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Generated (LLM-origin) questions have no `visibility` column — their terminal
// hard-block is an upheld-inappropriate ContentReport, the generated equivalent
// of visibility='blocked'. There is NO owner exception (creatorId is null for
// generated content). Mirrors content-reports-suppression.test.ts: mock the
// drizzle operators structurally + capture the WHERE so we can assert the
// category='inappropriate' AND status='upheld' scope (and the absence of any
// creator/owner clause), which is the correctness-critical invariant here.
let capturedWhere: unknown = null;
let chainRows: Array<{ generatedQuestionId: string | null }> = [];

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...parts) => ({ op: 'and', parts })),
  asc: vi.fn((column) => ({ op: 'asc', column })),
  desc: vi.fn((column) => ({ op: 'desc', column })),
  eq: vi.fn((column, value) => ({ op: 'eq', column, value })),
  gte: vi.fn((column, value) => ({ op: 'gte', column, value })),
  inArray: vi.fn((column, values) => ({ op: 'inArray', column, values })),
  ne: vi.fn((column, value) => ({ op: 'ne', column, value })),
  notExists: vi.fn((query) => ({ op: 'notExists', query })),
  or: vi.fn((...parts) => ({ op: 'or', parts })),
  sql: vi.fn(() => ({ op: 'sql' })),
}));

vi.mock('@/server/db', () => {
  const makeChain = () => {
    const chain: Record<string, unknown> = {
      select: vi.fn(() => chain),
      from: vi.fn(() => chain),
      innerJoin: vi.fn(() => chain),
      where: vi.fn((cond: unknown) => {
        capturedWhere = cond;
        return chain;
      }),
      orderBy: vi.fn(() => chain),
      limit: vi.fn(() => Promise.resolve(chainRows)),
      then: (resolve: (r: unknown[]) => unknown) => resolve(chainRows),
    };
    return chain;
  };
  return {
    db: { select: vi.fn(() => makeChain()) },
    contentReports: {
      id: 'contentReports.id',
      questionId: 'contentReports.questionId',
      generatedQuestionId: 'contentReports.generatedQuestionId',
      category: 'contentReports.category',
      status: 'contentReports.status',
      createdAt: 'contentReports.createdAt',
    },
    generatedQuestions: { id: 'generatedQuestions.id' },
    questions: { id: 'questions.id' },
    users: { id: 'users.id' },
  };
});

import {
  getUpheldInappropriateGeneratedIds,
  notBlockedGeneratedByContentReport,
} from '@/server/db/queries/content-reports';

type Op = { op: string; parts?: unknown[]; column?: unknown; value?: unknown; query?: { op: string } };

beforeEach(() => {
  capturedWhere = null;
  chainRows = [];
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('notBlockedGeneratedByContentReport (SQL predicate — daily catch-up path)', () => {
  it('builds a NOT EXISTS over upheld-inappropriate reports for the generated id', () => {
    const predicate = notBlockedGeneratedByContentReport('generatedQuestions.id' as never) as Op;
    expect(predicate.op).toBe('notExists');

    // category='inappropriate' AND status='upheld' AND target = the generated id.
    expect(capturedWhere).toMatchObject({
      op: 'and',
      parts: expect.arrayContaining([
        { op: 'eq', column: 'contentReports.generatedQuestionId', value: 'generatedQuestions.id' },
        { op: 'eq', column: 'contentReports.category', value: 'inappropriate' },
        { op: 'eq', column: 'contentReports.status', value: 'upheld' },
      ]),
    });
  });

  it('is the terminal upheld-only state — NOT the reversible open|upheld suppression', () => {
    notBlockedGeneratedByContentReport('generatedQuestions.id' as never);
    const serialized = JSON.stringify(capturedWhere);
    // A merely-open (or dismissed) report must NOT hard-block; only an upheld one.
    expect(serialized).toContain('"value":"upheld"');
    expect(serialized).not.toContain('"value":"open"');
  });

  it('has NO owner/creator exception (generated content has a null author)', () => {
    notBlockedGeneratedByContentReport('generatedQuestions.id' as never);
    expect(JSON.stringify(capturedWhere)).not.toContain('creatorId');
  });
});

describe('getUpheldInappropriateGeneratedIds (set form — archive daily slot path)', () => {
  it('3. returns the ids of generated questions carrying an upheld-inappropriate report (EXCLUDED)', async () => {
    chainRows = [{ generatedQuestionId: 'g-1' }, { generatedQuestionId: 'g-2' }];
    const blocked = await getUpheldInappropriateGeneratedIds(['g-1', 'g-2', 'g-3']);

    // g-1/g-2 are dropped by the caller; g-3 (no upheld report) is unaffected.
    expect([...blocked].sort()).toEqual(['g-1', 'g-2']);
    expect(blocked.has('g-3')).toBe(false);

    // Scope: inappropriate + upheld only.
    expect(capturedWhere).toMatchObject({
      op: 'and',
      parts: expect.arrayContaining([
        { op: 'inArray', column: 'contentReports.generatedQuestionId', values: ['g-1', 'g-2', 'g-3'] },
        { op: 'eq', column: 'contentReports.category', value: 'inappropriate' },
        { op: 'eq', column: 'contentReports.status', value: 'upheld' },
      ]),
    });
  });

  it('short-circuits to an empty set with no query for an empty id list', async () => {
    const blocked = await getUpheldInappropriateGeneratedIds([]);
    expect(blocked.size).toBe(0);
    expect(capturedWhere).toBeNull();
  });
});
