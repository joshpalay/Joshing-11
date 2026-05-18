'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

import { GameplayChatThread, newMessageId, type ChatMessage, type RecheckActionResult } from '@/components/play/GameplayChat';
import { GeometricProgress } from '@/components/play/GeometricProgress';
import { difficultyEstimateToTierLabel } from '@/lib/questions/difficulty-tier';
import { categoryLabel } from '@/lib/questions-types';
import { DAILY_QUEUE_SIZE, type QueueSlot } from '@/server/daily/types';
import { buildSessionCloseLines, type SessionSlotSummary } from '@/server/mastery/session-close-copy';

type ExclusionScope = 'subcategory' | 'broad_category' | 'category';

type ExclusionTick = { scope: ExclusionScope; label: string; value: string };

function buildExclusionTicks(slot: QueueSlot): ExclusionTick[] {
  const ticks: ExclusionTick[] = [
    { scope: 'subcategory', label: slot.domain, value: slot.domain },
  ];
  if (slot.broad_category && slot.broad_category.trim()) {
    ticks.push({ scope: 'broad_category', label: slot.broad_category, value: slot.broad_category });
  }
  if (slot.category && slot.category.trim()) {
    ticks.push({ scope: 'category', label: categoryLabel(slot.category), value: slot.category });
  }
  return ticks;
}

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
  gaveUp?: boolean;
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

function UnfamiliarDialog({
  ticks,
  busy,
  onExclude,
  onSkipOnly,
  onCancel,
}: {
  ticks: ExclusionTick[];
  busy: boolean;
  onExclude: (tick: ExclusionTick) => void;
  onSkipOnly: () => void;
  onCancel: () => void;
}) {
  const [tickIndex, setTickIndex] = useState(0);
  const maxIndex = Math.max(0, ticks.length - 1);
  const safeIndex = Math.min(tickIndex, maxIndex);
  const selected = ticks[safeIndex] ?? ticks[0];

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel(); };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onCancel]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="unfamiliar-dialog-title"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 60,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '1rem',
        background: 'rgba(0,0,0,0.45)',
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div
        style={{
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-lg)',
          padding: '1.5rem',
          maxWidth: '24rem',
          width: '100%',
        }}
      >
        <p id="unfamiliar-dialog-title" className="text-sm font-semibold text-[var(--text)]">
          How familiar are you with this?
        </p>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          Slide to the scope you&rsquo;d like to skip going forward.
        </p>

        {ticks.length > 1 ? (
          <div className="mt-5">
            <input
              type="range"
              min={0}
              max={maxIndex}
              step={1}
              value={safeIndex}
              onChange={(event) => setTickIndex(Number(event.target.value))}
              aria-label="Unfamiliarity scope"
              style={{ width: '100%' }}
            />
            <div className="mt-2 flex justify-between gap-1 text-[0.65rem] uppercase tracking-[0.06em] text-[var(--text-muted)]">
              {ticks.map((tick, i) => (
                <span
                  key={`${tick.scope}-${i}`}
                  style={{
                    flex: '1 1 0',
                    textAlign: i === 0 ? 'left' : i === ticks.length - 1 ? 'right' : 'center',
                    color: i === safeIndex ? 'var(--text)' : 'var(--text-muted)',
                    fontWeight: i === safeIndex ? 600 : 400,
                  }}
                >
                  {tick.label}
                </span>
              ))}
            </div>
          </div>
        ) : null}

        <p className="mt-4 text-sm text-[var(--text-muted)]">
          We&rsquo;ll stop sending you questions about{' '}
          <span className="font-semibold text-[var(--text)]">{selected?.label ?? ''}</span>.
        </p>

        <div className="mt-4 flex flex-col gap-2">
          <button
            type="button"
            className="btn-primary w-full"
            disabled={busy || !selected}
            onClick={() => { if (selected) onExclude(selected); }}
          >
            {busy ? '...' : 'Remove from my topics'}
          </button>
          <button
            type="button"
            className="w-full rounded-[var(--radius-md)] border px-4 py-2 text-sm font-medium text-[var(--text)] hover:bg-[var(--surface-raised)] transition-colors"
            style={{ borderColor: 'var(--border)' }}
            disabled={busy}
            onClick={onSkipOnly}
          >
            Just skip this one
          </button>
          <button
            type="button"
            className="text-sm text-[var(--text-muted)] hover:text-[var(--text)] transition-colors"
            onClick={onCancel}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

export default function DailyPage() {
  const router = useRouter();
  const [queue, setQueue] = useState<QueueResponse | null>(null);
  const [answer, setAnswer] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pausedAfterSlotIndex, setPausedAfterSlotIndex] = useState<number | null>(null);
  const [showUnfamiliarDialog, setShowUnfamiliarDialog] = useState(false);
  const [excludingDomain, setExcludingDomain] = useState(false);
  const [pendingGiveUp, setPendingGiveUp] = useState(false);

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
  const completedCount = queue?.slots.filter((slot) => slot.answered).length ?? 0;
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
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(body?.message ?? 'Could not skip that question.');
      }
      const nextSlots = Array.isArray(body?.slots) ? (body.slots as QueueSlot[]) : null;
      setQueue((existing) => {
        if (!existing) return existing;
        if (nextSlots) return { ...existing, slots: nextSlots };
        return {
          ...existing,
          slots: existing.slots.map((slot) =>
            slot.slot_index === currentSlot.slot_index ? { ...slot, skipped: true } : slot
          ),
        };
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not skip that question.');
    } finally {
      setSubmitting(false);
    }
  }, [currentSlot, queue, submitting]);

  const excludeDomainAndSkip = useCallback(async (tick: ExclusionTick) => {
    if (!currentSlot) return;
    setExcludingDomain(true);
    try {
      await fetch('/api/users/domain-exclusions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ canonical_subcategory: tick.value, scope: tick.scope }),
      });
      // Subcategory exclusions also need to drop the domain from the user's
      // selectedDomains list in Custom mode so today's queue rebuild can't
      // re-pull it; broader scopes are filtered out by getKnowledgeBase via
      // userDomainExclusions and don't touch selectedDomains.
      if (tick.scope === 'subcategory') {
        try {
          const prefsResponse = await fetch('/api/daily/preferences', { credentials: 'include' });
          if (prefsResponse.ok) {
            const prefsBody = await prefsResponse.json().catch(() => null) as {
              preferences: { domainMode: string; selectedDomains: string[] };
              domains: Array<{ domain: string }>;
            } | null;
            if (prefsBody && prefsBody.preferences.domainMode === 'custom') {
              const nextDomains = prefsBody.preferences.selectedDomains.filter((d) => d !== tick.value);
              if (nextDomains.length > 0 && nextDomains.length !== prefsBody.preferences.selectedDomains.length) {
                await fetch('/api/daily/preferences', {
                  method: 'PATCH',
                  headers: { 'content-type': 'application/json' },
                  credentials: 'include',
                  body: JSON.stringify({ domainMode: 'custom', selectedDomains: nextDomains }),
                });
              }
            }
          }
        } catch {
          // preferences sync is best-effort; the exclusion write above already
          // ensures future queue builds skip this domain.
        }
      }
    } catch {
      // exclusion is best-effort; still skip the slot so the user can move on
    } finally {
      setExcludingDomain(false);
    }
    setShowUnfamiliarDialog(false);
    void skipCurrent();
  }, [currentSlot, skipCurrent]);

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
          breadcrumb: slot.reveal_breadcrumb ?? null,
          copyVariant: slot.slot_index,
          creatorName: slot.source === 'friend' ? (slot.author_name ?? null) : null,
          canonicalSubcategory: slot.domain,
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
          isNew: true,
          badges: questionBadges(slot),
          onDismiss: () => setShowUnfamiliarDialog(true),
          dismissLabel: 'Not familiar with this topic',
          dismissImmediate: false,
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
  }, [allDone, currentSlot?.slot_index, queue, requestRecheck, submitting, answer, pendingGiveUp]);

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
                    reveal_quip: opts.gaveUp ? null : body.consolation ?? body.quip ?? null,
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
        <GeometricProgress
          total={DAILY_QUEUE_SIZE}
          current={Math.min(completedCount + 1, DAILY_QUEUE_SIZE)}
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
          <div className="mt-2 flex items-center justify-end gap-3">
            <button
              type="button"
              className="text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground underline underline-offset-4"
              disabled={submitting}
              onClick={() => void giveUpCurrent()}
            >
              Show me the answer
            </button>
          </div>
        </form>
      ) : null}

      {showUnfamiliarDialog && currentSlot ? (
        <UnfamiliarDialog
          ticks={buildExclusionTicks(currentSlot)}
          busy={excludingDomain || submitting}
          onExclude={(tick) => void excludeDomainAndSkip(tick)}
          onSkipOnly={() => { setShowUnfamiliarDialog(false); void skipCurrent(); }}
          onCancel={() => setShowUnfamiliarDialog(false)}
        />
      ) : null}
    </main>
  );
}
