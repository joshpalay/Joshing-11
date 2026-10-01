import { describe, expect, it, vi } from 'vitest';

// The read-only reveals (your-question, niche-match, convergence) show the
// answer and the send-onward plane ONLY for questions the viewer knows —
// answered (right or wrong) or wrote. build-stream asks getAnswersKnownToViewer
// (which does that narrowing) and attaches the result; anything it doesn't
// return is nulled, which is what hides the plane on an unplayed question.

const getAnswersKnownToViewerMock = vi.hoisted(() =>
  vi.fn(async (_userId: string, _ids: string[]) => new Map([['known', 'Ophelia']])),
);

vi.mock('@/server/db/queries/activity', () => ({ getActivitiesForUser: vi.fn(async () => []) }));
vi.mock('@/server/db/queries/user-blocks', () => ({
  blockedIdsAmong: vi.fn(async () => new Set<string>()),
}));
vi.mock('@/server/db/queries/content-reports', () => ({
  getViewerHiddenQuestionIds: vi.fn(async () => new Set<string>()),
}));
vi.mock('@/server/db/queries/lately', () => ({
  getLatelyMoments: vi.fn(async () => [
    {
      momentId: 'mo-known',
      dir: 'they_got_you',
      questionId: 'known',
      questionText: 'Who drowns in Hamlet?',
      category: 'Hamlet',
      friendId: 'f1',
      friendName: 'Robyn',
      answeredAt: new Date('2026-09-30T12:00:00Z'),
    },
    {
      momentId: 'mo-unknown',
      dir: 'they_got_you',
      questionId: 'unknown',
      questionText: 'Who is Yorick?',
      category: 'Hamlet',
      friendId: 'f1',
      friendName: 'Robyn',
      answeredAt: new Date('2026-09-30T11:00:00Z'),
    },
  ]),
  getBundleAnswerMoments: vi.fn(async () => []),
  getLatelyConvergences: vi.fn(async () => []),
  getFriendActivity: vi.fn(async () => []),
  getMilestoneQuestionText: vi.fn(async () => new Map()),
  getViewerPriorAnswerResults: vi.fn(async () => new Map()),
  getCorrectAnswersForSettledQuestions: vi.fn(async () => new Map()),
  getAnswersKnownToViewer: getAnswersKnownToViewerMock,
  getViewerDismissedMilestoneIds: vi.fn(async () => new Set<string>()),
}));

import { buildActivityStream } from '@/server/activity/build-stream';

describe('build-stream — answers on the read-only reveals', () => {
  it('attaches the answer to a known question and nulls an unknown one', async () => {
    const stream = await buildActivityStream('viewer-1');
    const answerFor = (questionId: string) => {
      const item = stream.find(
        (i) => i.expand?.kind === 'your_question' && i.expand.question.questionId === questionId,
      );
      return item?.expand?.kind === 'your_question' ? item.expand.question.correctAnswer : undefined;
    };
    expect(getAnswersKnownToViewerMock).toHaveBeenCalledWith('viewer-1', ['known', 'unknown']);
    expect(answerFor('known')).toBe('Ophelia');
    expect(answerFor('unknown')).toBeNull();
  });
});
