import { beforeEach, describe, expect, it, vi } from 'vitest';

// B-HOME-EXHAUST-05 (D-HOME-DASHBOARD-MODEL-01 point 3) — a From Friends bundle
// is hidden once the viewer has played EVERY answerable question in it
// (remaining === 0); a partially-played bundle stays. The played/unplayed state
// is viewer-relative (getViewerPriorAnswerResults(userId, …)), so the same
// bundle can be exhausted for one viewer and answerable for another in the same
// run with no cross-viewer leakage. We mock the upstream queries (echoing the
// questions through the pure transforms) and assert which bundles survive.

const { getViewerPriorAnswerResultsMock, getViewerDismissedMilestoneIdsMock, getFriendActivityMock } =
  vi.hoisted(() => ({
    getViewerPriorAnswerResultsMock: vi.fn(async () => new Map<string, 'correct' | 'incorrect'>()),
    getViewerDismissedMilestoneIdsMock: vi.fn(async () => new Set<string>()),
    getFriendActivityMock: vi.fn(async () => [{ id: 'm1', questionIds: ['q1', 'q2'] }]),
  }));

vi.mock('@/app/activities/filter-utility-activities', () => ({
  filterUtilityActivities: () => [],
}));
vi.mock('@/lib/activity-stream', () => ({
  activityToStreamItem: (x: unknown) => x,
  momentToStreamItem: (x: unknown) => x,
  convergenceToStreamItem: (_c: unknown, questions: unknown) => ({ kind: 'convergence', questions }),
  friendActivityToStreamItem: (card: { id: string }, questions: unknown) => ({
    kind: 'milestone',
    id: card.id,
    questions,
  }),
}));
vi.mock('@/lib/lately', () => ({
  sortByProminence: (items: unknown[]) => items,
  convergenceCaptionTemplate: () => '',
}));
vi.mock('@/lib/lately-milestones', () => ({ MILESTONE_CARD_QUESTION_CAP: 5 }));
vi.mock('@/server/db/queries/activity', () => ({ getActivitiesForUser: vi.fn(async () => []) }));
vi.mock('@/server/db/queries/content-reports', () => ({
  getViewerHiddenQuestionIds: vi.fn(async () => new Set<string>()),
}));
vi.mock('@/server/db/queries/lately', () => ({
  getLatelyMoments: vi.fn(async () => []),
  getLatelyConvergences: vi.fn(async () => []),
  getFriendActivity: getFriendActivityMock,
  getMilestoneQuestionText: vi.fn(async (ids: string[]) =>
    new Map(ids.map((id) => [id, { questionId: id, text: `text ${id}`, domain: 'history' }])),
  ),
  getViewerPriorAnswerResults: getViewerPriorAnswerResultsMock,
  getViewerDismissedMilestoneIds: getViewerDismissedMilestoneIdsMock,
}));

import { buildActivityStream } from '@/server/activity/build-stream';

type MilestoneItem = {
  kind: string;
  id: string;
  questions: Array<{
    questionId: string;
    priorResult: 'correct' | 'incorrect' | null;
    dismissed?: boolean;
  }>;
};

beforeEach(() => {
  vi.clearAllMocks();
  getFriendActivityMock.mockResolvedValue([{ id: 'm1', questionIds: ['q1', 'q2'] }]);
  getViewerPriorAnswerResultsMock.mockResolvedValue(new Map());
  getViewerDismissedMilestoneIdsMock.mockResolvedValue(new Set());
});

describe('buildActivityStream — exhausted From Friends bundles are hidden (per-viewer)', () => {
  it('drops a bundle whose every question the viewer has played (remaining === 0)', async () => {
    getViewerPriorAnswerResultsMock.mockResolvedValue(
      new Map([
        ['q1', 'correct'],
        ['q2', 'incorrect'],
      ]),
    );

    const stream = (await buildActivityStream('viewer-1')) as unknown as MilestoneItem[];
    expect(stream.find((item) => item.kind === 'milestone')).toBeUndefined();
  });

  it('keeps a partially-played bundle, with the unplayed question still answerable', async () => {
    getViewerPriorAnswerResultsMock.mockResolvedValue(new Map([['q1', 'correct']]));

    const stream = (await buildActivityStream('viewer-1')) as unknown as MilestoneItem[];
    const milestone = stream.find((item) => item.kind === 'milestone');

    expect(milestone).toBeDefined();
    // Both questions remain in the bundle; q1 is spent (played), q2 is the one
    // unplayed question — the remaining count is 1.
    expect(milestone!.questions.map((q) => q.questionId)).toEqual(['q1', 'q2']);
    const remaining = milestone!.questions.filter((q) => q.priorResult === null);
    expect(remaining.map((q) => q.questionId)).toEqual(['q2']);
  });

  it('is viewer-relative: the same bundle is exhausted for A but answerable for B, no leakage', async () => {
    getViewerPriorAnswerResultsMock.mockImplementation(async (userId: string) =>
      userId === 'viewer-A'
        ? new Map<string, 'correct' | 'incorrect'>([
            ['q1', 'correct'],
            ['q2', 'correct'],
          ])
        : new Map<string, 'correct' | 'incorrect'>([['q1', 'correct']]),
    );

    const streamA = (await buildActivityStream('viewer-A')) as unknown as MilestoneItem[];
    const streamB = (await buildActivityStream('viewer-B')) as unknown as MilestoneItem[];

    expect(streamA.find((i) => i.kind === 'milestone')).toBeUndefined();
    const milestoneB = streamB.find((i) => i.kind === 'milestone');
    expect(milestoneB).toBeDefined();
    expect(milestoneB!.questions.filter((q) => q.priorResult === null).map((q) => q.questionId)).toEqual([
      'q2',
    ]);
  });

  it('computes the remaining count over the capped (≤ MILESTONE_CARD_QUESTION_CAP) question set', async () => {
    // Seven questions in the bundle, none played → capped to 5, all 5 answerable.
    getFriendActivityMock.mockResolvedValue([
      { id: 'm-big', questionIds: ['q1', 'q2', 'q3', 'q4', 'q5', 'q6', 'q7'] },
    ]);

    const stream = (await buildActivityStream('viewer-1')) as unknown as MilestoneItem[];
    const milestone = stream.find((item) => item.kind === 'milestone');

    expect(milestone).toBeDefined();
    expect(milestone!.questions).toHaveLength(5);
    expect(milestone!.questions.filter((q) => q.priorResult === null)).toHaveLength(5);
  });

  // Dismiss-as-answered: a dismissed question is consumed like an answered one —
  // it no longer counts as "remaining", so waving off the last unanswered
  // question empties the bundle and it drops, and the flag rides each question so
  // the client can render the dismissed ones (and keep them dismissed on reload).
  it('drops a bundle whose questions are all dismissed (no answers)', async () => {
    getViewerDismissedMilestoneIdsMock.mockResolvedValue(new Set(['q1', 'q2']));

    const stream = (await buildActivityStream('viewer-1')) as unknown as MilestoneItem[];
    expect(stream.find((item) => item.kind === 'milestone')).toBeUndefined();
  });

  it('drops a bundle whose questions are a mix of answered and dismissed', async () => {
    getViewerPriorAnswerResultsMock.mockResolvedValue(new Map([['q1', 'correct']]));
    getViewerDismissedMilestoneIdsMock.mockResolvedValue(new Set(['q2']));

    const stream = (await buildActivityStream('viewer-1')) as unknown as MilestoneItem[];
    expect(stream.find((item) => item.kind === 'milestone')).toBeUndefined();
  });

  it('keeps a bundle with one dismissed and one still-answerable question, flagging the dismissed one', async () => {
    getViewerDismissedMilestoneIdsMock.mockResolvedValue(new Set(['q1']));

    const stream = (await buildActivityStream('viewer-1')) as unknown as MilestoneItem[];
    const milestone = stream.find((item) => item.kind === 'milestone');

    expect(milestone).toBeDefined();
    // q1 carries the dismissed flag (so the card renders it as dismissed); q2 is
    // the one remaining answerable question.
    expect(milestone!.questions.find((q) => q.questionId === 'q1')?.dismissed).toBe(true);
    expect(milestone!.questions.find((q) => q.questionId === 'q2')?.dismissed).toBe(false);
    const remaining = milestone!.questions.filter((q) => q.priorResult === null && !q.dismissed);
    expect(remaining.map((q) => q.questionId)).toEqual(['q2']);
  });
});
