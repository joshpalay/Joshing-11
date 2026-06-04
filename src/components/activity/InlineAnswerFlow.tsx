'use client';

import { useState } from 'react';

import { AnswerFeedbackSheet } from '@/components/feed/AnswerFeedbackSheet';
import { AnswerSheet } from '@/components/feed/AnswerSheet';
import type { StreamQuestion } from '@/lib/activity-stream';
import type { InsideJokeKind } from '@/lib/questions-types';

import { FM, INK, INK2, INK3 } from '@/components/lately/tokens';

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

// D-4 CORRECTION 2: one milestone question, answered IN PLACE via the existing
// feed answer pop-ups (AnswerSheet -> AnswerFeedbackSheet). Full credit is
// written by /api/lately/milestone/answer; this component only drives the UI and
// reports a correct answer up so the milestone can track "{k} of {n} answered".
export function InlineAnswerFlow({
  question,
  answered,
  onAnswered,
}: {
  question: StreamQuestion;
  answered: boolean;
  onAnswered: (questionId: string) => void;
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
      if (body.isCorrect) onAnswered(question.questionId);
    } catch {
      // Leave the input sheet open so the viewer can retry.
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
      <p
        style={{
          flex: 1,
          minWidth: 0,
          margin: 0,
          fontFamily: 'Georgia, serif',
          fontStyle: 'italic',
          fontSize: 14,
          lineHeight: 1.5,
          color: answered ? INK3 : INK2,
        }}
      >
        &ldquo;{question.text}&rdquo;
      </p>

      {answered ? (
        <span
          style={{
            flexShrink: 0,
            fontFamily: FM,
            fontSize: 10,
            letterSpacing: 1.5,
            color: INK3,
          }}
        >
          ✓ ANSWERED
        </span>
      ) : (
        <button
          type="button"
          onClick={() => setPhase('input')}
          style={{
            flexShrink: 0,
            background: 'transparent',
            border: `1.5px solid ${INK}`,
            color: INK,
            fontFamily: FM,
            fontSize: 10,
            letterSpacing: 2,
            padding: '6px 12px',
            cursor: 'pointer',
          }}
        >
          ANSWER →
        </button>
      )}

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
          onClose={() => setPhase('closed')}
        />
      ) : null}
    </div>
  );
}
