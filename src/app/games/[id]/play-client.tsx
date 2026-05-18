'use client';

import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { useRouter } from 'next/navigation';

import { GameplayChatThread, type ChatMessage } from '@/components/play/GameplayChat';

async function fetchJoshingGameBreadcrumb(
  gameId: string,
  questionId: string,
  messageId: string,
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>,
): Promise<void> {
  try {
    const response = await fetch('/api/breadcrumb', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ source: 'joshing_game', gameId, questionId }),
    });
    if (!response.ok) return;
    const body = await response.json().catch(() => null) as { breadcrumb?: string | null } | null;
    const breadcrumb = body?.breadcrumb ?? null;
    if (!breadcrumb) return;
    setMessages((existing) => existing.map((message) =>
      message.id === messageId && message.kind === 'result'
        ? { ...message, breadcrumb }
        : message,
    ));
  } catch {
    // Breadcrumb is purely additive context; failure is silently ignored.
  }
}
import { difficultyCopyFromEstimate } from '@/lib/questions/difficulty-copy';
import type { JoshingGameView, QuestionRow } from '@/server/db/queries/joshing-game';

function questionBadges(q: QuestionRow): Array<{ label: string; tone?: 'warning' }> | undefined {
  const level = q.calibratedDifficulty ?? q.llmDifficulty ?? q.difficultyEstimate ?? null;
  if (!level) return undefined;
  const label = difficultyCopyFromEstimate(level);
  if (!label) return undefined;
  return [level === 'specialist' ? { label, tone: 'warning' as const } : { label }];
}

type GradeResponse = {
  isCorrect: boolean;
  explanation: string;
  pointsAwarded: number;
  correctAnswer?: string;
  breadcrumb?: string | null;
  viewerStatus: 'not_started' | 'in_progress' | 'complete';
};

export function JoshingGamePlayClient({ game, viewerId }: { game: JoshingGameView; viewerId: string }) {
  const router = useRouter();
  const orderedQuestions = useMemo(
    () => [...game.questions].sort((a, b) => a.position - b.position),
    [game.questions],
  );
  const initialAnswered = new Set(game.responses.filter((response) => response.userId === viewerId).map((response) => response.questionId));
  const [answeredIds, setAnsweredIds] = useState(initialAnswered);
  const [answer, setAnswer] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pausingAfterAnswer, setPausingAfterAnswer] = useState(false);
  const nextQuestionTimerRef = useRef<number | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    const rows: ChatMessage[] = [{ id: 'intro', kind: 'system', text: game.game.title }];
    for (const response of game.responses.filter((item) => item.userId === viewerId)) {
      const item = orderedQuestions.find((question) => question.questionId === response.questionId);
      if (!item) continue;
      rows.push({
        id: `q-${response.questionId}`,
        kind: 'question',
        assignmentId: response.questionId,
        questionText: item.question.questionText,
        creatorName: game.creator.displayName,
        badges: questionBadges(item.question),
      });
      if (response.submittedAnswer) rows.push({ id: `u-${response.id}`, kind: 'user', text: response.submittedAnswer });
      rows.push({
        id: `r-${response.id}`,
        kind: 'result',
        assignmentId: response.questionId,
        questionText: item.question.questionText,
        result: response.isCorrect ? 'correct' : 'wrong',
        submitted: response.submittedAnswer ?? '',
        correctAnswer: response.isCorrect ? null : item.question.answerText,
        consolation: null,
        breadcrumb: null,
        copyVariant: item.position,
          creatorName: game.creator.displayName,
          canonicalSubcategory: item.question.canonicalSubcategory,
          reactionPrompt: game.game.creatorId !== viewerId
            ? {
                senderName: game.creator.displayName,
                questionId: item.questionId,
                contextType: 'joshing_game',
                contextId: game.game.id,
              }
            : null,
        });
    }
    const next = orderedQuestions.find((question) => !initialAnswered.has(question.questionId));
    if (next) {
      rows.push({
        id: `current-${next.questionId}`,
        kind: 'question',
        assignmentId: next.questionId,
        questionText: next.question.questionText,
        creatorName: game.creator.displayName,
        badges: questionBadges(next.question),
      });
    }
    return rows;
  });

  useEffect(() => {
    return () => {
      if (nextQuestionTimerRef.current) window.clearTimeout(nextQuestionTimerRef.current);
    };
  }, []);

  const actualCurrentQuestion = orderedQuestions.find((question) => !answeredIds.has(question.questionId));
  const currentQuestion = pausingAfterAnswer ? undefined : actualCurrentQuestion;

  async function submitAnswer() {
    if (!currentQuestion || !answer.trim() || pending) return;
    const submitted = answer.trim();
    setPending(true);
    setError(null);
    setAnswer('');
    setMessages((current) => [...current, { id: `user-${Date.now()}`, kind: 'user', text: submitted }]);

    try {
      const response = await fetch(`/api/joshing-games/${game.game.id}/answer`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ questionId: currentQuestion.questionId, submittedAnswer: submitted }),
      });
      const body = await response.json().catch(() => null) as GradeResponse | { message?: string } | null;
      if (!response.ok || !body || !('isCorrect' in body)) {
        throw new Error((body as { message?: string } | null)?.message ?? 'Could not record that answer.');
      }

      const nextAnswered = new Set(answeredIds);
      nextAnswered.add(currentQuestion.questionId);
      setAnsweredIds(nextAnswered);
      const nextQuestion = orderedQuestions.find((question) => !nextAnswered.has(question.questionId));
      setPausingAfterAnswer(true);
      const resultMessageId = `result-${currentQuestion.questionId}`;
      setMessages((current) => [
        ...current,
        {
          id: resultMessageId,
          kind: 'result',
          assignmentId: currentQuestion.questionId,
          questionText: currentQuestion.question.questionText,
          result: body.isCorrect ? 'correct' : 'wrong',
          submitted,
          correctAnswer: body.isCorrect ? null : body.correctAnswer ?? currentQuestion.question.answerText,
          consolation: null,
          breadcrumb: null,
          copyVariant: currentQuestion.position,
          creatorName: game.creator.displayName,
          canonicalSubcategory: currentQuestion.question.canonicalSubcategory,
          reactionPrompt: game.game.creatorId !== viewerId
            ? {
                senderName: game.creator.displayName,
                questionId: currentQuestion.questionId,
                contextType: 'joshing_game',
                contextId: game.game.id,
              }
            : null,
        },
      ]);

      void fetchJoshingGameBreadcrumb(game.game.id, currentQuestion.questionId, resultMessageId, setMessages);

      nextQuestionTimerRef.current = window.setTimeout(() => {
        setPausingAfterAnswer(false);
        if (nextQuestion) {
          setMessages((current) => [
            ...current,
            {
              id: `current-${nextQuestion.questionId}`,
              kind: 'question' as const,
              assignmentId: nextQuestion.questionId,
              questionText: nextQuestion.question.questionText,
              creatorName: game.creator.displayName,
              badges: questionBadges(nextQuestion.question),
            },
          ]);
        } else if (body.viewerStatus === 'complete') {
          router.push(`/games/${game.game.id}/summary`);
        }
      }, 850);

    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not record that answer.');
      setPausingAfterAnswer(false);
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-lg flex-col px-0">
      <header className="sticky top-0 z-20 border-b bg-background/95 px-4 py-3 backdrop-blur">
        <p className="text-xs uppercase tracking-[0.1em] text-muted-foreground">Joshing Game</p>
        <h1 className="font-serif text-xl font-semibold">{game.game.title}</h1>
        <p className="text-sm text-muted-foreground">{answeredIds.size} of {orderedQuestions.length}</p>
      </header>
      <section
        className="flex-1 overflow-y-auto px-4 py-4"
        style={{ paddingBottom: 'calc(140px + env(safe-area-inset-bottom))' }}
      >
        <GameplayChatThread messages={messages} />
        {error ? <p className="mt-4 rounded-md border border-destructive p-3 text-sm text-destructive">{error}</p> : null}
      </section>
      {currentQuestion ? (
        <form
          className="sticky bottom-0 flex gap-2 border-t bg-background/95 px-4 py-3 backdrop-blur"
          onSubmit={(event) => {
            event.preventDefault();
            void submitAnswer();
          }}
        >
          <input
            value={answer}
            onChange={(event) => setAnswer(event.target.value)}
            disabled={pending}
            placeholder="Your answer..."
            className="min-h-11 flex-1 rounded-md border bg-background px-4 text-base outline-none"
          />
          <button type="submit" className="btn-primary" disabled={pending || !answer.trim()}>
            {pending ? '...' : 'Send'}
          </button>
        </form>
      ) : null}
    </main>
  );
}
