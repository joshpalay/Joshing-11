import { beforeEach, describe, expect, it, vi } from 'vitest';

// Sentinel table objects so the db mock can tell which table a select hits.
const { dbMock, state, QUESTIONS, GENERATED, USERS, FEED_ITEMS } = vi.hoisted(() => {
  const QUESTIONS = { __table: 'questions' };
  const GENERATED = { __table: 'generatedQuestions' };
  const USERS = { __table: 'users' };
  const FEED_ITEMS = { __table: 'feedItems' };

  const state = {
    existingQuestion: null as { id: string; source?: string } | null,
    generated: null as Record<string, unknown> | null,
    userRow: null as Record<string, unknown> | null,
    insertedValues: null as Record<string, unknown> | null,
    insertedId: 'new-question-id',
  };

  // `where()` returns a Promise (awaited directly by aggregate queries like the
  // 24h send-count) that also carries a `.limit()` method (used by the
  // single-row lookups). This keeps both call shapes working off one mock.
  const rowsFor = (table: unknown): unknown[] => {
    if (table === QUESTIONS) return state.existingQuestion ? [state.existingQuestion] : [];
    if (table === GENERATED) return state.generated ? [state.generated] : [];
    if (table === USERS) return state.userRow ? [state.userRow] : [];
    return [];
  };

  const dbMock = {
    select: vi.fn(() => ({
      from: vi.fn((table: unknown) => ({
        where: vi.fn(() => {
          const rows = rowsFor(table);
          const result = Promise.resolve(rows) as Promise<unknown[]> & { limit: ReturnType<typeof vi.fn> };
          result.limit = vi.fn(async () => rows);
          return result;
        }),
      })),
    })),
    insert: vi.fn(() => ({
      values: vi.fn((values: Record<string, unknown>) => {
        state.insertedValues = values;
        return { returning: vi.fn(async () => [{ id: state.insertedId }]) };
      }),
    })),
  };

  return { dbMock, state, QUESTIONS, GENERATED, USERS, FEED_ITEMS };
});

vi.mock('@/server/db', () => ({
  db: dbMock,
  questions: QUESTIONS,
  generatedQuestions: GENERATED,
  feedItems: FEED_ITEMS,
  users: USERS,
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

import { POST, resolveQuestionIdForSend } from '@/app/api/questions/send/route';
import { getSession } from '@/server/auth/session';
import { getFriends } from '@/server/db/queries/friends';
import {
  createFeedItem,
  userAnsweredQuestionCorrectly,
  userHasQuestionInBlockingFeed,
} from '@/server/db/queries/feed';

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

describe('POST /api/questions/send — house guard (D-3)', () => {
  function buildRequest(body: Record<string, unknown>) {
    return {
      json: async () => body,
      nextUrl: { origin: 'http://localhost:3000' },
    } as never;
  }

  beforeEach(() => {
    state.existingQuestion = null;
    state.generated = null;
    // No phone number ⇒ the SMS branch is skipped (keeps the test focused).
    state.userRow = { id: 'recipient-1', displayName: 'Rae', phoneNumber: null, smsOptIn: 'opted_out' };
    vi.mocked(getSession).mockResolvedValue({ userId: 'sender-1' } as never);
    vi.mocked(getFriends).mockResolvedValue([{ id: 'recipient-1' }] as never);
    vi.mocked(userAnsweredQuestionCorrectly).mockResolvedValue(false as never);
    vi.mocked(userHasQuestionInBlockingFeed).mockResolvedValue(false as never);
    vi.mocked(createFeedItem).mockResolvedValue({ id: 'feed-1' } as never);
    dbMock.insert.mockClear();
  });

  it('rejects a house_authored question with 400 and does not create a feed item', async () => {
    state.existingQuestion = { id: 'house-q', source: 'house_authored' };

    const response = await POST(buildRequest({ question_id: 'house-q', recipient_user_id: 'recipient-1' }));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: 'invalid_question' });
    expect(createFeedItem).not.toHaveBeenCalled();
  });

  it('lets a normal authored question through the guard', async () => {
    state.existingQuestion = { id: 'authored-q', source: 'authored' };

    const response = await POST(buildRequest({ question_id: 'authored-q', recipient_user_id: 'recipient-1' }));

    expect(response.status).toBe(201);
    expect(createFeedItem).toHaveBeenCalledTimes(1);
  });
});
