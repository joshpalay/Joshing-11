import { describe, expect, it, vi } from 'vitest';

const { state, dbMock } = vi.hoisted(() => {
  const state = {
    directRows: [] as Array<{ id: string | null }>,
    joinedRows: [] as Array<{ id: string | null }>,
    directWhere: undefined as unknown,
    joinedWhere: undefined as unknown,
  };

  const dbMock = {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(async (predicate: unknown) => {
          state.directWhere = predicate;
          return state.directRows;
        }),
        innerJoin: vi.fn(() => ({
          where: vi.fn(async (predicate: unknown) => {
            state.joinedWhere = predicate;
            return state.joinedRows;
          }),
        })),
      })),
    })),
  };

  return { state, dbMock };
});

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...parts) => ({ op: 'and', parts })),
  eq: vi.fn((column, value) => ({ op: 'eq', column, value })),
  inArray: vi.fn((column, values) => ({ op: 'inArray', column, values })),
}));

vi.mock('@/server/db', () => ({
  db: dbMock,
  questionFeedback: { generatedQuestionId: 'questionFeedback.generatedQuestionId', questionId: 'questionFeedback.questionId', signal: 'questionFeedback.signal' },
  questions: { id: 'questions.id', generatedQuestionId: 'questions.generatedQuestionId' },
}));

import { getHeartedBankQuestionIds } from '@/server/quality/hearted-bank-questions';

describe('getHeartedBankQuestionIds', () => {
  it('returns an empty set without querying when given no ids', async () => {
    const result = await getHeartedBankQuestionIds([]);
    expect(result.size).toBe(0);
    expect(dbMock.select).not.toHaveBeenCalled();
  });

  it('unions hearts found directly on the bank row and via a served Question clone', async () => {
    state.directRows = [{ id: 'bank-1' }];
    state.joinedRows = [{ id: 'bank-2' }];

    const result = await getHeartedBankQuestionIds(['bank-1', 'bank-2', 'bank-3']);

    expect([...result].sort()).toEqual(['bank-1', 'bank-2']);
  });

  it('drops out any row with a null id from either path', async () => {
    state.directRows = [{ id: null }];
    state.joinedRows = [{ id: null }];

    const result = await getHeartedBankQuestionIds(['bank-1']);

    expect(result.size).toBe(0);
  });

  it('de-dupes the input id list before querying', async () => {
    state.directRows = [];
    state.joinedRows = [];

    await getHeartedBankQuestionIds(['bank-1', 'bank-1', 'bank-1']);

    expect((state.directWhere as { parts: Array<{ values?: string[] }> }).parts[1].values).toEqual([
      'bank-1',
    ]);
  });
});
