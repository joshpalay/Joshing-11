import { beforeEach, describe, expect, it, vi } from 'vitest';

// D-ACCOUNT-DELETION-TERRITORY-01 follow-up (2026-06-16): a degraded
// "{actor} answered your question" row whose actor is unknown (the friend/
// stranger deleted their account, so actorUserId was nulled) AND whose question
// can't be shown renders as "Someone answered your question" with nothing to see
// or open. buildActivityStream must drop it. We mock filter-utility (identity),
// the pure transforms (echo the item), and the lately queries (empty) so the
// hollow-row filter is the only thing acting on the crafted activity rows.
const { getActivitiesForUserMock } = vi.hoisted(() => ({
  getActivitiesForUserMock: vi.fn(async () => [] as unknown[]),
}));

vi.mock('@/app/activities/filter-utility-activities', () => ({
  filterUtilityActivities: (items: unknown[]) => items,
}));
vi.mock('@/lib/activity-stream', () => ({
  activityToStreamItem: (x: { id: string }) => x,
  momentToStreamItem: (x: unknown) => x,
  bundleAnswerToStreamItem: (x: unknown) => x,
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
  getBundleAnswerMoments: vi.fn(async () => []),
  getLatelyConvergences: vi.fn(async () => []),
  getFriendActivity: vi.fn(async () => []),
  getMilestoneQuestionText: vi.fn(async () => new Map()),
  getViewerPriorAnswerResults: vi.fn(async () => new Map()),
  getViewerDismissedMilestoneIds: vi.fn(async () => new Set()),
}));

import { buildActivityStream } from '@/server/activity/build-stream';

function row(over: Record<string, unknown>) {
  return { id: 'x', actorUserId: 'friend-1', reference: {}, ...over };
}

beforeEach(() => vi.clearAllMocks());

describe('buildActivityStream — hollow degraded "answered your question" rows', () => {
  it('drops a friend_answered_your_question with no actor and no question to show', async () => {
    getActivitiesForUserMock.mockResolvedValue([
      row({ id: 'hollow', type: 'friend_answered_your_question', actorUserId: null, reference: {} }),
      row({ id: 'has-actor', type: 'friend_answered_your_question', actorUserId: 'friend-1', reference: {} }),
      row({ id: 'has-content', type: 'friend_answered_your_question', actorUserId: null, reference: { friendAnsweredQuestion: { questionText: 'what year?' } } }),
    ]);

    const stream = (await buildActivityStream('viewer-1')) as unknown as Array<{ id: string }>;
    const ids = stream.map((s) => s.id);

    expect(ids).not.toContain('hollow');
    expect(ids).toContain('has-actor'); // actor known → keep ("you can see who")
    expect(ids).toContain('has-content'); // question openable → keep ("you can see what")
  });

  it('drops a niche_match_answered_your_question with no actor and no question, but keeps unrelated null-actor rows', async () => {
    getActivitiesForUserMock.mockResolvedValue([
      row({ id: 'niche-hollow', type: 'niche_match_answered_your_question', actorUserId: null, reference: {} }),
      row({ id: 'niche-content', type: 'niche_match_answered_your_question', actorUserId: null, reference: { nicheMatch: { questionText: 'q' } } }),
      // A friendless aggregate row (e.g. "You shared…") legitimately has a null
      // actor and is NOT one of the filtered types — it must survive.
      row({ id: 'aggregate', type: 'authored_shared_to_friends', actorUserId: null, reference: {} }),
    ]);

    const stream = (await buildActivityStream('viewer-1')) as unknown as Array<{ id: string }>;
    const ids = stream.map((s) => s.id);

    expect(ids).not.toContain('niche-hollow');
    expect(ids).toContain('niche-content');
    expect(ids).toContain('aggregate');
  });
});
