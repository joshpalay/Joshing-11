import { beforeEach, describe, expect, it, vi } from 'vitest';

// QA 2026-09-25 C2: blocking left both sides' feeds naming each other ("Trio
// Third is now a friend"), with the name linking to a 404. buildActivityStream
// must drop every row that names someone on either side of a block, whatever
// its source table, and strip a blocked "via" relay without dropping the
// friend's card. Transforms echo their input so the block filter is the only
// thing acting on the crafted rows.
const { getActivitiesForUserMock, getLatelyMomentsMock, getFriendActivityMock, blockedIdsAmongMock } = vi.hoisted(() => ({
  getActivitiesForUserMock: vi.fn(async () => [] as unknown[]),
  getLatelyMomentsMock: vi.fn(async () => [] as unknown[]),
  getFriendActivityMock: vi.fn(async () => [] as unknown[]),
  blockedIdsAmongMock: vi.fn(async () => new Set<string>()),
}));

vi.mock('@/app/activities/filter-utility-activities', () => ({
  filterUtilityActivities: (items: unknown[]) => items,
}));
vi.mock('@/lib/activity-stream', () => ({
  activityToStreamItem: (x: object) => x,
  momentToStreamItem: (x: object) => x,
  bundleAnswerToStreamItem: (x: object) => x,
  convergenceToStreamItem: (c: object) => c,
  friendActivityToStreamItem: (card: { id: string; friendId: string }, questions: unknown) => ({
    id: card.id,
    friendId: card.friendId,
    line: [],
    expand: { kind: 'milestone', questions },
  }),
}));
vi.mock('@/lib/lately', () => ({
  sortByProminence: (items: unknown[]) => items,
  convergenceCaptionTemplate: () => '',
}));
vi.mock('@/lib/lately-milestones', () => ({ MILESTONE_CARD_QUESTION_CAP: 5 }));
vi.mock('@/server/db/queries/activity', () => ({ getActivitiesForUser: getActivitiesForUserMock }));
vi.mock('@/server/db/queries/user-blocks', () => ({ blockedIdsAmong: blockedIdsAmongMock }));
vi.mock('@/server/db/queries/content-reports', () => ({
  getViewerHiddenQuestionIds: vi.fn(async () => new Set<string>()),
}));
vi.mock('@/server/db/queries/lately', () => ({
  getLatelyMoments: getLatelyMomentsMock,
  getBundleAnswerMoments: vi.fn(async () => []),
  getLatelyConvergences: vi.fn(async () => []),
  getFriendActivity: getFriendActivityMock,
  getMilestoneQuestionText: vi.fn(async () => new Map([
    ['q1', { questionId: 'q1', text: 'Q1', domain: 'D' }],
  ])),
  getViewerPriorAnswerResults: vi.fn(async () => new Map()),
  getCorrectAnswersForSettledQuestions: vi.fn(async () => new Map()),
  getViewerDismissedMilestoneIds: vi.fn(async () => new Set()),
}));

import { buildActivityStream } from '@/server/activity/build-stream';

beforeEach(() => {
  vi.clearAllMocks();
  getActivitiesForUserMock.mockResolvedValue([]);
  getLatelyMomentsMock.mockResolvedValue([]);
  getFriendActivityMock.mockResolvedValue([]);
  blockedIdsAmongMock.mockResolvedValue(new Set(['blocked']));
});

describe('buildActivityStream — blocked people', () => {
  it('drops rows owned by or naming a blocked person, from every source', async () => {
    getActivitiesForUserMock.mockResolvedValue([
      { id: 'act-blocked', type: 'follow_mutual', actorUserId: 'blocked', friendId: 'blocked', line: [], reference: {} },
      { id: 'act-ok', type: 'follow_mutual', actorUserId: 'friend', friendId: 'friend', line: [], reference: {} },
    ]);
    getLatelyMomentsMock.mockResolvedValue([
      // Friend-less row whose one-liner links the blocked person.
      { id: 'moment-names-blocked', friendId: null, line: [{ t: 'actor', name: 'B', userId: 'blocked' }] },
    ]);

    const ids = ((await buildActivityStream('viewer')) as unknown as Array<{ id: string }>).map((s) => s.id);

    expect(ids).toEqual(['act-ok']);
    expect(blockedIdsAmongMock).toHaveBeenCalledWith('viewer', expect.arrayContaining(['blocked', 'friend']));
  });

  it("keeps a friend's bundle but strips a blocked 'via' relay", async () => {
    getFriendActivityMock.mockResolvedValue([
      { id: 'card', friendId: 'friend', questionIds: ['q1'], viaByQuestionId: { q1: { userId: 'blocked', name: 'B' } } },
    ]);

    const stream = (await buildActivityStream('viewer')) as unknown as Array<{
      id: string;
      expand: { questions: Array<{ via: unknown }> };
    }>;

    expect(stream.map((s) => s.id)).toEqual(['card']);
    expect(stream[0].expand.questions[0].via).toBeNull();
  });
});
