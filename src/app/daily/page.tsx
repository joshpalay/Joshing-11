'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Settings } from 'lucide-react';

import { GameplayChatThread, newMessageId, type ChatMessage, type RecheckActionResult } from '@/components/play/GameplayChat';
import { GeometricProgress } from '@/components/play/GeometricProgress';
import { difficultyEstimateToTierLabel } from '@/lib/questions/difficulty-tier';
import { DAILY_QUEUE_SIZE, type QueueSlot } from '@/server/daily/types';

function questionBadges(slot: QueueSlot): Array<{ label: string; tone?: 'muted' | 'warning' }> {
  const tier = difficultyEstimateToTierLabel(slot.difficulty_estimate);
  return tier ? [{ label: tier }] : [];
}

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
  masteryDelta?: unknown | null;
  mastery_delta?: unknown | null;
};

type FailedAnswerResponse = {
  message?: string;
  error?: string;
};

type RecheckResponse = {
  accepted?: boolean;
  status?: 'accepted' | 'rejected' | 'needs_human';
  reason?: string;
  pointsAwarded?: number;
  correctAnswer?: string;
};

const ANSWER_ERROR_MESSAGES: Record<string, string> = {
  unauthorized: "Please sign in to answer today's question.",
  validation: 'Check your answer and try again.',
  not_found: 'We could not find that Daily Five queue.',
  invalid_state: 'That question is already closed.',
  question_not_found: 'We could not find that Daily Five question.',
  unexpected: 'Could not record that answer.',
};

function answerFailureMessage(body: FailedAnswerResponse | null): string {
  return body?.message ?? (body?.error ? ANSWER_ERROR_MESSAGES[body.error] : undefined) ?? 'Could not record that answer.';
}

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
        const createResponse = await fetch('/api/daily/queue', {
          method: 'POST',
          credentials: 'include',
          cache: 'no-store',
        });
        if (!createResponse.ok) {
          router.replace('/daily/setup');
          return;
        }
        const refetchResponse = await fetch('/api/daily/queue', { cache: 'no-store', credentials: 'include' });
        const refetchBody = await refetchResponse.json().catch(() => null);
        if (!refetchResponse.ok) {
          throw new Error(refetchBody?.message ?? 'Could not load today.');
        }
        if (!refetchBody?.queue_id) {
          setQueue(null);
          setLoading(false);
          return;
        }
        const refetchSlots = Array.isArray(refetchBody.slots) ? refetchBody.slots : [];
        setQueue({ queue_id: refetchBody.queue_id, queue_date: refetchBody.queue_date, slots: refetchSlots });
        setLoading(false);
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

  const requestRecheck = useCallback(async (slotIndex: number): Promise<RecheckActionResult> => {
    if (!queue) throw new Error('No active queue');

    const response = await fetch('/api/daily/recheck', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ queue_id: queue.queue_id, slot_index: slotIndex }),
    });
    const body = await response.json().catch(() => null) as RecheckResponse | FailedAnswerResponse | null;

    if (!response.ok) {
      throw new Error(body && 'message' in body && body.message ? body.message : 'Could not recheck that answer.');
    }

    const accepted = Boolean(body && 'accepted' in body && body.accepted);
    const status = body && 'status' in body ? body.status : accepted ? 'accepted' : 'rejected';
    const reason = body && 'reason' in body && body.reason ? body.reason : null;
    const pointsAwarded = body && 'pointsAwarded' in body && typeof body.pointsAwarded === 'number' ? body.pointsAwarded : 0;
    const correctAnswer = body && 'correctAnswer' in body && body.correctAnswer ? body.correctAnswer : undefined;

    setQueue((existing) => existing
      ? {
          ...existing,
          slots: existing.slots.map((slot) =>
            slot.slot_index === slotIndex
              ? {
                  ...slot,
                  answer_state: accepted ? 'correct' : 'incorrect',
                  awarded_points: accepted ? pointsAwarded : slot.awarded_points,
                  reveal_canonical_answer: correctAnswer ?? slot.reveal_canonical_answer,
                  recheck_status: status,
                  recheck_reason: reason,
                }
              : slot
          ),
        }
      : existing);

    if (accepted) {
      return { accepted: true, message: `Recheck accepted — +${pointsAwarded} ${pointsAwarded === 1 ? 'point' : 'points'}.` };
    }
    if (status === 'needs_human') {
      return { accepted: false, message: reason ?? 'Flagged for a human look.' };
    }
    return { accepted: false, message: reason ?? 'Rechecked and still marked wrong.' };
  }, [queue]);

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
          creatorName: null,
          badges: questionBadges(slot),
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
          creatorName: slot.source === 'friend' ? (slot.author_name ?? null) : null,
          canonicalSubcategory: slot.domain,
          recheckAction: slot.answer_state === 'incorrect' && !slot.recheck_status
            ? { onSubmit: () => requestRecheck(slot.slot_index) }
            : null,
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
          creatorName: null,
          isNew: true,
          badges: questionBadges(slot),
        });
        if (submitting && answer.trim()) {
          rows.push({ id: 'u-pending', kind: 'user', text: answer.trim() });
          rows.push({ id: 'grading', kind: 'typing' });
        }
        break;
      }
    }

    if (allDone) {
      rows.push({
        id: 'session-close',
        kind: 'session_close',
        text: sessionCloseCopy(queue.slots),
        summaryHref: '/daily/summary',
      });
    }

    return rows.length > 0
      ? rows
      : [{ id: newMessageId(), kind: 'system', text: "Today's five is not ready yet." }];
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allDone, currentSlot?.slot_index, queue, requestRecheck, submitting, answer]);

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
      if (!response.ok) {
        const failedBody = await response.json().catch(() => null) as FailedAnswerResponse | null;
        throw new Error(answerFailureMessage(failedBody));
      }

      const body = await response.json().catch(() => null) as AnswerResponse | null;
      if (!body) {
        throw new Error('Could not record that answer.');
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
        <div className="flex items-center gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.1em] text-[var(--text-muted)]">Daily Five</p>
            <h1 className="font-serif text-xl font-semibold text-[var(--text)]">Today&apos;s five</h1>
          </div>
          <Link
            href="/daily/setup"
            className="text-[var(--text-muted)] hover:text-[var(--text)] transition-colors"
            aria-label="Set up daily round"
          >
            <Settings className="size-4" aria-hidden="true" />
          </Link>
        </div>
        <GeometricProgress
          total={queue?.slots.length || DAILY_QUEUE_SIZE}
          current={(currentSlot?.slot_index ?? completedCount) + 1}
          results={results}
        />
      </header>

      <section
        className="flex-1 overflow-y-auto px-4 py-4"
        style={{ paddingBottom: "calc(140px + env(safe-area-inset-bottom))" }}
      >
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
          className="sticky bottom-0 z-30 mt-auto border-t px-4 py-3"
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
