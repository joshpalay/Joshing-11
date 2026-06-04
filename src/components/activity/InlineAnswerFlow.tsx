'use client';

import { useState } from 'react';

import { AnswerFeedbackSheet } from '@/components/feed/AnswerFeedbackSheet';
import { AnswerSheet } from '@/components/feed/AnswerSheet';
import type { AnswerStatus, StreamQuestion } from '@/lib/activity-stream';
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

// Colors borrowed from the answer-result palette so the inline badges read in
// the same register as the feedback sheet (forest green = correct, terracotta =
// missed).
const CORRECT = 'var(--game-correct)';
const WRONG = 'var(--game-wrong-strong)';

// D-4 CORRECTION 2: one milestone question, answered IN PLACE via the existing
// feed answer pop-ups (AnswerSheet -> AnswerFeedbackSheet). Full credit is
// written by /api/lately/milestone/answer; this component only drives the UI and
// reports the GRADED result up so the milestone can track "{k} of {n} answered"
// AND lock a missed question — one shot, no re-answer.
export function InlineAnswerFlow({
  question,
  status,
  onResult,
}: {
  question: StreamQuestion;
  status: AnswerStatus;
  onResult: (questionId: string, result: 'correct' | 'incorrect') => void;
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
        | { error: string; result?: 'correct' | 'incorrect' }
        | null;
      // A 409 means the viewer already answered this question (a question is
      // one-shot once attempted). Lock it to whatever the prior result was
      // instead of inviting a retry.
      if (res.status === 409 && body && 'result' in body && body.result) {
        onResult(question.questionId, body.result === 'correct' ? 'correct' : 'incorrect');
        setPhase('closed');
        return;
      }
      if (!res.ok || !body || !('isCorrect' in body)) throw new Error('Could not score that answer.');
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
      // Report the graded result up so the parent can tick progress (correct)
      // and LOCK the question (correct or incorrect) — a missed milestone
      // question can't be answered again.
      onResult(question.questionId, body.isCorrect ? 'correct' : 'incorrect');
    } catch {
      // Leave the input sheet open so the viewer can retry a transient error
      // (network/parse) — a real grade always resolves to correct/incorrect above.
    } finally {
      setLoading(false);
    }
  }

  const locked = status !== 'unanswered';

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
          color: locked ? INK3 : INK2,
        }}
      >
        &ldquo;{question.text}&rdquo;
      </p>

      {status === 'correct' ? (
        <span
          style={{
            flexShrink: 0,
            fontFamily: FM,
            fontSize: 10,
            letterSpacing: 1.5,
            color: CORRECT,
          }}
        >
          ✓ CORRECT
        </span>
      ) : status === 'incorrect' ? (
        // Missed: locked, no re-answer. Distinct terracotta badge so a wrong
        // attempt reads differently from a correct one at a glance.
        <span
          style={{
            flexShrink: 0,
            fontFamily: FM,
            fontSize: 10,
            letterSpacing: 1.5,
            color: WRONG,
          }}
        >
          ✕ MISSED
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
