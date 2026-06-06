'use client';

import { useState } from 'react';

import { AnswerFeedbackSheet } from '@/components/feed/AnswerFeedbackSheet';
import { AnswerSheet } from '@/components/feed/AnswerSheet';
import type { StreamAction } from '@/lib/activity-stream';
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
  openedNewTerritory: boolean;
  openedTerritoryDomain: string | null;
};

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

  async function submit(answer: string) {
    setLoading(true);
    try {
      const res = await fetch(`/api/feed/${action.feedItemId}/answer`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ submitted_answer: answer }),
      });
      const body = (await res.json().catch(() => null)) as
        | (Omit<Feedback, 'openedNewTerritory' | 'openedTerritoryDomain'> & {
            masteryDelta?: { openedNewTerritory?: boolean; domain?: string | null };
          })
        | null;
      if (!res.ok || !body) throw new Error('Could not score that answer.');
      setSubmitted(answer);
      setFeedback({
        isCorrect: body.isCorrect,
        pointsAwarded: body.pointsAwarded,
        correctAnswer: body.correctAnswer,
        explanation: body.explanation,
        creatorNote: body.creatorNote,
        insideJoke: body.insideJoke,
        insideJokeKind: body.insideJokeKind,
        openedNewTerritory: Boolean(body.masteryDelta?.openedNewTerritory),
        openedTerritoryDomain: body.masteryDelta?.openedNewTerritory
          ? body.masteryDelta?.domain ?? null
          : null,
      });
      setPhase('result');
    } catch {
      // Leave the input sheet open so the viewer can retry.
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
          color: '#fcf8f2',
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
          onSubmit={(answer) => void submit(answer)}
          onClose={() => setPhase('closed')}
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
          openedNewTerritory={feedback.openedNewTerritory}
          openedTerritoryDomain={feedback.openedTerritoryDomain}
          questionId={action.questionId}
          feedItemId={action.feedItemId}
          onClose={finish}
        />
      ) : null}
    </>
  );
}
