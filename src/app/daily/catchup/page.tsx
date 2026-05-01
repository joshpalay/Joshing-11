'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

import { GameplayChatThread, newMessageId, type ChatMessage } from '@/components/play/GameplayChat';

type CatchupQuestion = {
  dailyQueueItemId: string;
  queueDate: string;
  slotIndex: number;
  questionId: string;
  questionText: string;
  domain: string;
  skipped: boolean;
};

type AnswerResponse = {
  isCorrect?: boolean;
  correct?: boolean;
  explanation?: string;
  explainer?: string;
  pointsAwarded?: number;
  awarded_points?: number;
  correctAnswer?: string;
  answer?: string;
  consolation?: string | null;
  quip?: string | null;
  breadcrumb?: string | null;
};

export default function DailyCatchupPage() {
  const router = useRouter();
  const [questions, setQuestions] = useState<CatchupQuestion[]>([]);
  const [history, setHistory] = useState<ChatMessage[]>([]);
  const [answer, setAnswer] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const currentQuestion = questions[0] ?? null;

  useEffect(() => {
    let cancelled = false;

    async function loadCatchup() {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch('/api/daily/catchup', { cache: 'no-store', credentials: 'include' });
        const body = await response.json().catch(() => null);
        if (!response.ok) throw new Error(body?.message ?? 'Could not load catch-up.');
        const nextQuestions = Array.isArray(body?.questions) ? body.questions : [];
        if (!cancelled) {
          setQuestions(nextQuestions);
          if (nextQuestions.length === 0) router.replace('/');
        }
      } catch (caught) {
        if (!cancelled) setError(caught instanceof Error ? caught.message : 'Could not load catch-up.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadCatchup();
    return () => {
      cancelled = true;
    };
  }, [router]);

  const closeCurrent = useCallback(() => {
    setQuestions((existing) => {
      const next = existing.slice(1);
      if (next.length === 0) {
        window.setTimeout(() => router.replace('/'), 900);
      }
      return next;
    });
  }, [router]);

  const dismissCurrent = useCallback(async () => {
    if (!currentQuestion || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch('/api/daily/catchup/dismiss', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ dailyQueueItemId: currentQuestion.dailyQueueItemId }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.message ?? 'Could not dismiss that question.');
      }
      setHistory((existing) => [
        ...existing,
        { id: newMessageId(), kind: 'system', text: 'Dismissed.' },
      ]);
      closeCurrent();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not dismiss that question.');
    } finally {
      setSubmitting(false);
    }
  }, [closeCurrent, currentQuestion, submitting]);

  const submitAnswer = useCallback(async () => {
    if (!currentQuestion || submitting || !answer.trim()) return;
    const submittedAnswer = answer.trim();
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch('/api/daily/catchup/answer', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          dailyQueueItemId: currentQuestion.dailyQueueItemId,
          submittedAnswer,
        }),
      });
      const body = await response.json().catch(() => null) as AnswerResponse | null;
      if (!response.ok || !body) {
        throw new Error((body as { message?: string } | null)?.message ?? 'Could not record that answer.');
      }

      const isCorrect = Boolean(body.isCorrect ?? body.correct);
      setHistory((existing) => [
        ...existing,
        {
          id: `q-${currentQuestion.dailyQueueItemId}`,
          kind: 'question',
          assignmentId: currentQuestion.dailyQueueItemId,
          questionText: currentQuestion.questionText,
          creatorName: 'From Joshing',
        },
        { id: `u-${currentQuestion.dailyQueueItemId}`, kind: 'user', text: submittedAnswer },
        {
          id: `r-${currentQuestion.dailyQueueItemId}`,
          kind: 'result',
          assignmentId: currentQuestion.dailyQueueItemId,
          questionText: currentQuestion.questionText,
          result: isCorrect ? 'correct' : 'wrong',
          submitted: submittedAnswer,
          correctAnswer: isCorrect ? null : body.correctAnswer ?? body.answer ?? null,
          consolation: body.consolation ?? body.quip ?? null,
          breadcrumb: body.breadcrumb ?? null,
          copyVariant: currentQuestion.slotIndex,
          creatorName: 'Joshing',
          canonicalSubcategory: currentQuestion.domain,
        },
      ]);
      setAnswer('');
      window.setTimeout(() => closeCurrent(), 850);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not record that answer.');
    } finally {
      setSubmitting(false);
    }
  }, [answer, closeCurrent, currentQuestion, submitting]);

  const messages = useMemo<ChatMessage[]>(() => {
    const rows = [...history];
    if (currentQuestion) {
      rows.push({
        id: `current-${currentQuestion.dailyQueueItemId}`,
        kind: 'question',
        assignmentId: currentQuestion.dailyQueueItemId,
        questionText: currentQuestion.questionText,
        creatorName: `From ${currentQuestion.queueDate}`,
        onDismiss: () => void dismissCurrent(),
        dismissLabel: 'X',
      });
    }
    return rows.length > 0
      ? rows
      : [{ id: newMessageId(), kind: 'system', text: 'No catch-up questions waiting.' }];
  }, [currentQuestion, dismissCurrent, history]);

  return (
    <main className="mx-auto flex min-h-dvh max-w-lg flex-col px-0">
      <header
        className="sticky top-0 z-20 border-b px-4 py-3"
        style={{
          borderColor: 'var(--border)',
          background: 'color-mix(in srgb, var(--surface) 94%, transparent)',
          backdropFilter: 'blur(6px)',
        }}
      >
        <p className="text-xs uppercase tracking-[0.1em] text-[var(--text-muted)]">Catch-up · 0.25× points</p>
        <h1 className="font-serif text-xl font-semibold text-[var(--text)]">Missed questions</h1>
      </header>

      <section className="flex-1 overflow-y-auto px-4 py-4" style={{ paddingBottom: '160px' }}>
        {loading ? (
          <p className="text-sm text-[var(--text-muted)]">Loading catch-up...</p>
        ) : error ? (
          <div className="rounded-[var(--radius-sm)] border px-3 py-2 text-sm text-[var(--danger)]" style={{ borderColor: 'var(--danger)' }}>
            {error}
          </div>
        ) : (
          <GameplayChatThread messages={messages} />
        )}
      </section>

      {currentQuestion && !loading ? (
        <form
          className="fixed inset-x-0 bottom-16 z-30 mx-auto max-w-lg border-t px-4 py-3 md:bottom-0"
          style={{
            borderColor: 'var(--border)',
            background: 'color-mix(in srgb, var(--surface) 94%, transparent)',
            backdropFilter: 'blur(6px)',
          }}
          onSubmit={(event) => {
            event.preventDefault();
            void submitAnswer();
          }}
        >
          <div className="flex gap-2">
            <input
              value={answer}
              onChange={(event) => setAnswer(event.target.value)}
              disabled={submitting}
              placeholder="Your answer..."
              className="min-h-11 min-w-0 flex-1 rounded-[var(--radius-md)] border bg-[var(--bg)] px-4 text-base text-[var(--text)] outline-none"
              style={{ borderColor: 'var(--border)' }}
            />
            <button type="submit" className="btn-primary shrink-0" disabled={submitting || !answer.trim()}>
              {submitting ? '...' : 'Send'}
            </button>
          </div>
        </form>
      ) : null}
    </main>
  );
}
