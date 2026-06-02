'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { X } from 'lucide-react';

import { GameplayChatThread, newMessageId, type ChatMessage, type RecheckActionResult } from '@/components/play/GameplayChat';
import { pickOpenedTerritoryDomain } from '@/components/feed/territory';
import { GeometricProgress } from '@/components/play/GeometricProgress';
import { TopUpAreasModal, type TopUpInterest } from '@/components/daily/TopUpAreasModal';
import LoadingScreen from '@/components/LoadingScreen';
import { categoryLabel, type InsideJokeKind } from '@/lib/questions-types';
import { DAILY_QUEUE_SIZE, hasPendingSlot, type QueueSlot } from '@/server/daily/types';
import { buildSessionCloseLines, type SessionSlotSummary } from '@/server/mastery/session-close-copy';

function questionBadges(slot: QueueSlot): Array<{ label: string; tone?: 'muted' | 'warning' }> {
  // Figma shows the topic/category as the question chip (not the difficulty tier).
  const category =
    (slot.broad_category && slot.broad_category.trim()) ||
    (slot.category ? categoryLabel(slot.category) : '') ||
    slot.domain;
  const badges: Array<{ label: string; tone?: 'muted' | 'warning' }> = category ? [{ label: category }] : [];
  // Daily Five +2 bonus slots (friend-answered) carry an answerer and are always
  // "accessible" — surface the accessibility badge so the lighter pick reads as
  // a deliberate, easier add rather than a generation miss.
  if (slot.answerer_name && slot.difficulty_estimate === 'accessible') {
    badges.push({ label: 'Accessible', tone: 'muted' });
  }
  return badges;
}

type QueueResponse = {
  queue_id: string;
  queue_date: string;
  slots: QueueSlot[];
};

type AnswerResponse = {
  isCorrect?: boolean;
  correct?: boolean;
  gaveUp?: boolean;
  explanation?: string;
  explainer?: string;
  pointsAwarded?: number;
  awarded_points?: number;
  correctAnswer?: string;
  answer?: string;
  consolation?: string | null;
  insideJoke?: string | null;
  insideJokeKind?: InsideJokeKind | null;
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
  grader_unavailable:
    "Our answer-checker is taking a quick breather. Your answer wasn't scored — give it another go in a moment.",
  unexpected: 'Could not record that answer.',
};

function answerFailureMessage(body: FailedAnswerResponse | null): string {
  return body?.message ?? (body?.error ? ANSWER_ERROR_MESSAGES[body.error] : undefined) ?? 'Could not record that answer.';
}

// Returns the slot the player should be on, or null when the round is over.
// The `!answered && !skipped` predicate is the canonical "pending" definition
// shared with the status API via isRoundComplete (see @/server/daily/types) —
// when nothing is pending we redirect to the summary, and the home card now
// agrees by treating the round as complete instead of offering "Resume".
function currentPendingSlot(slots: QueueSlot[]): QueueSlot | null {
  if (!hasPendingSlot(slots)) return null;
  return slots.find((slot) => !slot.answered && !slot.skipped) ?? null;
}

function sessionCloseLines(slots: QueueSlot[]): { scoreLine: string; interpretiveLine: string | null } {
  if (slots.length > 0 && slots.every((slot) => slot.skipped)) {
    return { scoreLine: "We'll come back to these.", interpretiveLine: null };
  }
  // PRD §8.1.13 (v11.1) — score line + interpretive line. Tier-crossing and
  // new-demonstrated-domain interpretive cases need server-side mastery delta
  // plumbing that doesn't exist on the daily page yet; for now we only
  // populate the slot fields needed for the slot-derived priority levels
  // (sweep, wipeout, streaks, all-wrong-in-domain).
  const summaries: SessionSlotSummary[] = slots
    .filter((slot) => slot.answered)
    .map((slot) => ({
      domain: slot.domain ?? null,
      answer_state: slot.answer_state ?? null,
    }));
  return buildSessionCloseLines(summaries);
}

export default function DailyPage() {
  const router = useRouter();
  const [queue, setQueue] = useState<QueueResponse | null>(null);
  const [answer, setAnswer] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pausedAfterSlotIndex, setPausedAfterSlotIndex] = useState<number | null>(null);
  const [pendingGiveUp, setPendingGiveUp] = useState(false);
  const [openedTerritoryBySlot, setOpenedTerritoryBySlot] = useState<Record<number, string>>({});
  const [areaTopUp, setAreaTopUp] = useState<{ existing: TopUpInterest[]; maxNew: number } | null>(null);

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
          const createBody = await createResponse.json().catch(() => null);
          // 409 (no_knowledge_base) means the user genuinely has nothing to
          // generate from — send them to setup. A 503 (generation_failed) is a
          // transient/slow-generation hiccup; surface the retryable message
          // instead of bouncing a user with a valid knowledge base to setup.
          if (createResponse.status === 409) {
            router.replace('/daily/setup');
            return;
          }
          throw new Error(createBody?.message ?? 'Could not load today.');
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

  // One-time nudge for invite-seeded users who only declared three interests:
  // the next time they play, offer to top up to five. Eligibility (onboarded,
  // exactly three active interests, not yet dismissed) and persistence both
  // live server-side, so this just asks whether to show and renders the modal.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch('/api/declared-interests/top-up', {
          cache: 'no-store',
          credentials: 'include',
        });
        if (!response.ok) return;
        const body = (await response.json().catch(() => null)) as
          | { eligible?: boolean; existing?: TopUpInterest[]; remainingSlots?: number }
          | null;
        if (cancelled || !body?.eligible) return;
        setAreaTopUp({
          existing: Array.isArray(body.existing) ? body.existing : [],
          maxNew: Math.max(0, body.remainingSlots ?? 0),
        });
      } catch {
        // Non-fatal — the prompt simply won't show this session.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const actualCurrentSlot = useMemo(() => currentPendingSlot(queue?.slots ?? []), [queue?.slots]);
  const currentSlot = pausedAfterSlotIndex === null ? actualCurrentSlot : null;
  const completedCount = queue?.slots.filter((slot) => slot.answered).length ?? 0;
  // Use the ACTUAL queue length, not DAILY_QUEUE_SIZE — a low-yield domain can
  // produce a graceful-degraded shorter queue, and the progress dots should
  // match the real number of questions rather than always showing five.
  const queueLength = queue && queue.slots.length > 0 ? queue.slots.length : DAILY_QUEUE_SIZE;
  const allDone = Boolean(queue && queue.slots.length > 0 && !actualCurrentSlot);


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
        const gaveUp = slot.answer_state === 'incorrect' && !slot.submitted_answer;
        rows.push({
          id: `q-${slot.slot_index}`,
          kind: 'question',
          assignmentId: String(slot.slot_index),
          questionText: slot.question_text,
          creatorName: null,
          answererName: slot.answerer_name ?? null,
          badges: questionBadges(slot),
        });
        if (slot.submitted_answer) {
          rows.push({ id: `u-${slot.slot_index}`, kind: 'user', text: slot.submitted_answer });
        } else if (gaveUp) {
          rows.push({ id: `u-${slot.slot_index}`, kind: 'user', text: 'show me the answer' });
        }
        rows.push({
          id: `r-${slot.slot_index}`,
          kind: 'result',
          assignmentId: String(slot.slot_index),
          questionText: slot.question_text,
          result: slot.answer_state === 'correct' ? 'correct' : gaveUp ? 'gave_up' : 'wrong',
          submitted: slot.submitted_answer ?? '',
          correctAnswer: slot.answer_state === 'correct' ? null : slot.reveal_canonical_answer ?? null,
          consolation: slot.reveal_quip ?? null,
          insideJoke: slot.reveal_inside_joke ?? null,
          insideJokeKind: slot.reveal_inside_joke_kind ?? null,
          authorNote: slot.source === 'friend' ? (slot.author_note ?? null) : null,
          breadcrumb: slot.reveal_breadcrumb ?? null,
          explanation: slot.reveal_explainer ?? null,
          copyVariant: slot.slot_index,
          creatorName: slot.source === 'friend' ? (slot.author_name ?? null) : null,
          canonicalSubcategory: slot.domain,
          openedTerritoryDomain: openedTerritoryBySlot[slot.slot_index] ?? null,
          recheckAction: slot.answer_state === 'incorrect' && !gaveUp && !slot.recheck_status
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
          answererName: slot.answerer_name ?? null,
          isNew: true,
          badges: questionBadges(slot),
        });
        if (submitting && answer.trim()) {
          rows.push({ id: 'u-pending', kind: 'user', text: answer.trim() });
          rows.push({ id: 'grading', kind: 'typing' });
        } else if (pendingGiveUp) {
          rows.push({ id: 'u-pending-giveup', kind: 'user', text: 'show me the answer' });
          rows.push({ id: 'grading', kind: 'typing' });
        }
        break;
      }
    }

    if (allDone) {
      const { scoreLine, interpretiveLine } = sessionCloseLines(queue.slots);
      rows.push({
        id: 'session-close',
        kind: 'session_close',
        scoreLine,
        interpretiveLine,
        summaryHref: '/daily/summary',
      });
    }

    return rows.length > 0
      ? rows
      : [{ id: newMessageId(), kind: 'system', text: "Today's five is not ready yet." }];
  }, [allDone, currentSlot?.slot_index, queue, requestRecheck, submitting, answer, pendingGiveUp, openedTerritoryBySlot]);

  const results = useMemo(() => {
    const map: Record<number, 'correct' | 'wrong' | 'expired'> = {};
    let position = 1;
    for (const slot of [...(queue?.slots ?? [])].sort((a, b) => a.slot_index - b.slot_index)) {
      if (!slot.answered) continue;
      map[position] = slot.answer_state === 'correct' ? 'correct' : 'wrong';
      position += 1;
    }
    return map;
  }, [queue?.slots]);

  const fetchBreadcrumb = useCallback(async (queueId: string, slotIndex: number) => {
    try {
      const response = await fetch('/api/breadcrumb', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ source: 'daily', queueId, slotIndex }),
      });
      if (!response.ok) return;
      const body = await response.json().catch(() => null) as { breadcrumb?: string | null } | null;
      const breadcrumb = body?.breadcrumb ?? null;
      if (!breadcrumb) return;
      setQueue((existing) => existing && existing.queue_id === queueId
        ? {
            ...existing,
            slots: existing.slots.map((slot) =>
              slot.slot_index === slotIndex
                ? { ...slot, reveal_breadcrumb: breadcrumb }
                : slot,
            ),
          }
        : existing);
    } catch {
      // Breadcrumb is purely additive context; failure is silently ignored.
    }
  }, []);

  const postAnswer = useCallback(async (opts: { submittedAnswer: string; gaveUp: boolean }) => {
    if (!queue || !currentSlot || submitting) return;
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
          submitted_answer: opts.submittedAnswer,
          gave_up: opts.gaveUp,
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
      // A correct answer in an unfamiliar domain default-adds it to the KB
      // (B-1). The server reports the freshly-opened domain on masteryDelta;
      // stash it per-slot so the reveal can surface the "Added — remove?" undo.
      // Client-only — deliberately not persisted into the QueueSlot schema.
      const masteryDelta = body.masteryDelta ?? body.mastery_delta;
      const openedDomain = isCorrect ? pickOpenedTerritoryDomain(masteryDelta) : null;
      if (openedDomain) {
        setOpenedTerritoryBySlot((existing) => ({ ...existing, [currentSlot.slot_index]: openedDomain }));
      }
      setQueue((existing) => existing
        ? {
            ...existing,
            slots: existing.slots.map((slot) =>
              slot.slot_index === currentSlot.slot_index
                ? {
                    ...slot,
                    answered: true,
                    answer_state: isCorrect ? 'correct' : 'incorrect',
                    submitted_answer: opts.gaveUp ? '' : opts.submittedAnswer,
                    awarded_points: body.pointsAwarded ?? body.awarded_points ?? 0,
                    reveal_canonical_answer: body.correctAnswer ?? body.answer,
                    reveal_explainer: body.explanation ?? body.explainer,
                    reveal_breadcrumb: null,
                    reveal_quip: opts.gaveUp ? null : body.consolation ?? null,
                    reveal_inside_joke: body.insideJoke ?? null,
                    reveal_inside_joke_kind: body.insideJokeKind ?? null,
                  }
                : slot
            ),
          }
        : existing);
      setPausedAfterSlotIndex(currentSlot.slot_index);
      window.setTimeout(() => setPausedAfterSlotIndex(null), 850);
      setAnswer('');

      if (!opts.gaveUp) {
        void fetchBreadcrumb(queue.queue_id, currentSlot.slot_index);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not record that answer.');
    } finally {
      setSubmitting(false);
    }
  }, [currentSlot, fetchBreadcrumb, queue, submitting]);

  const submitAnswer = useCallback(async () => {
    const trimmed = answer.trim();
    if (!trimmed) return;
    await postAnswer({ submittedAnswer: trimmed, gaveUp: false });
  }, [answer, postAnswer]);

  const giveUpCurrent = useCallback(async () => {
    setPendingGiveUp(true);
    try {
      await postAnswer({ submittedAnswer: '', gaveUp: true });
    } finally {
      setPendingGiveUp(false);
    }
  }, [postAnswer]);

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
        </div>
        <div className="flex items-center gap-2">
          <GeometricProgress
            total={queueLength}
            current={Math.min(completedCount + 1, queueLength)}
            results={results}
          />
          <Link
            href="/"
            aria-label="Close"
            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md text-[var(--text-muted)] transition hover:bg-[var(--surface-2)] hover:text-[var(--text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2"
          >
            <X className="size-5" strokeWidth={1.9} />
          </Link>
        </div>
      </header>

      <section
        className="flex-1 overflow-y-auto px-4 py-4"
        style={{ paddingBottom: "calc(24px + env(safe-area-inset-bottom))" }}
      >
        {loading ? (
          <LoadingScreen fullScreen label="Loading today" />
        ) : error ? (
          <div className="rounded-[var(--radius-sm)] border px-3 py-2 text-sm text-[var(--danger)]" style={{ borderColor: 'var(--danger)' }}>
            {error}
          </div>
        ) : (
          <GameplayChatThread
            messages={messages}
            onGiveUp={() => void giveUpCurrent()}
            giveUpDisabled={submitting}
          />
        )}
      </section>

      {currentSlot && !loading ? (
        <form
          className="sticky bottom-0 z-30 mt-auto border-t px-4 py-3"
          style={{
            borderColor: 'var(--border)',
            background: 'color-mix(in srgb, var(--surface) 94%, transparent)',
            backdropFilter: 'blur(6px)',
            paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom))',
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
              {submitting ? '...' : 'Answer'}
            </button>
          </div>
        </form>
      ) : null}

      {areaTopUp && areaTopUp.maxNew > 0 ? (
        <TopUpAreasModal
          existing={areaTopUp.existing}
          maxNew={areaTopUp.maxNew}
          onDismiss={() => setAreaTopUp(null)}
          onSaved={() => setAreaTopUp(null)}
        />
      ) : null}
    </main>
  );
}
