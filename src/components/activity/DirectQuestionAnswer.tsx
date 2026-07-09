'use client';

import { useState } from 'react';

import { AnswerFeedbackSheet } from '@/components/feed/AnswerFeedbackSheet';
import { AnswerSheet } from '@/components/feed/AnswerSheet';
import type { StreamAction } from '@/lib/activity-stream';
import {
  ANSWER_GRADER_RETRY_MESSAGE,
  submitAnswerWithRetry,
} from '@/lib/answer-submit';
import type { InsideJokeKind } from '@/lib/questions-types';

import { FM, INK, INK3 } from '@/components/lately/tokens';

type Feedback = {
  isCorrect: boolean;
  pointsAwarded: number | null;
  correctAnswer: string;
  explanation: string | null;
  creatorNote: string | null;
  insideJoke: string | null;
  insideJokeKind: InsideJokeKind | null;
  authorName: string | null;
  authorIsHouse: boolean;
  openedNewTerritory: boolean;
  openedTerritoryDomain: string | null;
  unverified: boolean;
};

// The feed answer route's success payload (Feedback minus the mastery fields the
// client derives, plus the raw masteryDelta + unverified flag it reads them from).
type DirectAnswerResponse = Omit<
  Feedback,
  'openedNewTerritory' | 'openedTerritoryDomain' | 'unverified'
> & {
  masteryDelta?: { openedNewTerritory?: boolean; domain?: string | null };
  unverified?: boolean;
};

// A warm in-sheet note while an outage is being auto-retried (tone 'info'), or a
// terminal reason once retries are spent / a request fails deterministically
// (tone 'error'). Surfaced through AnswerSheet's status/error slots.
type AnswerNotice = { tone: 'info' | 'error'; text: string };

// The "ANSWER →" action on a "{friend} sent you a question" stream row. A direct
// send is backed by a feed item, so this answers in place against
// /api/feed/{feedItemId}/answer — the same endpoint the home feed uses — and
// then shows the standard result sheet. A wrong answer keeps the button live so
// the recipient can take another swing (the route allows retry on direct sends);
// a correct one retires the button to a quiet "Answered" note for the session.
export function DirectQuestionAnswer({
  action,
}: {
  action: Extract<StreamAction, { kind: 'answer_direct' }>;
}) {
  const [phase, setPhase] = useState<'closed' | 'input' | 'result'>('closed');
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState('');
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [answeredCorrectly, setAnsweredCorrectly] = useState(false);
  const [notice, setNotice] = useState<AnswerNotice | null>(null);

  async function submit(answer: string) {
    setLoading(true);
    setNotice(null);
    try {
      // A grader outage returns a retryable 503 (never a real 'wrong' verdict),
      // so auto-retry it with backoff behind a warm in-sheet note, and only ask
      // the viewer to try again later once the retries are spent. Without this,
      // any 503/404/500 flipped the button silently back to "Answer" with no
      // explanation (the swallowed-error bug this replaces).
      const body = await submitAnswerWithRetry<DirectAnswerResponse>(
        `/api/feed/${action.feedItemId}/answer`,
        {
          body: { submitted_answer: answer },
          isSuccessBody: (value): value is DirectAnswerResponse =>
            value != null && typeof value === 'object' && 'isCorrect' in value,
          onRetry: ({ attempt, maxAttempts }) =>
            setNotice({
              tone: 'info',
              text: `${ANSWER_GRADER_RETRY_MESSAGE} (${attempt}/${maxAttempts})…`,
            }),
        },
      );
      setSubmitted(answer);
      setFeedback({
        isCorrect: body.isCorrect,
        pointsAwarded: body.pointsAwarded,
        correctAnswer: body.correctAnswer,
        explanation: body.explanation,
        creatorNote: body.creatorNote,
        insideJoke: body.insideJoke,
        insideJokeKind: body.insideJokeKind,
        authorName: body.authorName,
        authorIsHouse: body.authorIsHouse,
        openedNewTerritory: Boolean(body.masteryDelta?.openedNewTerritory),
        openedTerritoryDomain: body.masteryDelta?.openedNewTerritory
          ? body.masteryDelta?.domain ?? null
          : null,
        unverified: Boolean(body.unverified),
      });
      setNotice(null);
      setPhase('result');
    } catch (caught) {
      // Leave the input sheet open with the answer intact, but tell the viewer
      // why it didn't go through instead of silently reverting the button.
      setNotice({
        tone: 'error',
        text: caught instanceof Error ? caught.message : 'Could not score that answer.',
      });
    } finally {
      setLoading(false);
    }
  }

  // Once the result sheet is dismissed, a correct answer retires the button; a
  // wrong one returns the row to its idle "ANSWER →" state so they can try again.
  function finish() {
    setPhase('closed');
    if (feedback?.isCorrect) setAnsweredCorrectly(true);
  }

  if (answeredCorrectly) {
    return (
      <span style={{ fontFamily: FM, fontSize: 10, letterSpacing: 2, color: INK3 }}>ANSWERED</span>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setPhase('input')}
        style={{
          display: 'inline-block',
          background: INK,
          color: 'var(--brand-cream-page)',
          border: 'none',
          fontFamily: FM,
          fontSize: 10,
          letterSpacing: 2,
          padding: '8px 12px',
          cursor: 'pointer',
        }}
      >
        ANSWER →
      </button>

      {phase === 'input' ? (
        <AnswerSheet
          question={action.questionText}
          category={action.domain}
          loading={loading}
          statusMessage={notice?.tone === 'info' ? notice.text : null}
          errorMessage={notice?.tone === 'error' ? notice.text : null}
          onSubmit={(answer) => void submit(answer)}
          onClose={() => {
            setPhase('closed');
            setNotice(null);
          }}
        />
      ) : null}

      {phase === 'result' && feedback ? (
        <AnswerFeedbackSheet
          question={action.questionText}
          category={action.domain}
          isCorrect={feedback.isCorrect}
          pointsAwarded={feedback.pointsAwarded}
          correctAnswer={feedback.correctAnswer}
          submittedAnswer={submitted}
          explanation={feedback.explanation}
          creatorNote={feedback.creatorNote}
          insideJoke={feedback.insideJoke}
          insideJokeKind={feedback.insideJokeKind}
          authorName={feedback.authorName}
          authorIsHouse={feedback.authorIsHouse}
          openedNewTerritory={feedback.openedNewTerritory}
          openedTerritoryDomain={feedback.openedTerritoryDomain}
          questionId={action.questionId}
          feedItemId={action.feedItemId}
          unverified={feedback.unverified}
          onClose={finish}
        />
      ) : null}
    </>
  );
}
