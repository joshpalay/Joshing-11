'use client';

import { useCallback, useState, type ReactNode } from 'react';

import {
  AnsweredByYouCard,
  AnswerSheet,
  DirectSentCard,
  type AnsweredByYouFeedItem,
  type DirectSentFeedItem,
} from '@/components/feed';

export type AuthoredQuestionItem = {
  id: string;
  questionText: string;
  category: string | null;
  createdAt: string;
  viewerAnswered: { result: 'correct' | 'incorrect' } | null;
};

type AnswerResult = {
  isCorrect: boolean;
  correctAnswer: string;
  explanation: string | null;
  awardedPoints: number | null;
  creatorNote: string | null;
  submittedAnswer: string;
};

type AuthoredQuestionsFeedProps = {
  questions: AuthoredQuestionItem[];
  friendDisplayName: string;
  friendUserId: string;
  friendProfileHref: string;
};

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const now = new Date();
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: date.getFullYear() === now.getFullYear() ? undefined : 'numeric',
  }).format(date);
}

function baseFields(
  item: AuthoredQuestionItem,
  answered: boolean,
  friendDisplayName: string,
  friendUserId: string,
) {
  const dateLabel = formatDate(item.createdAt);
  const metadata: ReactNode = (
    <span className="text-muted-foreground text-xs">
      {item.category ? <>{item.category}</> : null}
      {item.category && dateLabel ? <> · </> : null}
      {dateLabel ? <>{dateLabel}</> : null}
      {answered ? <> · You answered</> : null}
    </span>
  );

  return {
    id: item.id,
    metadata,
    category: item.category,
    question: item.questionText,
    personalMessage: null,
    isInBank: false,
    avatarName: friendDisplayName,
    avatarUserId: friendUserId,
  };
}

export function AuthoredQuestionsFeed({
  questions,
  friendDisplayName,
  friendUserId,
  friendProfileHref,
}: AuthoredQuestionsFeedProps) {
  const [results, setResults] = useState<Record<string, AnswerResult>>({});
  const [answerSheetId, setAnswerSheetId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submitAnswer = useCallback(async (item: AuthoredQuestionItem, submittedAnswer: string) => {
    setBusyId(item.id);
    setError(null);
    try {
      const response = await fetch(`/api/questions/${item.id}/answer`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ submitted_answer: submittedAnswer }),
      });
      const body = (await response.json().catch(() => null)) as {
        isCorrect?: boolean;
        correctAnswer?: string;
        explanation?: string | null;
        pointsAwarded?: number | null;
        creatorNote?: string | null;
        message?: string;
      } | null;
      if (!response.ok || !body || typeof body.isCorrect !== 'boolean') {
        throw new Error(body?.message ?? 'Could not submit that answer.');
      }
      const result: AnswerResult = {
        isCorrect: body.isCorrect,
        correctAnswer: body.correctAnswer ?? '',
        explanation: body.explanation ?? null,
        awardedPoints: body.pointsAwarded ?? null,
        creatorNote: body.creatorNote ?? null,
        submittedAnswer,
      };
      setResults((current) => ({ ...current, [item.id]: result }));
      setAnswerSheetId(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not submit that answer.');
    } finally {
      setBusyId(null);
    }
  }, []);

  const sheetItem = answerSheetId ? (questions.find((q) => q.id === answerSheetId) ?? null) : null;

  return (
    <section className="mt-5" aria-label={`Questions ${friendDisplayName} wrote`}>
      <div className="mb-4">
        <p className="text-muted-foreground text-xs font-medium tracking-[0.1em] uppercase">
          Questions
        </p>
        <h2 className="mt-1 font-serif text-xl font-semibold">
          Questions {friendDisplayName} wrote
        </h2>
      </div>

      {error ? (
        <p className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      {questions.length === 0 ? (
        <p className="text-muted-foreground bg-muted rounded-xl px-3 py-2 text-sm">
          {friendDisplayName} hasn&rsquo;t written any questions yet.
        </p>
      ) : (
        <div className="space-y-3">
          {questions.map((item) => {
            const localResult = results[item.id];
            const persistedAnswered = item.viewerAnswered !== null;
            const isAnswered = Boolean(localResult) || persistedAnswered;

            if (isAnswered) {
              const isCorrect = localResult
                ? localResult.isCorrect
                : item.viewerAnswered?.result === 'correct';

              const answeredItem: AnsweredByYouFeedItem = {
                ...baseFields(item, true, friendDisplayName, friendUserId),
                avatarName: null,
                avatarUserId: null,
                type: 'answered_by_you',
                resultLabel: isCorrect ? 'You answered' : 'Reviewed privately',
                answerSummary: isCorrect
                  ? `You and ${friendDisplayName} have that in common.`
                  : 'You have already answered this question.',
                correctAnswer: localResult?.correctAnswer ?? null,
                submittedAnswer: localResult?.submittedAnswer ?? undefined,
                isCorrect,
                awardedPoints: localResult?.awardedPoints ?? null,
                explanation: localResult?.explanation ?? null,
                creatorNote: localResult?.creatorNote ?? null,
                unverifiedAnswer: false,
              };

              return <AnsweredByYouCard key={item.id} item={answeredItem} />;
            }

            const directSent: DirectSentFeedItem = {
              ...baseFields(item, false, friendDisplayName, friendUserId),
              type: 'direct_sent',
              senderName: friendDisplayName,
              senderHref: friendProfileHref,
            };

            return (
              <DirectSentCard
                key={item.id}
                item={directSent}
                onAnswer={() => setAnswerSheetId(item.id)}
              />
            );
          })}
        </div>
      )}

      {sheetItem ? (
        <AnswerSheet
          question={sheetItem.questionText}
          category={sheetItem.category}
          onSubmit={(answer) => void submitAnswer(sheetItem, answer)}
          onClose={() => setAnswerSheetId(null)}
          loading={busyId === sheetItem.id}
        />
      ) : null}
    </section>
  );
}
