import { beforeEach, describe, expect, it, vi } from 'vitest';

// claude/friend-request-sync-bug: a follow_request / friend_request activity row
// outlives its backing follows edge — the edge is hard-deleted on decline/cancel
// and flips to approved on accept, but the row lingers and keeps rendering
// "{actor} wants to be friends" with no live pending edge behind it. The
// decline/cancel paths now soft-delete the row; buildActivityStream is the
// defensive backstop that drops any row whose request is missing or no longer a
// live pending edge. Same mock shape as build-stream-hollow-degraded: filter-
// utility is identity, the transforms echo the item, the lately queries are
// empty, so the stale-request filter is the only thing acting on the rows.
const { getActivitiesForUserMock } = vi.hoisted(() => ({
  getActivitiesForUserMock: vi.fn(async () => [] as unknown[]),
}));

vi.mock('@/app/activities/filter-utility-activities', () => ({
  filterUtilityActivities: (items: unknown[]) => items,
}));
vi.mock('@/lib/activity-stream', () => ({
  activityToStreamItem: (x: { id: string }) => x,
  momentToStreamItem: (x: unknown) => x,
  convergenceToStreamItem: (_c: unknown, questions: unknown) => ({ kind: 'convergence', questions }),
  friendActivityToStreamItem: (card: { id: string }, questions: unknown) => ({ kind: 'milestone', id: card.id, questions }),
}));
vi.mock('@/lib/lately', () => ({
  sortByProminence: (items: unknown[]) => items,
  convergenceCaptionTemplate: () => '',
}));
vi.mock('@/lib/lately-milestones', () => ({ MILESTONE_CARD_QUESTION_CAP: 5 }));
vi.mock('@/server/db/queries/activity', () => ({ getActivitiesForUser: getActivitiesForUserMock }));
vi.mock('@/server/db/queries/content-reports', () => ({
  getViewerHiddenQuestionIds: vi.fn(async () => new Set<string>()),
}));
vi.mock('@/server/db/queries/lately', () => ({
  getLatelyMoments: vi.fn(async () => []),
  getLatelyConvergences: vi.fn(async () => []),
  getFriendActivity: vi.fn(async () => []),
  getMilestoneQuestionText: vi.fn(async () => new Map()),
  getViewerPriorAnswerResults: vi.fn(async () => new Map()),
  getViewerDismissedMilestoneIds: vi.fn(async () => new Set()),
}));

import { buildActivityStream } from '@/server/activity/build-stream';

const VIEWER = 'viewer-1';
const REQUESTER = 'requester-1';

function request(over: Record<string, unknown>) {
  return {
    actorUserId: REQUESTER,
    userId: VIEWER,
    type: 'follow_request',
    reference: {},
    ...over,
  };
}

beforeEach(() => vi.clearAllMocks());

describe('buildActivityStream — stale follow/friend request rows', () => {
  it('keeps a live pending request and drops resolved/missing ones', async () => {
    getActivitiesForUserMock.mockResolvedValue([
      // Live pending edge, requested by someone other than the viewer → keep.
      request({
        id: 'pending',
        reference: { friendshipRequest: { id: 'e1', status: 'pending', requestedByUserId: REQUESTER } },
      }),
      // Accepted: the edge flipped to approved ('active') → drop.
      request({
        id: 'accepted',
        reference: { friendshipRequest: { id: 'e2', status: 'active', requestedByUserId: REQUESTER } },
      }),
      // Declined/cancelled: the edge was hard-deleted so hydration found nothing
      // (friendshipRequest is undefined) → drop.
      request({ id: 'declined', reference: {} }),
      // Legacy friend_request row pointing at a frozen friendship that's gone.
      request({ id: 'legacy', type: 'friend_request', reference: {} }),
    ]);

    const stream = (await buildActivityStream(VIEWER)) as unknown as Array<{ id: string }>;
    const ids = stream.map((s) => s.id);

    expect(ids).toContain('pending');
    expect(ids).not.toContain('accepted');
    expect(ids).not.toContain('declined');
    expect(ids).not.toContain('legacy');
  });

  it('leaves unrelated activity types untouched', async () => {
    getActivitiesForUserMock.mockResolvedValue([
      request({ id: 'follow', type: 'follow', reference: {} }),
      request({ id: 'mutual', type: 'follow_mutual', reference: {} }),
    ]);

    const stream = (await buildActivityStream(VIEWER)) as unknown as Array<{ id: string }>;
    const ids = stream.map((s) => s.id);

    expect(ids).toContain('follow');
    expect(ids).toContain('mutual');
  });
});
