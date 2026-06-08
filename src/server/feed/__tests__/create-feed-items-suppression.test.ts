import { beforeEach, describe, expect, it, vi } from 'vitest';

// B-Report-3: a correct answer to a question under an open/upheld content report
// must not propagate to NEW feeds, and must not touch existing copies. We mock the
// collaborators and assert: suppressed → no insert/update/delete and the fan-out
// (eligibility check, getFollowers) is never reached; not-suppressed → the gate is
// passed (eligibility IS consulted).
const {
  isQuestionReportSuppressedMock,
  isCorrectAnswerFeedEligibleMock,
  getFollowersMock,
  insertMock,
  updateMock,
  deleteMock,
} = vi.hoisted(() => ({
  isQuestionReportSuppressedMock: vi.fn(async () => false),
  isCorrectAnswerFeedEligibleMock: vi.fn(() => false),
  getFollowersMock: vi.fn(async () => [] as Array<{ id: string }>),
  insertMock: vi.fn(() => ({ values: vi.fn(async () => undefined) })),
  updateMock: vi.fn(() => ({ set: () => ({ where: vi.fn(async () => undefined) }) })),
  deleteMock: vi.fn(() => ({ where: vi.fn(async () => undefined) })),
}));

// Every select resolves empty: the thumbs-down / rating-down probes find nothing,
// so control reaches the suppression gate. The question fetch (also empty) only
// matters on the not-suppressed path, where the eligibility mock short-circuits.
const selectChain = {
  from: () => selectChain,
  where: () => selectChain,
  limit: async () => [] as unknown[],
};

vi.mock('@/server/db', () => ({
  db: {
    select: () => selectChain,
    insert: insertMock,
    update: updateMock,
    delete: deleteMock,
  },
  feedDismissedDomains: {},
  feedItems: {},
  masteryEvents: {},
  questionFeedback: {},
  questionRatings: {},
  questions: {},
}));

vi.mock('@/server/db/queries/content-reports', () => ({
  isQuestionReportSuppressed: isQuestionReportSuppressedMock,
}));
vi.mock('@/server/feed/visibility', () => ({
  isCorrectAnswerFeedEligible: isCorrectAnswerFeedEligibleMock,
  SOCIAL_FEED_SOURCE_TYPE: 'friend_answered',
}));
vi.mock('@/server/db/queries/friends', () => ({ getFollowers: getFollowersMock }));
vi.mock('@/server/activity/write-activity', () => ({ writeActivity: vi.fn(async () => undefined) }));
vi.mock('@/server/db/queries/account', () => ({ getNicheMatchDiscoverable: vi.fn(async () => new Set()) }));
vi.mock('@/server/db/queries/friend-requests', () => ({ getRelationship: vi.fn(async () => ({ state: 'none' })) }));
vi.mock('@/server/db/queries/feed', () => ({ rollOffOldItems: vi.fn(async () => undefined) }));

import { createFeedItemsForFriendsFromAnswer } from '@/server/feed/create-feed-items-for-answer';

beforeEach(() => {
  vi.clearAllMocks();
  isQuestionReportSuppressedMock.mockResolvedValue(false);
  isCorrectAnswerFeedEligibleMock.mockReturnValue(false);
  getFollowersMock.mockResolvedValue([]);
});

describe('createFeedItemsForFriendsFromAnswer — content-report suppression', () => {
  it('does not propagate a suppressed question and touches no existing rows', async () => {
    isQuestionReportSuppressedMock.mockResolvedValue(true);

    await createFeedItemsForFriendsFromAnswer('user-1', 'q-1', 'correct', 'ans-1');

    expect(isQuestionReportSuppressedMock).toHaveBeenCalledWith('q-1');
    // Blocked before the fan-out: eligibility never consulted, no followers fetched.
    expect(isCorrectAnswerFeedEligibleMock).not.toHaveBeenCalled();
    expect(getFollowersMock).not.toHaveBeenCalled();
    // No new items, and crucially no mutation of existing copies on other players.
    expect(insertMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it('passes the suppression gate when the question is not suppressed', async () => {
    isQuestionReportSuppressedMock.mockResolvedValue(false);

    await createFeedItemsForFriendsFromAnswer('user-1', 'q-1', 'correct', 'ans-1');

    expect(isQuestionReportSuppressedMock).toHaveBeenCalledWith('q-1');
    // Got past the gate — the eligibility check (the next step) was reached.
    expect(isCorrectAnswerFeedEligibleMock).toHaveBeenCalledTimes(1);
  });

  it('never reaches the suppression gate for an incorrect answer', async () => {
    await createFeedItemsForFriendsFromAnswer('user-1', 'q-1', 'incorrect', 'ans-1');
    expect(isQuestionReportSuppressedMock).not.toHaveBeenCalled();
    expect(insertMock).not.toHaveBeenCalled();
  });
});
