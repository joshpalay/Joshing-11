import { beforeEach, describe, expect, it, vi } from 'vitest';

// Sentinel table objects so the db mock can tell which table a select hits.
const { dbMock, state, QUESTIONS, GENERATED } = vi.hoisted(() => {
  const QUESTIONS = { __table: 'questions' };
  const GENERATED = { __table: 'generatedQuestions' };

  const state = {
    existingQuestion: null as { id: string } | null,
    generated: null as Record<string, unknown> | null,
    insertedValues: null as Record<string, unknown> | null,
    insertedId: 'new-question-id',
  };

  const dbMock = {
    select: vi.fn(() => ({
      from: vi.fn((table: unknown) => ({
        where: vi.fn(() => ({
          limit: vi.fn(async () => {
            if (table === QUESTIONS) return state.existingQuestion ? [state.existingQuestion] : [];
            if (table === GENERATED) return state.generated ? [state.generated] : [];
            return [];
          }),
        })),
      })),
    })),
    insert: vi.fn(() => ({
      values: vi.fn((values: Record<string, unknown>) => {
        state.insertedValues = values;
        return { returning: vi.fn(async () => [{ id: state.insertedId }]) };
      }),
    })),
  };

  return { dbMock, state, QUESTIONS, GENERATED };
});

vi.mock('@/server/db', () => ({
  db: dbMock,
  questions: QUESTIONS,
  generatedQuestions: GENERATED,
  feedItems: {},
  users: {},
}));

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...predicates) => ({ op: 'and', predicates })),
  eq: vi.fn((column, value) => ({ op: 'eq', column, value })),
  gt: vi.fn((column, value) => ({ op: 'gt', column, value })),
  sql: Object.assign(vi.fn(() => ({ op: 'sql' })), { raw: vi.fn() }),
}));

// The route module pulls in several collaborators at import time; stub them so
// importing resolveQuestionIdForSend doesn't drag in env/cookie-dependent code.
vi.mock('@/server/activity/write-activity', () => ({ writeActivity: vi.fn() }));
vi.mock('@/server/auth/session', () => ({ getSession: vi.fn() }));
vi.mock('@/server/db/queries/feed', () => ({
  createFeedItem: vi.fn(),
  rollOffOldItems: vi.fn(),
  userAnsweredQuestionCorrectly: vi.fn(),
  userHasQuestionInBlockingFeed: vi.fn(),
}));
vi.mock('@/server/db/queries/friends', () => ({ getFriends: vi.fn() }));
vi.mock('@/server/sms', () => ({ sendSms: vi.fn() }));

import { resolveQuestionIdForSend } from '@/app/api/questions/send/route';

describe('resolveQuestionIdForSend', () => {
  beforeEach(() => {
    state.existingQuestion = null;
    state.generated = null;
    state.insertedValues = null;
    dbMock.insert.mockClear();
  });

  it('returns a real Question id unchanged without inserting', async () => {
    state.existingQuestion = { id: 'question-1' };

    const result = await resolveQuestionIdForSend('question-1');

    expect(result).toBe('question-1');
    expect(dbMock.insert).not.toHaveBeenCalled();
  });

  it('returns null when the id matches neither a Question nor a GeneratedQuestion', async () => {
    const result = await resolveQuestionIdForSend('missing');

    expect(result).toBeNull();
    expect(dbMock.insert).not.toHaveBeenCalled();
  });

  it('materializes a GeneratedQuestion with curated_sent provenance and no author', async () => {
    state.generated = {
      id: 'gen-1',
      questionText: 'What is the capital of France?',
      answer: 'Paris',
      explainer: 'Paris has been the capital since 987.',
      broadCategory: 'Geography',
      canonicalSubcategory: 'European Capitals',
      difficultyEstimate: 'accessible',
    };

    const result = await resolveQuestionIdForSend('gen-1');

    expect(result).toBe('new-question-id');
    expect(dbMock.insert).toHaveBeenCalledTimes(1);
    // The crux of B-2: no author is recorded (so author/curator credit can't
    // accrue to the forwarder) and the LLM/curated origin is preserved.
    expect(state.insertedValues).toMatchObject({
      creatorId: null,
      source: 'curated_sent',
      sourceQuestionId: 'gen-1',
      questionText: 'What is the capital of France?',
      answerText: 'Paris',
    });
  });
});
