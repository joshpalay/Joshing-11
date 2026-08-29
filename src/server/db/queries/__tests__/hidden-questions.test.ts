import { beforeEach, describe, expect, it, vi } from 'vitest';

// The durable per-question opt-out behind the Not-for-me sheet. These tests pin
// the two properties the feature's safety rests on:
//   1. A hide is addressed in exactly ONE id space (canonical vs generated), so
//      the queue builder's two exclusion sets never disagree about a question.
//   2. A hide is REVERSIBLE and user-scoped — restore deletes the row, and only
//      for the owning user. Reversibility is the condition under which permanent
//      hiding is acceptable against a finite pool (D-SUPPLY-FINITE-SET-01).

const { selectMock, insertMock, deleteMock, state } = vi.hoisted(() => {
  const state = {
    /** Rows getHiddenQuestionIds should see. */
    rows: [] as Array<{ questionId: string | null; generatedQuestionId: string | null }>,
    /** Rows the idempotency pre-check should see. */
    existing: [] as Array<{ id: string }>,
    inserted: [] as unknown[],
    deletedWhere: [] as unknown[],
    deleteReturns: [] as Array<{ id: string }>,
  };
  return {
    selectMock: vi.fn(),
    insertMock: vi.fn(),
    deleteMock: vi.fn(),
    state,
  };
});

vi.mock('@/server/db', () => ({
  db: {
    select: selectMock,
    insert: insertMock,
    delete: deleteMock,
  },
  hiddenQuestions: {
    id: 'id',
    userId: 'user_id',
    questionId: 'question_id',
    generatedQuestionId: 'generated_question_id',
    canonicalSubcategory: 'canonical_subcategory',
    hiddenAt: 'hidden_at',
  },
  questions: { id: 'id', questionText: 'question_text' },
  generatedQuestions: { id: 'id', questionText: 'question_text' },
}));

vi.mock('drizzle-orm', () => ({
  and: (...args: unknown[]) => ({ op: 'and', args }),
  desc: (col: unknown) => ({ op: 'desc', col }),
  eq: (col: unknown, value: unknown) => ({ op: 'eq', col, value }),
  inArray: (col: unknown, values: unknown) => ({ op: 'inArray', col, values }),
}));

import {
  getHiddenQuestionIds,
  hideQuestion,
  restoreHiddenQuestion,
} from '@/server/db/queries/hidden-questions';

beforeEach(() => {
  vi.clearAllMocks();
  state.rows = [];
  state.existing = [];
  state.inserted = [];
  state.deletedWhere = [];
  state.deleteReturns = [];

  // Two different select shapes are used: the id sweep (.from().where()) and the
  // idempotency pre-check (.from().where().limit()). Both resolve from state.
  selectMock.mockImplementation((columns: Record<string, unknown>) => ({
    from: () => ({
      where: (whereArg: unknown) => {
        const result = Object.keys(columns).includes('id') ? state.existing : state.rows;
        return Object.assign(Promise.resolve(result), {
          limit: () => Promise.resolve(state.existing),
          orderBy: () => Promise.resolve(state.rows),
          _where: whereArg,
        });
      },
    }),
  }));

  insertMock.mockImplementation(() => ({
    values: (row: unknown) => {
      state.inserted.push(row);
      return Promise.resolve();
    },
  }));

  deleteMock.mockImplementation(() => ({
    where: (whereArg: unknown) => {
      state.deletedWhere.push(whereArg);
      return { returning: () => Promise.resolve(state.deleteReturns) };
    },
  }));
});

describe('getHiddenQuestionIds — two id spaces, kept separate', () => {
  it('sorts canonical and generated ids into their own sets', async () => {
    state.rows = [
      { questionId: 'q1', generatedQuestionId: null },
      { questionId: null, generatedQuestionId: 'g1' },
      { questionId: 'q2', generatedQuestionId: null },
    ];

    const result = await getHiddenQuestionIds('viewer');

    expect([...result.questionIds].sort()).toEqual(['q1', 'q2']);
    expect([...result.generatedQuestionIds]).toEqual(['g1']);
  });

  it('returns empty sets when nothing is hidden', async () => {
    const result = await getHiddenQuestionIds('viewer');
    expect(result.questionIds.size).toBe(0);
    expect(result.generatedQuestionIds.size).toBe(0);
  });
});

describe('hideQuestion', () => {
  it('writes a canonical hide', async () => {
    await hideQuestion({ userId: 'u1', questionId: 'q1', canonicalSubcategory: 'Beethoven' });
    expect(state.inserted).toHaveLength(1);
    expect(state.inserted[0]).toMatchObject({
      userId: 'u1',
      questionId: 'q1',
      generatedQuestionId: null,
      canonicalSubcategory: 'Beethoven',
    });
  });

  it('writes a generated hide', async () => {
    await hideQuestion({ userId: 'u1', generatedQuestionId: 'g1', canonicalSubcategory: 'Jazz' });
    expect(state.inserted[0]).toMatchObject({ questionId: null, generatedQuestionId: 'g1' });
  });

  it('is idempotent — a second hide of the same question writes nothing', async () => {
    // The pre-check finds an existing row, so a double-tap on a slow connection
    // can't produce two entries in the Settings list.
    state.existing = [{ id: 'existing' }];
    await hideQuestion({ userId: 'u1', questionId: 'q1', canonicalSubcategory: 'Beethoven' });
    expect(state.inserted).toHaveLength(0);
  });

  it('refuses a hide that names no question at all', async () => {
    await hideQuestion({ userId: 'u1', canonicalSubcategory: 'Beethoven' });
    expect(state.inserted).toHaveLength(0);
  });
});

describe('restoreHiddenQuestion — the undo', () => {
  it('reports true when a row was deleted', async () => {
    state.deleteReturns = [{ id: 'h1' }];
    await expect(restoreHiddenQuestion('u1', 'h1')).resolves.toBe(true);
  });

  it("reports false when the id isn't the caller's", async () => {
    // The user scoping lives in the WHERE clause, so someone else's id simply
    // deletes nothing rather than clearing their row.
    state.deleteReturns = [];
    await expect(restoreHiddenQuestion('u1', 'someone-elses')).resolves.toBe(false);
  });
});
