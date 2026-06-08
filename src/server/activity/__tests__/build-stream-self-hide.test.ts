import { beforeEach, describe, expect, it, vi } from 'vitest';

// B-Report-3 durable self-hide: a question the viewer reported as inappropriate
// (open|upheld) must stay out of their Lately milestone stack across reloads. We
// mock the upstream lately queries and the pure transforms (echoing the questions
// they receive) so we can assert the hidden id is filtered before render.
const { getViewerHiddenQuestionIdsMock } = vi.hoisted(() => ({
  getViewerHiddenQuestionIdsMock: vi.fn(async () => new Set<string>()),
}));

vi.mock('@/app/activities/filter-utility-activities', () => ({
  filterUtilityActivities: () => [],
}));
vi.mock('@/lib/activity-stream', () => ({
  activityToStreamItem: (x: unknown) => x,
  momentToStreamItem: (x: unknown) => x,
  convergenceToStreamItem: (_c: unknown, questions: unknown) => ({ kind: 'convergence', questions }),
  milestoneToStreamItem: (m: { id: string }, questions: unknown) => ({ kind: 'milestone', id: m.id, questions }),
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
  getLatelyConvergences: vi.fn(async () => []),
  getLatelyMilestones: vi.fn(async () => [{ id: 'm1', questionIds: ['q-keep', 'q-hidden'] }]),
  getMilestoneQuestionText: vi.fn(async (ids: string[]) =>
    new Map(ids.map((id) => [id, { questionId: id, text: `text ${id}`, domain: 'history' }])),
  ),
  getViewerPriorAnswerResults: vi.fn(async () => new Map()),
}));

import { buildActivityStream } from '@/server/activity/build-stream';

type MilestoneItem = { kind: string; id: string; questions: Array<{ questionId: string }> };

beforeEach(() => {
  vi.clearAllMocks();
  getViewerHiddenQuestionIdsMock.mockResolvedValue(new Set<string>());
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
});
