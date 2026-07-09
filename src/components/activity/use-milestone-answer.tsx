'use client';

import { useState, type ReactNode } from 'react';

import { AnswerFeedbackSheet } from '@/components/feed/AnswerFeedbackSheet';
import { AnswerSheet } from '@/components/feed/AnswerSheet';
import type { StreamQuestion } from '@/lib/activity-stream';
import {
  ANSWER_GRADER_RETRY_MESSAGE,
  submitAnswerWithRetry,
} from '@/lib/answer-submit';
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

// The milestone answer route's success payload (Feedback minus the mastery
// fields the client derives, plus the raw masteryDelta it derives them from).
type MilestoneAnswerResponse = Omit<
  Feedback,
  'openedNewTerritory' | 'openedTerritoryDomain'
> & {
  masteryDelta?: { openedNewTerritory?: boolean; domain?: string | null };
};

// A warm in-sheet note while an outage is being auto-retried (tone 'info'), or a
// terminal reason once retries are spent / a request fails deterministically
// (tone 'error'). Surfaced through AnswerSheet's status/error slots.
type AnswerNotice = { tone: 'info' | 'error'; text: string };

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
  const [notice, setNotice] = useState<AnswerNotice | null>(null);

  async function submit(answer: string) {
    setLoading(true);
    setNotice(null);
    try {
      // A grader outage returns a retryable 503 (never a real 'wrong' verdict),
      // so auto-retry it with backoff behind a warm in-sheet note, and only ask
      // the player to try again later once the retries are spent. Without this,
      // any 503/404/500 flipped the button silently back to "Answer" with no
      // explanation (the swallowed-error bug this replaces).
      const body = await submitAnswerWithRetry<MilestoneAnswerResponse>(
        '/api/lately/milestone/answer',
        {
          body: { questionId: question.questionId, submitted_answer: answer },
          isSuccessBody: (value): value is MilestoneAnswerResponse =>
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
          ? (body.masteryDelta?.domain ?? null)
          : null,
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
