import { beforeEach, describe, expect, it, vi } from 'vitest';

// B-Report-3 durable self-hide: a question the viewer reported as inappropriate
// (open|upheld) must stay out of their Lately milestone stack across reloads. We
// mock the upstream lately queries and the pure transforms (echoing the questions
// they receive) so we can assert the hidden id is filtered before render.
const { getViewerHiddenQuestionIdsMock, getViewerPriorAnswerResultsMock } = vi.hoisted(() => ({
  getViewerHiddenQuestionIdsMock: vi.fn(async () => new Set<string>()),
  getViewerPriorAnswerResultsMock: vi.fn(
    async () => new Map<string, 'correct' | 'incorrect'>(),
  ),
}));

vi.mock('@/app/activities/filter-utility-activities', () => ({
  filterUtilityActivities: () => [],
}));
vi.mock('@/lib/activity-stream', () => ({
  activityToStreamItem: (x: unknown) => x,
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
vi.mock('@/server/db/queries/activity', () => ({ getActivitiesForUser: vi.fn(async () => []) }));
vi.mock('@/server/db/queries/content-reports', () => ({
  getViewerHiddenQuestionIds: getViewerHiddenQuestionIdsMock,
}));
vi.mock('@/server/db/queries/lately', () => ({
  getLatelyMoments: vi.fn(async () => []),
  getBundleAnswerMoments: vi.fn(async () => []),
  getLatelyConvergences: vi.fn(async () => []),
  getFriendActivity: vi.fn(async () => [{ id: 'm1', questionIds: ['q-keep', 'q-hidden'] }]),
  getMilestoneQuestionText: vi.fn(async (ids: string[]) =>
    new Map(ids.map((id) => [id, { questionId: id, text: `text ${id}`, domain: 'history' }])),
  ),
  getViewerPriorAnswerResults: getViewerPriorAnswerResultsMock,
  // Settled-card answer read-back; irrelevant to these cases, so a bare empty map.
  getCorrectAnswersForSettledQuestions: async () => new Map<string, string>(),
  getViewerDismissedMilestoneIds: vi.fn(async () => new Set()),
}));

import { buildActivityStream } from '@/server/activity/build-stream';

type MilestoneItem = {
  kind: string;
  id: string;
  questions: Array<{ questionId: string; priorResult: 'correct' | 'incorrect' | null }>;
};

beforeEach(() => {
  vi.clearAllMocks();
  getViewerHiddenQuestionIdsMock.mockResolvedValue(new Set<string>());
  getViewerPriorAnswerResultsMock.mockResolvedValue(new Map());
});

describe('buildActivityStream — durable inappropriate self-hide', () => {
  it('drops a milestone question the viewer reported as inappropriate', async () => {
    getViewerHiddenQuestionIdsMock.mockResolvedValue(new Set(['q-hidden']));

    const stream = (await buildActivityStream('viewer-1')) as unknown as MilestoneItem[];
    const milestone = stream.find((item) => item.kind === 'milestone');

    const ids = milestone!.questions.map((q) => q.questionId);
    expect(ids).toContain('q-keep');
    expect(ids).not.toContain('q-hidden');
  });

  it('keeps every question when the viewer has hidden nothing', async () => {
    const stream = (await buildActivityStream('viewer-1')) as unknown as MilestoneItem[];
    const milestone = stream.find((item) => item.kind === 'milestone');

    expect(milestone!.questions.map((q) => q.questionId)).toEqual(['q-keep', 'q-hidden']);
  });

  it('keeps an already-answered question in the bundle, carrying its prior result', async () => {
    // The viewer answered q-keep correctly on some earlier surface. It must stay
    // in the bundle (as a spent/hollow triangle), not vanish — and the title
    // stays stable because the question count doesn't shrink.
    getViewerPriorAnswerResultsMock.mockResolvedValue(new Map([['q-keep', 'correct']]));

    const stream = (await buildActivityStream('viewer-1')) as unknown as MilestoneItem[];
    const milestone = stream.find((item) => item.kind === 'milestone');

    expect(milestone!.questions.map((q) => q.questionId)).toEqual(['q-keep', 'q-hidden']);
    expect(milestone!.questions.find((q) => q.questionId === 'q-keep')!.priorResult).toBe('correct');
    expect(milestone!.questions.find((q) => q.questionId === 'q-hidden')!.priorResult).toBeNull();
  });
});
