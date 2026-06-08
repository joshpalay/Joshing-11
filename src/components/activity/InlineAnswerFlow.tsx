'use client';

import { useState } from 'react';

import { AnswerFeedbackSheet } from '@/components/feed/AnswerFeedbackSheet';
import { AnswerSheet } from '@/components/feed/AnswerSheet';
import type { StreamQuestion } from '@/lib/activity-stream';
import type { InsideJokeKind } from '@/lib/questions-types';

import { FM, INK, INK2 } from '@/components/lately/tokens';

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

// D-4 CORRECTION 2 (revised): this drives a single still-unanswered milestone
// question. The opened milestone stacks one of these per unanswered question, so
// the viewer can play any of them; each reads as live and playable (upright navy
// serif, slightly larger, behind a thin left rule) with an inline text action,
// not a boxed button. The result is reported up only AFTER the feedback pop-up
// closes, so the parent can retire this question into the quiet "Answered"
// history (carrying the submitted answer + correctness) and the stack above
// shrinks to just the questions still left to play.
export function InlineAnswerFlow({
  question,
  onResolved,
}: {
  question: StreamQuestion;
  onResolved: (questionId: string, submitted: string, isCorrect: boolean) => void;
}) {
  const [phase, setPhase] = useState<'closed' | 'input' | 'result'>('closed');
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState('');
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  async function submit(answer: string) {
    setLoading(true);
    try {
      const res = await fetch('/api/lately/milestone/answer', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ questionId: question.questionId, submitted_answer: answer }),
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

  // Hand the resolution up only once the viewer dismisses the result pop-up, so
  // this block stays mounted (and the sheet visible) through the reveal, then
  // the parent moves the question into the answered history.
  function finish() {
    setPhase('closed');
    if (feedback) onResolved(question.questionId, submitted, feedback.isCorrect);
  }

  return (
    <div
      style={{
        borderLeft: `2px solid ${INK2}`,
        paddingLeft: 14,
      }}
    >
      <p
        style={{
          margin: 0,
          paddingRight: 24,
          fontFamily: 'Georgia, serif',
          fontSize: 17,
          lineHeight: 1.5,
          color: INK,
        }}
      >
        &ldquo;{question.text}&rdquo;
      </p>

      <button
        type="button"
        onClick={() => setPhase('input')}
        style={{
          marginTop: 10,
          display: 'inline-flex',
          alignItems: 'center',
          background: 'transparent',
          border: 'none',
          borderBottom: `1px solid ${INK}`,
          color: INK,
          fontFamily: FM,
          fontSize: 11,
          letterSpacing: 1.5,
          padding: '0 0 2px',
          cursor: 'pointer',
        }}
      >
        ANSWER THIS ONE →
      </button>

      {phase === 'input' ? (
        <AnswerSheet
          question={question.text}
          category={question.domain}
          loading={loading}
          onSubmit={(answer) => void submit(answer)}
          onClose={() => setPhase('closed')}
        />
      ) : null}

      {phase === 'result' && feedback ? (
        <AnswerFeedbackSheet
          question={question.text}
          category={question.domain}
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
          questionId={question.questionId}
          feedItemId={`milestone:${question.questionId}`}
          report={{ target: { questionId: question.questionId }, surface: 'lately_result' }}
          onClose={finish}
        />
      ) : null}
    </div>
  );
}
