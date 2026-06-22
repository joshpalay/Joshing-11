'use client';

import { useState, type ReactNode } from 'react';

import { AnswerFeedbackSheet } from '@/components/feed/AnswerFeedbackSheet';
import { AnswerSheet } from '@/components/feed/AnswerSheet';
import type { StreamQuestion } from '@/lib/activity-stream';
import type { InsideJokeKind } from '@/lib/questions-types';

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
};

// The milestone answer/grade flow, lifted out of InlineAnswerFlow so the From
// Friends streak cards (B-FROMFRIENDS-STREAK-HEADER-01) and the inline list row
// share ONE implementation rather than re-deriving the fetch + sheet wiring.
// Behavior is unchanged from the original InlineAnswerFlow: answers post to
// /api/lately/milestone/answer, the result is reported up only AFTER the
// feedback pop-up closes (so the parent can retire the question), and a wrong
// answer can be rechecked through /api/lately/milestone/recheck.
//
// The consumer owns the trigger (an "ANSWER →" link, a card's Answer button)
// and just calls `open()`; `sheets` is the conditionally-rendered AnswerSheet /
// AnswerFeedbackSheet pair to drop into the tree.
export function useMilestoneAnswer(
  question: StreamQuestion,
  onResolved: (questionId: string, submitted: string, isCorrect: boolean) => void,
): { open: () => void; isOpen: boolean; sheets: ReactNode } {
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
        authorName: body.authorName,
        authorIsHouse: body.authorIsHouse,
        openedNewTerritory: Boolean(body.masteryDelta?.openedNewTerritory),
        openedTerritoryDomain: body.masteryDelta?.openedNewTerritory
          ? (body.masteryDelta?.domain ?? null)
          : null,
      });
      setPhase('result');
    } catch {
      // Leave the input sheet open so the viewer can retry.
    } finally {
      setLoading(false);
    }
  }

  // Recheck (dispute the grade) on a wrong milestone answer: re-grade through the
  // milestone recheck route (anchored on the synthetic catch-up FeedItem the
  // answer route wrote). On accept, reflect the win locally so the sheet flips to
  // "Correct!" and finish() retires the question as correct.
  async function submitRecheck(): Promise<{ accepted: boolean; message: string }> {
    const res = await fetch('/api/lately/milestone/recheck', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ questionId: question.questionId }),
    });
    const body = (await res.json().catch(() => null)) as {
      accepted?: boolean;
      status?: string;
      reason?: string;
      pointsAwarded?: number;
      message?: string;
    } | null;
    if (!res.ok) throw new Error(body?.message ?? 'Could not recheck that answer.');
    const accepted = Boolean(body?.accepted);
    const points = typeof body?.pointsAwarded === 'number' ? body.pointsAwarded : 0;
    if (accepted) {
      setFeedback((current) =>
        current ? { ...current, isCorrect: true, pointsAwarded: points } : current,
      );
      return {
        accepted: true,
        message: `Recheck accepted — +${points} ${points === 1 ? 'point' : 'points'}.`,
      };
    }
    if (body?.status === 'needs_human') {
      return { accepted: false, message: body.reason ?? 'Flagged for a human look.' };
    }
    return { accepted: false, message: body?.reason ?? 'Rechecked and still marked wrong.' };
  }

  // Hand the resolution up only once the viewer dismisses the result pop-up, so
  // the sheet stays visible through the reveal, then the parent moves the
  // question into its answered/spent state.
  function finish() {
    setPhase('closed');
    if (feedback) onResolved(question.questionId, submitted, feedback.isCorrect);
  }

  const sheets = (
    <>
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
          authorName={feedback.authorName}
          authorIsHouse={feedback.authorIsHouse}
          openedNewTerritory={feedback.openedNewTerritory}
          openedTerritoryDomain={feedback.openedTerritoryDomain}
          questionId={question.questionId}
          feedItemId={`milestone:${question.questionId}`}
          report={{ target: { questionId: question.questionId }, surface: 'lately_result' }}
          onRecheck={feedback.isCorrect ? null : submitRecheck}
          onClose={finish}
        />
      ) : null}
    </>
  );

  return { open: () => setPhase('input'), isOpen: phase !== 'closed', sheets };
}
