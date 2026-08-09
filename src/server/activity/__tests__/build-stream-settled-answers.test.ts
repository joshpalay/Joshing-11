import { beforeEach, describe, expect, it, vi } from 'vitest';

// The settled-card answer read-back (2026-08-06). A From Friends bundle carries
// SETTLED and STILL-ANSWERABLE questions in one payload, so the guard that
// matters is which of them get a `correctAnswer` attached: shipping one for a
// question the viewer still has a swing at would hand over the answer before
// they play it. build-stream narrows to `priorResult !== null` before the
// lookup; these tests pin that narrowing at the boundary, and assert the
// lookup is never even ASKED about an answerable id.

const {
  getViewerPriorAnswerResultsMock,
  getCorrectAnswersForSettledQuestionsMock,
  getFriendActivityMock,
} = vi.hoisted(() => ({
  getViewerPriorAnswerResultsMock: vi.fn(async () => new Map<string, 'correct' | 'incorrect'>()),
  getCorrectAnswersForSettledQuestionsMock: vi.fn(async (_ids: string[]) => new Map<string, string>()),
  getFriendActivityMock: vi.fn(async () => [{ id: 'm1', questionIds: ['settled', 'fresh'] }]),
}));

vi.mock('@/app/activities/filter-utility-activities', () => ({
  filterUtilityActivities: () => [],
}));
vi.mock('@/lib/activity-stream', () => ({
  activityToStreamItem: (x: unknown) => x,
  momentToStreamItem: (x: unknown) => x,
  bundleAnswerToStreamItem: (x: unknown) => x,
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
  getBundleAnswerMoments: vi.fn(async () => []),
  getLatelyConvergences: vi.fn(async () => []),
  getFriendActivity: getFriendActivityMock,
  getMilestoneQuestionText: vi.fn(async (ids: string[]) =>
    new Map(ids.map((id) => [id, { questionId: id, text: `text ${id}`, domain: 'history' }])),
  ),
  getViewerPriorAnswerResults: getViewerPriorAnswerResultsMock,
  getCorrectAnswersForSettledQuestions: getCorrectAnswersForSettledQuestionsMock,
  getViewerDismissedMilestoneIds: vi.fn(async () => new Set<string>()),
}));

import { buildActivityStream } from '@/server/activity/build-stream';

type MilestoneItem = {
  kind: string;
  id: string;
  questions: Array<{ questionId: string; priorResult: string | null; correctAnswer?: string | null }>;
};

async function questions(): Promise<MilestoneItem['questions']> {
  const stream = (await buildActivityStream('viewer-1')) as unknown as MilestoneItem[];
  const milestone = stream.find((i) => i.kind === 'milestone');
  return milestone?.questions ?? [];
}

beforeEach(() => {
  getCorrectAnswersForSettledQuestionsMock.mockClear();
  getCorrectAnswersForSettledQuestionsMock.mockResolvedValue(new Map());
  // One played question, one still answerable — the mixed bundle the guard exists for.
  getViewerPriorAnswerResultsMock.mockResolvedValue(new Map([['settled', 'incorrect']]));
});

describe('build-stream — settled-answer read-back', () => {
  it('asks for the answer to the settled question only', async () => {
    await questions();
    const askedFor = getCorrectAnswersForSettledQuestionsMock.mock.calls[0]?.[0] ?? [];
    expect(askedFor).toContain('settled');
    // The narrowing happens BEFORE the query, so an answerable id is never even
    // sent — the answer to it is not fetched, let alone serialized.
    expect(askedFor).not.toContain('fresh');
  });

  it('attaches the answer to the settled question', async () => {
    getCorrectAnswersForSettledQuestionsMock.mockResolvedValue(new Map([['settled', 'Red']]));
    const qs = await questions();
    expect(qs.find((q) => q.questionId === 'settled')?.correctAnswer).toBe('Red');
  });

  it('leaves an answerable question with no answer even if the lookup returns one', async () => {
    // Defence in depth: if the map ever came back wider than the ids we asked
    // about, the still-answerable card must still not carry an answer.
    getCorrectAnswersForSettledQuestionsMock.mockResolvedValue(
      new Map([
        ['settled', 'Red'],
        ['fresh', 'LEAKED'],
      ]),
    );
    const qs = await questions();
    const fresh = qs.find((q) => q.questionId === 'fresh');
    expect(fresh?.priorResult).toBeNull();
    expect(fresh?.correctAnswer).not.toBe('LEAKED');
  });

  it('nulls the answer when the question has none on file', async () => {
    const qs = await questions();
    expect(qs.find((q) => q.questionId === 'settled')?.correctAnswer).toBeNull();
  });
});
