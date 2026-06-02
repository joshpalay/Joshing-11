'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, type FormEvent } from 'react';

import { GameplayChatThread, newMessageId, type ChatMessage } from '@/components/play/GameplayChat';
import { LLM_QUESTION_ATTRIBUTION } from '@/lib/questions-types';
import type { SeededPlayQuestion } from '@/server/db/queries/lately';

type GradeResponse = {
  result: 'correct' | 'wrong';
  isCorrect: boolean;
  correctAnswer: string;
  explanation?: string | null;
  consolation?: string | null;
};

function questionMessage(item: SeededPlayQuestion): ChatMessage {
  return {
    id: `seeded-q-${item.questionId}`,
    kind: 'question',
    assignmentId: item.questionId,
    questionText: item.questionText,
    creatorName: item.authorIsHouse ? item.authorName : item.authorName ?? LLM_QUESTION_ATTRIBUTION,
    creatorIsHouse: item.authorIsHouse,
    badges: [{ label: 'practice', tone: 'muted' }],
  };
}

// The Lately milestone click-through. A fixed, ordered list of a friend's
// literal questions, played as practice — grading reveals the answer but the
// server records nothing (no score, no mastery event).
export function SeededPlayClient({ questions }: { questions: SeededPlayQuestion[] }) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [messages, setMessages] = useState<ChatMessage[]>(() => [questionMessage(questions[0])]);
  const [answer, setAnswer] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const threadRef = useRef<HTMLDivElement>(null);

  const currentItem = questions[currentIndex] ?? null;
  const sessionDone = currentIndex >= questions.length;

  useEffect(() => {
    if (threadRef.current) threadRef.current.scrollTop = threadRef.current.scrollHeight;
  }, [messages]);

  async function submitAnswer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!currentItem || submitting || !answer.trim()) return;
    const submittedAnswer = answer.trim();
    setAnswer('');
    setSubmitting(true);
    setError(null);

    try {
      const response = await fetch('/api/lately/play/grade', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ questionId: currentItem.questionId, submittedAnswer }),
      });
      const body = (await response.json().catch(() => null)) as GradeResponse | null;
      if (!response.ok || !body) throw new Error('Could not score that answer.');

      const nextIndex = currentIndex + 1;
      setMessages((existing) => [
        ...existing,
        { id: newMessageId(), kind: 'user', text: submittedAnswer },
        {
          id: newMessageId(),
          kind: 'result',
          assignmentId: currentItem.questionId,
          questionText: currentItem.questionText,
          result: body.isCorrect ? 'correct' : 'wrong',
          submitted: submittedAnswer,
          correctAnswer: body.isCorrect ? null : body.correctAnswer,
          consolation: body.consolation ?? null,
          breadcrumb: null,
          explanation: body.explanation ?? currentItem.explanation ?? null,
          copyVariant: currentIndex,
          creatorName: currentItem.authorName ?? LLM_QUESTION_ATTRIBUTION,
          creatorIsHouse: currentItem.authorIsHouse,
          canonicalSubcategory: currentItem.domain,
          pointsAwarded: 0,
          pointsLabel: 'Practice only',
        },
        ...(nextIndex < questions.length ? [questionMessage(questions[nextIndex])] : []),
      ]);
      setCurrentIndex(nextIndex);
    } catch (caught) {
      setAnswer(submittedAnswer);
      setError(caught instanceof Error ? caught.message : 'Could not score that answer.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <p className="text-xs font-medium uppercase tracking-[0.12em] text-[var(--text-muted)]">Lately</p>
      <h1 className="mt-2 font-serif text-3xl font-semibold text-[var(--text)]">Their questions.</h1>
      <p className="mt-2 text-sm leading-6 text-[var(--text-muted)]">
        Play the questions your friend got right. Practice only — nothing here changes your score.
      </p>

      <div ref={threadRef} className="mt-5 flex-1 overflow-y-auto">
        <GameplayChatThread messages={messages} />
        {sessionDone ? (
          <div className="mt-6">
            <Link href="/activities" className="btn-primary inline-flex">
              Back to Lately
            </Link>
          </div>
        ) : null}
      </div>

      {currentItem && !sessionDone ? (
        <form
          className="fixed inset-x-0 bottom-16 z-30 mx-auto max-w-lg border-t px-4 py-3 md:bottom-0"
          style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
          onSubmit={(event) => void submitAnswer(event)}
        >
          {error ? <p className="mb-2 text-sm text-[var(--danger)]">{error}</p> : null}
          <div className="flex gap-2">
            <input
              value={answer}
              onChange={(event) => setAnswer(event.target.value)}
              disabled={submitting}
              placeholder="Your answer..."
              aria-label="Your answer"
              className="min-h-11 min-w-0 flex-1 rounded-[var(--radius-md)] border bg-[var(--bg)] px-4 text-base text-[var(--text)] outline-none"
              style={{ borderColor: 'var(--border)' }}
            />
            <button type="submit" className="btn-primary shrink-0" disabled={submitting || !answer.trim()}>
              {submitting ? '...' : 'Answer'}
            </button>
          </div>
        </form>
      ) : null}
    </>
  );
}
