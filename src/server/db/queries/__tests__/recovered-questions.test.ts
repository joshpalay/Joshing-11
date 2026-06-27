import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// D-REVIEW-RECOVERED-01 — wiring test for the recovered-questions pool.
//
// We mock drizzle as inert node-builders and capture the WHERE / ORDER BY the
// reader constructs, then assert the exact pool definition (Done-When #1):
//   answer_state = 'first_correct_after_wrong' + question_id IS NOT NULL,
//   ordered created_at DESC.
//
// It also guards the read-only contract (Done-When #3): the db mock exposes
// insert/update/delete that throw, so any write attempt on this surface fails
// the test loudly. The pool is built with SELECT and nothing else.
interface Node {
  op: string;
  column?: unknown;
  value?: unknown;
  values?: unknown;
  parts?: Node[];
}

let capturedWhere: Node | null = null;
let capturedOrderBy: Node | null = null;
let selectCalls = 0;

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...parts: Node[]) => ({ op: 'and', parts })),
  eq: vi.fn((column, value) => ({ op: 'eq', column, value })),
  desc: vi.fn((column) => ({ op: 'desc', column })),
  inArray: vi.fn((column, values) => ({ op: 'inArray', column, values })),
  isNotNull: vi.fn((column) => ({ op: 'isNotNull', column })),
}));

vi.mock('@/server/db', () => {
  const chain: Record<string, unknown> = {};
  chain.from = vi.fn(() => chain);
  chain.innerJoin = vi.fn(() => chain);
  chain.where = vi.fn((cond: Node) => {
    capturedWhere = cond;
    return chain;
  });
  chain.orderBy = vi.fn((order: Node) => {
    capturedOrderBy = order;
    return Promise.resolve([]);
  });
  const fail = (op: string) =>
    vi.fn(() => {
      throw new Error(`read-only surface attempted a ${op}`);
    });
  return {
    db: {
      select: vi.fn(() => {
        selectCalls += 1;
        return chain;
      }),
      insert: fail('insert'),
      update: fail('update'),
      delete: fail('delete'),
    },
    masteryEvents: {
      id: 'me.id',
      userId: 'me.userId',
      sourceType: 'me.sourceType',
      answerState: 'me.answerState',
      questionId: 'me.questionId',
      createdAt: 'me.createdAt',
    },
    questions: {
      id: 'q.id',
      questionText: 'q.questionText',
      answerText: 'q.answerText',
      factualExplanation: 'q.factualExplanation',
      canonicalSubcategory: 'q.canonicalSubcategory',
      category: 'q.category',
    },
  };
});

import { getRecoveredQuestionsForUser } from '@/server/db/queries/recovered-questions';

function flatten(node: Node | null): Node[] {
  if (!node) return [];
  if (node.op === 'and') return (node.parts ?? []).flatMap(flatten);
  return [node];
}

const VIEWER = 'viewer-1';

beforeEach(() => {
  capturedWhere = null;
  capturedOrderBy = null;
  selectCalls = 0;
});
afterEach(() => vi.clearAllMocks());

describe('getRecoveredQuestionsForUser — pool definition', () => {
  it('filters on answer_state = first_correct_after_wrong', async () => {
    await getRecoveredQuestionsForUser(VIEWER);
    const match = flatten(capturedWhere).find(
      (n) => n.op === 'eq' && n.column === 'me.answerState',
    );
    expect(match).toBeDefined();
    expect(match!.value).toBe('first_correct_after_wrong');
  });

  it('guards question_id IS NOT NULL', async () => {
    await getRecoveredQuestionsForUser(VIEWER);
    const match = flatten(capturedWhere).find(
      (n) => n.op === 'isNotNull' && n.column === 'me.questionId',
    );
    expect(match).toBeDefined();
  });

  it('scopes to the viewer', async () => {
    await getRecoveredQuestionsForUser(VIEWER);
    const match = flatten(capturedWhere).find(
      (n) => n.op === 'eq' && n.column === 'me.userId',
    );
    expect(match).toBeDefined();
    expect(match!.value).toBe(VIEWER);
  });

  it('orders by created_at DESC (recency, Decision C)', async () => {
    await getRecoveredQuestionsForUser(VIEWER);
    expect(capturedOrderBy).toEqual({ op: 'desc', column: 'me.createdAt' });
  });

  it('reads with SELECT only — no insert/update/delete on this surface', async () => {
    await expect(getRecoveredQuestionsForUser(VIEWER)).resolves.toEqual([]);
    expect(selectCalls).toBe(1);
  });
});
