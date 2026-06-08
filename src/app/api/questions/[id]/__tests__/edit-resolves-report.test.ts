import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { NextRequest } from 'next/server';

// B-Report-4 Phase 3: an answer-key / alternatives edit resolves the open incorrect
// report (which lifts B-Report-3 suppression); a pure explanation edit does not.
const {
  getSessionMock,
  getQuestionMock,
  updateQuestionMock,
  resolveMock,
  assessDifficultyMock,
  categorizeMock,
} = vi.hoisted(() => ({
  getSessionMock: vi.fn(async () => ({ userId: 'author-1', id: 's-1' }) as { userId: string; id: string } | null),
  getQuestionMock: vi.fn(),
  updateQuestionMock: vi.fn(async () => ({ ok: true })),
  resolveMock: vi.fn(async () => 1),
  assessDifficultyMock: vi.fn(async () => ({ difficulty: 2 })),
  categorizeMock: vi.fn(async () => ({ broad_category: 'history', subcategory: 'World History' })),
}));

const EXISTING = {
  id: 'q-1',
  text: 'What is the capital of France?',
  correctAnswer: 'Paris',
  alternateAnswers: [] as string[],
  explanation: 'Old explanation.',
  broadCategory: 'History',
  canonicalSubcategory: 'World History',
  domain: 'World History',
  usedInGamesCount: 0,
};

vi.mock('@/server/auth/session', () => ({ getSession: getSessionMock }));
vi.mock('@/server/db', () => ({
  // questionExistsForAnotherUser: same creator → not another user → proceeds.
  db: { select: () => ({ from: () => ({ where: () => ({ limit: async () => [{ creatorId: 'author-1' }] }) }) }) },
  questions: { id: 'q.id', creatorId: 'q.creatorId', deletedAt: 'q.deletedAt' },
}));
vi.mock('@/server/db/queries/questions', () => ({
  getQuestion: getQuestionMock,
  updateQuestion: updateQuestionMock,
  deleteQuestion: vi.fn(),
}));
vi.mock('@/server/db/queries/content-reports', () => ({
  resolveActiveIncorrectReportsForQuestion: resolveMock,
}));
vi.mock('@/lib/llm', () => ({ categorizeQuestion: categorizeMock }));
vi.mock('@/server/questions/llm-difficulty', () => ({ assessQuestionDifficulty: assessDifficultyMock }));

import { PATCH } from '@/app/api/questions/[id]/route';

function patch(body: unknown): Promise<Response> {
  const request = new Request('http://localhost/api/questions/q-1', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return PATCH(request as unknown as NextRequest, { params: Promise.resolve({ id: 'q-1' }) });
}

beforeEach(() => {
  vi.clearAllMocks();
  getSessionMock.mockResolvedValue({ userId: 'author-1', id: 's-1' });
  getQuestionMock.mockResolvedValue(EXISTING);
  updateQuestionMock.mockResolvedValue({ ok: true });
  resolveMock.mockResolvedValue(1);
});

describe('PATCH /api/questions/[id] — edit clears the incorrect report', () => {
  it('resolves the open incorrect report when accepted alternatives change', async () => {
    const res = await patch({ alternateAnswers: ['Lutetia'] });

    expect(res.status).toBe(200);
    expect(resolveMock).toHaveBeenCalledWith('q-1');
  });

  it('resolves the open incorrect report when the answer key changes', async () => {
    const res = await patch({ correctAnswer: 'Paris (France)' });

    expect(res.status).toBe(200);
    expect(resolveMock).toHaveBeenCalledWith('q-1');
  });

  it('does NOT resolve the report on a pure explanation edit', async () => {
    const res = await patch({ explanation: 'A clearer explanation.' });

    expect(res.status).toBe(200);
    expect(resolveMock).not.toHaveBeenCalled();
  });
});
