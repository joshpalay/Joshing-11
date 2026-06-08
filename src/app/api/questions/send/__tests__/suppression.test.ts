import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { NextRequest } from 'next/server';

// B-Report-3: a question under an open/upheld content report can't be direct-sent.
// The guard runs on the RAW incoming id (before resolveQuestionIdForSend would mint
// a GeneratedQuestion into a fresh curated Question), so we assert the 409 fires and
// nothing downstream (resolution → feed write) runs.
const { getSessionMock, getFriendsMock, isSuppressedMock, createFeedItemMock } = vi.hoisted(() => ({
  getSessionMock: vi.fn(async () => ({ userId: 'sender-1', id: 's-1' }) as { userId: string; id: string } | null),
  getFriendsMock: vi.fn(async () => [{ id: 'recipient-1' }] as Array<{ id: string }>),
  isSuppressedMock: vi.fn(async () => false),
  createFeedItemMock: vi.fn(async () => ({ id: 'feed-1' })),
}));

vi.mock('@/server/auth/session', () => ({ getSession: getSessionMock }));
vi.mock('@/server/db/queries/friends', () => ({ getFriends: getFriendsMock }));
vi.mock('@/server/db/queries/content-reports', () => ({ isQuestionReportSuppressed: isSuppressedMock }));
vi.mock('@/server/db', () => ({
  db: { select: vi.fn(() => ({ from: () => ({ where: () => ({ limit: async () => [] }) }) })) },
  feedItems: {},
  generatedQuestions: {},
  questions: {},
  users: {},
}));
vi.mock('@/server/db/queries/feed', () => ({
  createFeedItem: createFeedItemMock,
  rollOffOldItems: vi.fn(async () => undefined),
  userAnsweredQuestionCorrectly: vi.fn(async () => false),
  userHasQuestionInBlockingFeed: vi.fn(async () => false),
}));
vi.mock('@/server/activity/write-activity', () => ({ writeActivity: vi.fn(async () => undefined) }));
vi.mock('@/server/sms', () => ({ sendSms: vi.fn(async () => undefined) }));
vi.mock('@/server/feed/visibility', () => ({ DIRECT_SENT_FEED_SOURCE_TYPE: 'direct_sent' }));

import { POST } from '@/app/api/questions/send/route';

function post(body: unknown): Promise<Response> {
  const request = new Request('http://localhost/api/questions/send', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return POST(request as unknown as NextRequest);
}

const body = { question_id: 'q-1', recipient_user_id: 'recipient-1' };

beforeEach(() => {
  vi.clearAllMocks();
  getSessionMock.mockResolvedValue({ userId: 'sender-1', id: 's-1' });
  getFriendsMock.mockResolvedValue([{ id: 'recipient-1' }]);
  isSuppressedMock.mockResolvedValue(false);
});

describe('POST /api/questions/send — content-report suppression', () => {
  it('returns 409 under_review and writes no feed item when the question is suppressed', async () => {
    isSuppressedMock.mockResolvedValue(true);

    const res = await post(body);

    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('under_review');
    expect(isSuppressedMock).toHaveBeenCalledWith('q-1');
    expect(createFeedItemMock).not.toHaveBeenCalled();
  });

  it('passes the suppression gate when the question is not suppressed', async () => {
    isSuppressedMock.mockResolvedValue(false);

    const res = await post(body);

    // Not a 409: the request proceeds past the gate (it then 404s on the stubbed
    // db, which is fine — the point is the suppression block did not fire).
    expect(res.status).not.toBe(409);
    expect(isSuppressedMock).toHaveBeenCalledWith('q-1');
  });
});
