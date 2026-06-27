import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

// D-REVIEW-RECOVERED-01 (Decision B / Done-When #3 & #4) — the review grade
// route grades for real and persists NOTHING. These tests pin:
//   - a scored verdict returns the result + canonical answer, no writes;
//   - the route imports neither writeMasteryEvent nor deriveAnswerOutcome;
//   - an `unscored` grader outcome fails toward the player (503 retry) and is
//     NEVER returned as a miss (no `isCorrect: false`);
//   - pool-membership / auth guards.

const { getSessionMock, gradeAnswerMock, getRecoveredGradingQuestionMock } = vi.hoisted(() => ({
  getSessionMock: vi.fn(async () => ({ userId: 'user-1', id: 's-1' })),
  gradeAnswerMock: vi.fn(),
  getRecoveredGradingQuestionMock: vi.fn(),
}));

vi.mock('@/server/auth/session', () => ({ getSession: getSessionMock }));
vi.mock('@/server/grading', () => ({ gradeAnswer: gradeAnswerMock }));
vi.mock('@/server/db/queries/recovered-questions', () => ({
  getRecoveredGradingQuestion: getRecoveredGradingQuestionMock,
}));

import { POST } from '@/app/api/recovered/grade/route';

const GRADABLE = {
  questionId: 'q-7',
  questionText: 'Who wrote the Storia d’Italia?',
  answerText: 'Francesco Guicciardini',
  acceptedAlternatives: ['Guicciardini'],
  questionType: 'factual' as const,
  explanation: 'A Florentine historian and statesman.',
  creatorNote: null,
};

function req(body: unknown): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}

beforeEach(() => {
  getSessionMock.mockResolvedValue({ userId: 'user-1', id: 's-1' });
  getRecoveredGradingQuestionMock.mockResolvedValue(GRADABLE);
});
afterEach(() => vi.clearAllMocks());

describe('POST /api/recovered/grade', () => {
  it('401s without a session', async () => {
    getSessionMock.mockResolvedValueOnce(null);
    const res = await POST(req({ questionId: 'q-7', answer: 'x' }));
    expect(res.status).toBe(401);
  });

  it('400s on a malformed body', async () => {
    const res = await POST(req({ answer: 'x' }));
    expect(res.status).toBe(400);
  });

  it('404s when the question is not in the viewer recovered pool', async () => {
    getRecoveredGradingQuestionMock.mockResolvedValueOnce(null);
    const res = await POST(req({ questionId: 'q-x', answer: 'x' }));
    expect(res.status).toBe(404);
    expect(gradeAnswerMock).not.toHaveBeenCalled();
  });

  it('returns a scored CORRECT verdict with the canonical answer', async () => {
    gradeAnswerMock.mockResolvedValueOnce({
      status: 'scored',
      result: 'correct',
      consolation: null,
      confidence: 1,
      gradedVia: 'exact',
      gradedProvider: null,
    });
    const res = await POST(req({ questionId: 'q-7', answer: 'Guicciardini' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ isCorrect: true, correctAnswer: 'Francesco Guicciardini' });
  });

  it('returns a scored WRONG verdict and reveals the answer (no consequence)', async () => {
    gradeAnswerMock.mockResolvedValueOnce({
      status: 'scored',
      result: 'wrong',
      consolation: 'So close.',
      confidence: 0.9,
      gradedVia: 'llm',
      gradedProvider: 'anthropic',
    });
    const res = await POST(req({ questionId: 'q-7', answer: 'Machiavelli' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.isCorrect).toBe(false);
    expect(body.correctAnswer).toBe('Francesco Guicciardini');
    expect(body.consolation).toBe('So close.');
  });

  it('fails toward the player on an unscored grade — 503 retry, NEVER a miss', async () => {
    gradeAnswerMock.mockResolvedValueOnce({ status: 'unscored', reason: 'llm_error' });
    const res = await POST(req({ questionId: 'q-7', answer: 'something' }));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toBe('grader_unavailable');
    // The crux: an unscored grade is not rendered as a wrong answer.
    expect('isCorrect' in body).toBe(false);
  });
});

describe('read-only contract — the route runs no persistence tail', () => {
  it('imports neither writeMasteryEvent nor deriveAnswerOutcome (nor any fan-out)', () => {
    const routePath = fileURLToPath(new URL('../route.ts', import.meta.url));
    const source = readFileSync(routePath, 'utf8');
    // Assert on import MODULE PATHS — they appear only in import statements, so
    // this verifies "imports neither" without matching the explanatory comment
    // that names the identifiers in prose.
    expect(source).not.toContain('mastery/write-mastery-event');
    expect(source).not.toContain('answers/answer-pipeline');
    expect(source).not.toContain('feed/create-feed-items-for-answer');
    expect(source).not.toContain('knowledge/open-domain');
    // And no call sites either (paren-suffixed; prose uses bare backticks).
    expect(source).not.toContain('writeMasteryEvent(');
    expect(source).not.toContain('deriveAnswerOutcome(');
  });
});
