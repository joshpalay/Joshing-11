'use client';

import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { X } from 'lucide-react';

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
import type { InsideJokeKind } from '@/lib/questions-types';
import type { JoshingGameView, QuestionRow } from '@/server/db/queries/joshing-game';

function questionBadges(q: QuestionRow): Array<{ label: string; tone?: 'warning' }> | undefined {
  const level = q.calibratedDifficulty ?? q.llmDifficulty ?? q.difficultyEstimate ?? null;
  if (!level) return undefined;
  const label = difficultyCopyFromEstimate(level);
  if (!label) return undefined;
  return [level === 'specialist' ? { label, tone: 'warning' as const } : { label }];
}

function pickExplainer(question: QuestionRow, isCorrect: boolean): string | null {
  const correctFirst = question.explainerFullCorrect
    ?? question.explainerFull
    ?? question.explainerBriefCorrect
    ?? question.explainerBrief
    ?? question.factualExplanation;
  const wrongFirst = question.explainerFullWrong
    ?? question.explainerFull
    ?? question.explainerBriefWrong
    ?? question.explainerBrief
    ?? question.factualExplanation;
  return (isCorrect ? correctFirst : wrongFirst) ?? null;
}

type GradeResponse = {
  isCorrect: boolean;
  explanation: string;
  pointsAwarded: number;
  correctAnswer?: string;
  breadcrumb?: string | null;
  insideJoke?: string | null;
  insideJokeKind?: InsideJokeKind | null;
  viewerStatus: 'not_started' | 'in_progress' | 'complete';
};

// Mono underlined link style for the per-question actions ("Show me the answer",
// "Skip"), mirroring the dismiss link inside QuestionRow.
const questionActionStyle = {
  background: 'none',
  border: 'none',
  padding: 0,
  cursor: 'pointer',
  fontFamily: 'var(--font-mono)',
  fontSize: '0.58rem',
  textTransform: 'uppercase' as const,
  letterSpacing: '0.06em',
  color: 'var(--text-muted)',
  textDecoration: 'underline',
  textUnderlineOffset: '2px',
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
  const answerInputRef = useRef<HTMLInputElement | null>(null);
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
        explanation: pickExplainer(item.question, Boolean(response.isCorrect)),
        copyVariant: item.position,
          creatorName: game.creator.displayName,
          canonicalSubcategory: item.question.canonicalSubcategory,
          reactionPrompt: game.game.creatorId !== viewerId
            ? {
                senderName: game.creator.displayName,
                questionId: item.questionId,
                contextType: 'joshing_game',
                contextId: game.game.id,
                result: response.isCorrect ? 'correct' : 'wrong',
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

  // Return focus to the answer input whenever a fresh question becomes active
  // (initial mount, and after each grading pause resolves). The input stays
  // mounted-but-disabled during grading, so focus is never lost from the DOM —
  // we just re-assert it when the field becomes editable again.
  useEffect(() => {
    if (currentQuestion && !pending) answerInputRef.current?.focus();
  }, [currentQuestion?.questionId, pending]);

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
          insideJoke: body.insideJoke ?? null,
          insideJokeKind: body.insideJokeKind ?? null,
          breadcrumb: null,
          explanation: body.explanation ?? pickExplainer(currentQuestion.question, body.isCorrect),
          copyVariant: currentQuestion.position,
          creatorName: game.creator.displayName,
          canonicalSubcategory: currentQuestion.question.canonicalSubcategory,
          reactionPrompt: game.game.creatorId !== viewerId
            ? {
                senderName: game.creator.displayName,
                questionId: currentQuestion.questionId,
                contextType: 'joshing_game',
                contextId: game.game.id,
                result: body.isCorrect ? 'correct' : 'wrong',
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

  // Consume the current question locally and advance to the next one (or the
  // summary when none remain). Shared by "Show me the answer" and "Skip", which
  // — like the daily catch-up give-up — resolve client-side without recording a
  // server response; unanswered questions surface as "skipped" on the summary.
  function consumeCurrentAndAdvance(consumed: JoshingGameView['questions'][number], appended: ChatMessage[]) {
    if (nextQuestionTimerRef.current) window.clearTimeout(nextQuestionTimerRef.current);
    const nextAnswered = new Set(answeredIds);
    nextAnswered.add(consumed.questionId);
    setAnsweredIds(nextAnswered);
    const nextQuestion = orderedQuestions.find((question) => !nextAnswered.has(question.questionId));
    setError(null);
    setAnswer('');
    setPausingAfterAnswer(true);
    if (appended.length > 0) setMessages((current) => [...current, ...appended]);
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
      } else {
        router.push(`/games/${game.game.id}/summary`);
      }
    }, 850);
  }

  function revealCurrentAnswer() {
    if (!currentQuestion || pending || pausingAfterAnswer) return;
    consumeCurrentAndAdvance(currentQuestion, [
      {
        id: `reveal-${currentQuestion.questionId}`,
        kind: 'result',
        assignmentId: currentQuestion.questionId,
        questionText: currentQuestion.question.questionText,
        result: 'gave_up',
        submitted: '',
        correctAnswer: currentQuestion.question.answerText,
        consolation: null,
        breadcrumb: null,
        explanation: pickExplainer(currentQuestion.question, false),
        copyVariant: currentQuestion.position,
        creatorName: game.creator.displayName,
        canonicalSubcategory: currentQuestion.question.canonicalSubcategory,
        reactionPrompt: null,
      },
    ]);
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-lg flex-col px-0">
      <header className="sticky top-0 z-20 flex items-center gap-2 border-b bg-background/95 px-4 py-3 backdrop-blur">
        <h1
          className="min-w-0 truncate font-serif text-[1.75rem] font-semibold leading-none"
          style={{ color: 'var(--brand-ink)', letterSpacing: 0 }}
        >
          {game.game.title}
        </h1>
        {/* Progress dots (Figma "Game" header) — filled for answered, hollow for
            the rest — replacing the old "N of M" text counter. */}
        <div className="flex flex-1 items-center justify-center gap-1.5" aria-hidden>
          {orderedQuestions.map((question, index) => (
            <span
              key={question.questionId}
              className="size-2 rounded-full"
              style={
                index < answeredIds.size
                  ? { background: 'var(--brand-navy)' }
                  : { border: '1.5px solid color-mix(in srgb, var(--brand-navy) 35%, transparent)' }
              }
            />
          ))}
        </div>
        <p className="sr-only" aria-live="polite">
          {answeredIds.size} of {orderedQuestions.length} answered
        </p>
        <Link
          href="/"
          aria-label="Exit game"
          className="inline-flex size-8 shrink-0 items-center justify-center transition hover:opacity-70"
          style={{ color: 'var(--brand-ink)' }}
        >
          <X className="size-5" strokeWidth={1.8} />
        </Link>
      </header>
      <section
        className="flex-1 overflow-y-auto px-4 py-4"
        style={{ paddingBottom: 'calc(96px + env(safe-area-inset-bottom))' }}
      >
        <GameplayChatThread messages={messages} />
        {currentQuestion && !pending && !pausingAfterAnswer ? (
          <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 pl-0.5">
            <button type="button" onClick={revealCurrentAnswer} style={questionActionStyle}>
              Show me the answer
            </button>
          </div>
        ) : null}
      </section>
      {actualCurrentQuestion ? (
        <form
          className="sticky bottom-0 border-t bg-background/95 px-4 py-3 backdrop-blur"
          onSubmit={(event) => {
            event.preventDefault();
            void submitAnswer();
          }}
        >
          {error ? (
            <p
              role="alert"
              aria-live="assertive"
              className="mb-2 rounded-md border p-3 text-sm"
              style={{ borderColor: 'var(--game-wrong-strong)', color: 'var(--game-wrong-strong)' }}
            >
              {error}
            </p>
          ) : null}
          <div className="flex gap-2">
            <label htmlFor="game-answer-input" className="sr-only">
              Your answer
            </label>
            <input
              id="game-answer-input"
              ref={answerInputRef}
              value={answer}
              onChange={(event) => setAnswer(event.target.value)}
              disabled={pending || pausingAfterAnswer}
              placeholder="Your answer..."
              aria-label="Your answer"
              autoComplete="off"
              autoCapitalize="sentences"
              enterKeyHint="send"
              className="min-h-11 flex-1 rounded-md border bg-background px-4 text-base outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-1"
            />
            <button
              type="submit"
              className="btn-primary font-serif text-base font-semibold"
              disabled={pending || pausingAfterAnswer || !answer.trim()}
            >
              {pending ? '...' : 'Answer'}
            </button>
          </div>
        </form>
      ) : null}
    </main>
  );
}
