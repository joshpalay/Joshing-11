'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

import { GameplayChatThread, newMessageId, type ChatMessage } from '@/components/play/GameplayChat';
import { GeometricProgress } from '@/components/play/GeometricProgress';
import { DAILY_QUEUE_SIZE, type QueueSlot } from '@/server/daily/types';

type QueueResponse = {
  queue_id: string;
  queue_date: string;
  slots: QueueSlot[];
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

function currentPendingSlot(slots: QueueSlot[]): QueueSlot | null {
  return slots.find((slot) => !slot.answered && !slot.skipped) ?? null;
}

function sessionCloseCopy(slots: QueueSlot[]): string {
  if (slots.length > 0 && slots.every((slot) => slot.skipped)) return "We'll come back to these.";
  const answered = slots.filter((slot) => slot.answered);
  if (answered.length > 0 && answered.every((slot) => slot.answer_state === 'correct')) {
    return 'Five for five. See you tomorrow.';
  }
  if (answered.length > 0 && answered.every((slot) => slot.answer_state === 'incorrect')) {
    return 'Tough round. The map grows anyway.';
  }
  return "That's today's round. See you tomorrow.";
}

export default function DailyPage() {
  const router = useRouter();
  const [queue, setQueue] = useState<QueueResponse | null>(null);
  const [answer, setAnswer] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pausedAfterSlotIndex, setPausedAfterSlotIndex] = useState<number | null>(null);

  const loadQueue = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/daily/queue', { cache: 'no-store', credentials: 'include' });
      const body = await response.json().catch(() => null);

      if (response.ok && body?.queue === null) {
        router.replace('/daily/setup');
        return;
      }

      if (!response.ok) {
        throw new Error(body?.message ?? 'Could not load today.');
      }

      if (!body?.queue_id) {
        setQueue(null);
        return;
      }

      const slots = Array.isArray(body.slots) ? body.slots : [];
      if (slots.length > 0 && !currentPendingSlot(slots)) {
        router.replace('/daily/summary');
        return;
      }

      setQueue({
        queue_id: body.queue_id,
        queue_date: body.queue_date,
        slots,
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not load today.');
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    const initialTimer = window.setTimeout(() => {
      void loadQueue();
    }, 0);

    return () => window.clearTimeout(initialTimer);
  }, [loadQueue]);

  const actualCurrentSlot = useMemo(() => currentPendingSlot(queue?.slots ?? []), [queue?.slots]);
  const currentSlot = pausedAfterSlotIndex === null ? actualCurrentSlot : null;
  const completedCount = queue?.slots.filter((slot) => slot.answered || slot.skipped).length ?? 0;
  const allDone = Boolean(queue && queue.slots.length > 0 && !actualCurrentSlot);

  useEffect(() => {
    if (!allDone || loading) return;
    const timer = window.setTimeout(() => {
      router.replace('/daily/summary');
    }, 2000);

    return () => window.clearTimeout(timer);
  }, [allDone, loading, router]);

  const skipCurrent = useCallback(async () => {
    if (!queue || !currentSlot || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch('/api/daily/skip', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ queue_id: queue.queue_id, slot_index: currentSlot.slot_index }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.message ?? 'Could not skip that question.');
      }
      setQueue((existing) => existing
        ? {
            ...existing,
            slots: existing.slots.map((slot) =>
              slot.slot_index === currentSlot.slot_index ? { ...slot, skipped: true } : slot
            ),
          }
        : existing);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not skip that question.');
    } finally {
      setSubmitting(false);
    }
  }, [currentSlot, queue, submitting]);

  const messages = useMemo<ChatMessage[]>(() => {
    if (!queue) return [];
    const rows: ChatMessage[] = [];
    for (const slot of queue.slots) {
      if (slot.answered) {
        rows.push({
          id: `q-${slot.slot_index}`,
          kind: 'question',
          assignmentId: String(slot.slot_index),
          questionText: slot.question_text,
          creatorName: 'From Joshing',
        });
        if (slot.submitted_answer) {
          rows.push({ id: `u-${slot.slot_index}`, kind: 'user', text: slot.submitted_answer });
        }
        rows.push({
          id: `r-${slot.slot_index}`,
          kind: 'result',
          assignmentId: String(slot.slot_index),
          questionText: slot.question_text,
          result: slot.answer_state === 'correct' ? 'correct' : 'wrong',
          submitted: slot.submitted_answer ?? '',
          correctAnswer: slot.answer_state === 'correct' ? null : slot.reveal_canonical_answer ?? null,
          consolation: slot.reveal_quip ?? null,
          breadcrumb: slot.reveal_breadcrumb ?? null,
          copyVariant: slot.slot_index,
          creatorName: 'Joshing',
          canonicalSubcategory: slot.domain,
        });
        continue;
      }
      if (slot.skipped) {
        rows.push({
          id: `s-${slot.slot_index}`,
          kind: 'system',
          text: "Skipped. We'll bring it back later.",
        });
        continue;
      }
      if (currentSlot?.slot_index === slot.slot_index) {
        rows.push({
          id: `q-${slot.slot_index}`,
          kind: 'question',
          assignmentId: String(slot.slot_index),
          questionText: slot.question_text,
          creatorName: 'From Joshing',
        });
        break;
      }
    }

    if (allDone) {
      rows.push({
        id: 'session-close',
        kind: 'session_close',
        text: sessionCloseCopy(queue.slots),
      });
    }

    return rows.length > 0
      ? rows
      : [{ id: newMessageId(), kind: 'system', text: "Today's five is not ready yet." }];
  }, [allDone, currentSlot?.slot_index, queue, skipCurrent]);

  const results = useMemo(() => {
    const map: Record<number, 'correct' | 'wrong' | 'expired'> = {};
    for (const slot of queue?.slots ?? []) {
      if (!slot.answered) continue;
      map[slot.slot_index + 1] = slot.answer_state === 'correct' ? 'correct' : 'wrong';
    }
    return map;
  }, [queue?.slots]);

  const submitAnswer = useCallback(async () => {
    if (!queue || !currentSlot || submitting || !answer.trim()) return;
    const submittedAnswer = answer.trim();
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch('/api/daily/answer', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          queue_id: queue.queue_id,
          slot_index: currentSlot.slot_index,
          submitted_answer: submittedAnswer,
        }),
      });
      const body = await response.json().catch(() => null) as AnswerResponse | null;
      if (!response.ok || !body) {
        throw new Error((body as { message?: string } | null)?.message ?? 'Could not record that answer.');
      }

      const isCorrect = Boolean(body.isCorrect ?? body.correct);
      setQueue((existing) => existing
        ? {
            ...existing,
            slots: existing.slots.map((slot) =>
              slot.slot_index === currentSlot.slot_index
                ? {
                    ...slot,
                    answered: true,
                    answer_state: isCorrect ? 'correct' : 'incorrect',
                    submitted_answer: submittedAnswer,
                    awarded_points: body.pointsAwarded ?? body.awarded_points ?? 0,
                    reveal_canonical_answer: body.correctAnswer ?? body.answer,
                    reveal_explainer: body.explanation ?? body.explainer,
                    reveal_breadcrumb: body.breadcrumb ?? null,
                    reveal_quip: body.consolation ?? body.quip ?? null,
                  }
                : slot
            ),
          }
        : existing);
      setPausedAfterSlotIndex(currentSlot.slot_index);
      window.setTimeout(() => setPausedAfterSlotIndex(null), 850);
      setAnswer('');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not record that answer.');
    } finally {
      setSubmitting(false);
    }
  }, [answer, currentSlot, queue, submitting]);

  return (
    <main className="mx-auto flex min-h-dvh max-w-lg flex-col px-0">
      <header
        className="sticky top-0 z-20 flex items-center justify-between gap-3 border-b px-4 py-3"
        style={{
          borderColor: 'var(--border)',
          background: 'color-mix(in srgb, var(--surface) 94%, transparent)',
          backdropFilter: 'blur(6px)',
        }}
      >
        <div>
          <p className="text-xs uppercase tracking-[0.1em] text-[var(--text-muted)]">Daily Five</p>
          <h1 className="font-serif text-xl font-semibold text-[var(--text)]">Today&apos;s five</h1>
        </div>
        <GeometricProgress
          total={queue?.slots.length || DAILY_QUEUE_SIZE}
          current={(currentSlot?.slot_index ?? completedCount) + 1}
          results={results}
        />
      </header>

      <section className="flex-1 overflow-y-auto px-4 py-4" style={{ paddingBottom: '160px' }}>
        {loading ? (
          <p className="text-sm text-[var(--text-muted)]">Loading today...</p>
        ) : error ? (
          <div className="rounded-[var(--radius-sm)] border px-3 py-2 text-sm text-[var(--danger)]" style={{ borderColor: 'var(--danger)' }}>
            {error}
          </div>
        ) : (
          <GameplayChatThread messages={messages} />
        )}
      </section>

      {currentSlot && !loading ? (
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
          <button
            type="button"
            className="mt-2 text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground underline underline-offset-4"
            disabled={submitting}
            onClick={() => void skipCurrent()}
          >
            Skip
          </button>
        </form>
      ) : null}
    </main>
  );
}
