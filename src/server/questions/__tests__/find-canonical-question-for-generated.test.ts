import { beforeEach, describe, expect, it, vi } from 'vitest';

// Minimal db mock: the helper issues one select…from…where…orderBy…limit chain
// and reads the first row. We only need to control the rows it returns.
const { dbMock, state } = vi.hoisted(() => {
  const state = { rows: [] as Array<{ id: string }> };
  const chain = {
    from: vi.fn(() => chain),
    where: vi.fn(() => chain),
    orderBy: vi.fn(() => chain),
    limit: vi.fn(async () => state.rows),
  };
  const dbMock = { select: vi.fn(() => chain) };
  return { dbMock, state };
});

vi.mock('@/server/db', () => ({
  db: dbMock,
  questions: { source: 'questions.source' },
  generatedQuestions: {},
}));

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...p) => ({ op: 'and', p })),
  eq: vi.fn((column, value) => ({ op: 'eq', column, value })),
  or: vi.fn((...p) => ({ op: 'or', p })),
  isNull: vi.fn((column) => ({ op: 'isNull', column })),
  sql: Object.assign(vi.fn(() => ({ op: 'sql' })), { raw: vi.fn() }),
}));

import { findCanonicalQuestionIdForGenerated } from '@/server/questions/persist-generated-question';

describe('findCanonicalQuestionIdForGenerated', () => {
  beforeEach(() => {
    state.rows = [];
  });

  it('returns the canonical Question id when a row links to the generated id', async () => {
    state.rows = [{ id: 'canonical-q' }];
    await expect(findCanonicalQuestionIdForGenerated('gen-1')).resolves.toBe('canonical-q');
  });

  it('returns null when no Question links to the generated id', async () => {
    state.rows = [];
    await expect(findCanonicalQuestionIdForGenerated('gen-unknown')).resolves.toBeNull();
  });
});
