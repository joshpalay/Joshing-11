'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { X } from 'lucide-react';

import {
  GameplayChatThread,
  newMessageId,
  type ChatMessage,
  type RecheckActionResult,
} from '@/components/play/GameplayChat';
import { pickOpenedTerritoryDomain } from '@/components/feed/territory';
import {
  ANSWER_GRADER_RETRY_MESSAGE,
  AnswerSubmitError,
  submitAnswerWithRetry,
} from '@/lib/answer-submit';
import { GeometricProgress } from '@/components/play/GeometricProgress';
import { AnswerInputBar } from '@/components/play/AnswerInputBar';
import LoadingScreen from '@/components/LoadingScreen';
import { categoryLabel, type InsideJokeKind } from '@/lib/questions-types';
import { DAILY_QUEUE_SIZE, hasPendingSlot, type QueueSlot } from '@/server/daily/types';
import {
  buildSessionCloseLines,
  type SessionSlotSummary,
} from '@/server/mastery/session-close-copy';

function questionBadges(slot: QueueSlot): Array<{ label: string; tone?: 'muted' | 'warning' }> {
  // Figma shows the topic/category as the question chip (not the difficulty tier).
  const category =
    (slot.broad_category && slot.broad_category.trim()) ||
    (slot.category ? categoryLabel(slot.category) : '') ||
    slot.domain;
  const badges: Array<{ label: string; tone?: 'muted' | 'warning' }> = category
    ? [{ label: category }]
    : [];
  // Daily Five +2 bonus slots (D-4 §B) carry presence attribution and are always
  // "accessible" — surface the accessibility badge so the lighter pick reads as
  // a deliberate, easier add rather than a generation miss. The "bonus from a
  // friend's knowledge" framing lives in the attribution line GameplayChat
  // renders above the question (see presenceSourceName).
  if (slot.presence_source_id && slot.difficulty_estimate === 'accessible') {
    badges.push({ label: 'Accessible', tone: 'muted' });
  }
  return badges;
}

type QueueResponse = {
  queue_id: string;
  queue_date: string;
  slots: QueueSlot[];
  is_first_daily?: boolean;
};

// One-time intro shown before a brand-new user's first question, explaining that
// their first five are seeded from the areas they picked in onboarding. The
// server flags the genuinely-first, untouched queue (is_first_daily); this local
// flag is belt-and-suspenders so a pre-answer reload doesn't show it twice.
const FIRST_RUN_INTRO_SEEN_KEY = 'joshing:daily-first-run-intro-seen';

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
  // Present on a 409 'slot_changed': the server's fresh slots, so the client can
  // reconcile a stale snapshot instead of grading against the wrong question.
  slots?: QueueSlot[];
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
  return (
    body?.message ??
    (body?.error ? ANSWER_ERROR_MESSAGES[body.error] : undefined) ??
    'Could not record that answer.'
  );
}

// Daily Five generation can come up short transiently: the queue endpoint
// returns 503 `generation_failed` even for users with a valid knowledge base
// when a round falls below the minimum size. Rather than dumping a bare error,
// auto-retry a few times with backoff and surface a friendly "still working"
// state with the attempt counter (the server has already burned its own
// internal top-up rounds by the time we see this, so these are fresh attempts).
const MAX_QUEUE_CREATE_ATTEMPTS = 4;
const QUEUE_CREATE_BACKOFF_MS = [2000, 4000, 8000];

// Shown after the auto-retries are exhausted — kept warm and retryable rather
// than alarming, since the most common cause is slow generation, not a fault.
const QUEUE_GENERATION_FAILED_MESSAGE =
  "We're still crafting today's bespoke questions and it's taking longer than usual. Give it a moment and try again.";

// Rotated through, fading in and out, while a round is being generated — the
// LoadingScreen cycles these so the wait reads as deliberate craft rather than
// a stall.
const GENERATING_MESSAGES = [
  'Crafting your bespoke questions',
  'Finding the right multitudes',
  'Reading the room',
  'Tuning the difficulty',
];

// Returns the slot the player should be on, or null when the round is over.
// The `!answered && !skipped` predicate is the canonical "pending" definition
// shared with the status API via isRoundComplete (see @/server/daily/types) —
// when nothing is pending we redirect to the summary, and the home card now
// agrees by treating the round as complete instead of offering "Resume".
function currentPendingSlot(slots: QueueSlot[]): QueueSlot | null {
  if (!hasPendingSlot(slots)) return null;
  return slots.find((slot) => !slot.answered && !slot.skipped) ?? null;
}

function sessionCloseLines(slots: QueueSlot[]): {
  scoreLine: string;
  interpretiveLine: string | null;
} {
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
  // Inline answer-bar notice for the grade itself: a warm "retrying…" note while
  // the grader is transiently unavailable, then a terminal "try again later" once
  // the auto-retries are spent. Kept separate from the page-level `error` (which
  // is for queue-load failures and replaces the whole thread) so the question
  // stays on screen and the player can simply resubmit.
  const [submitNotice, setSubmitNotice] = useState<{ tone: 'info' | 'error'; text: string } | null>(
    null,
  );
  // Non-null while we're auto-retrying queue generation; drives the friendly
  // "still working (attempt N/4)" loading label instead of a bare error.
  const [generatingAttempt, setGeneratingAttempt] = useState<number | null>(null);
  const [pausedAfterSlotIndex, setPausedAfterSlotIndex] = useState<number | null>(null);
  const [pendingGiveUp, setPendingGiveUp] = useState(false);
  const [openedTerritoryBySlot, setOpenedTerritoryBySlot] = useState<Record<number, string>>({});
  const [showFirstRunIntro, setShowFirstRunIntro] = useState(false);
  const answerInputRef = useRef<HTMLInputElement>(null);

  // Show the first-run intro once, only for the server-flagged first untouched
  // queue and only if this device hasn't already dismissed it.
  const maybeShowFirstRunIntro = useCallback((firstDaily: boolean | undefined) => {
    if (!firstDaily) return;
    try {
      if (window.localStorage.getItem(FIRST_RUN_INTRO_SEEN_KEY)) return;
    } catch {
      // Private mode / storage disabled: fall through and show it (server already
      // gated on the genuinely-first, untouched queue, so this is still one-time).
    }
    setShowFirstRunIntro(true);
  }, []);

  const dismissFirstRunIntro = useCallback(() => {
    setShowFirstRunIntro(false);
    try {
      window.localStorage.setItem(FIRST_RUN_INTRO_SEEN_KEY, '1');
    } catch {
      // Non-fatal — the server flag won't re-fire once a slot is answered anyway.
    }
  }, []);

  const loadQueue = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/daily/queue', {
        cache: 'no-store',
        credentials: 'include',
      });
      const body = await response.json().catch(() => null);

      if (response.ok && body?.queue === null) {
        // The queue doesn't exist yet — generate it. Generation can fall below
        // the minimum and return 503 (generation_failed) even with a valid
        // knowledge base, so auto-retry with backoff while showing the friendly
        // "still working" state. 409 (no_knowledge_base) means the user
        // genuinely has nothing to generate from — that's terminal; send them
        // to setup rather than retrying.
        for (let attempt = 1; attempt <= MAX_QUEUE_CREATE_ATTEMPTS; attempt += 1) {
          setGeneratingAttempt(attempt);
          const createResponse = await fetch('/api/daily/queue', {
            method: 'POST',
            credentials: 'include',
            cache: 'no-store',
          });
          if (createResponse.ok) break;

          const createBody = await createResponse.json().catch(() => null);
          if (createResponse.status === 409) {
            router.replace('/daily/setup');
            return;
          }
          // Only the transient generation_failed (503) is worth retrying; a
          // different status is a real fault, so surface its message and stop.
          if (createResponse.status !== 503) {
            throw new Error(createBody?.message ?? 'Could not load today.');
          }
          // Out of retries: fall back to the warm, retryable message.
          if (attempt === MAX_QUEUE_CREATE_ATTEMPTS) {
            throw new Error(QUEUE_GENERATION_FAILED_MESSAGE);
          }
          await new Promise((resolve) =>
            setTimeout(
              resolve,
              QUEUE_CREATE_BACKOFF_MS[attempt - 1] ??
                QUEUE_CREATE_BACKOFF_MS[QUEUE_CREATE_BACKOFF_MS.length - 1],
            ),
          );
        }
        setGeneratingAttempt(null);
        const refetchResponse = await fetch('/api/daily/queue', {
          cache: 'no-store',
          credentials: 'include',
        });
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
        setQueue({
          queue_id: refetchBody.queue_id,
          queue_date: refetchBody.queue_date,
          slots: refetchSlots,
        });
        maybeShowFirstRunIntro(refetchBody.is_first_daily);
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
      maybeShowFirstRunIntro(body.is_first_daily);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not load today.');
    } finally {
      setGeneratingAttempt(null);
      setLoading(false);
    }
  }, [router, maybeShowFirstRunIntro]);

  useEffect(() => {
    const initialTimer = window.setTimeout(() => {
      void loadQueue();
    }, 0);

    return () => window.clearTimeout(initialTimer);
  }, [loadQueue]);

  const actualCurrentSlot = useMemo(() => currentPendingSlot(queue?.slots ?? []), [queue?.slots]);
  const currentSlot = pausedAfterSlotIndex === null ? actualCurrentSlot : null;
  const completedCount = queue?.slots.filter((slot) => slot.answered).length ?? 0;
  // Use the ACTUAL queue length, not DAILY_QUEUE_SIZE — a low-yield domain can
  // produce a graceful-degraded shorter queue, and the progress dots should
  // match the real number of questions rather than always showing five.
  const queueLength = queue && queue.slots.length > 0 ? queue.slots.length : DAILY_QUEUE_SIZE;
  const allDone = Boolean(queue && queue.slots.length > 0 && !actualCurrentSlot);

  const requestRecheck = useCallback(
    async (slotIndex: number): Promise<RecheckActionResult> => {
      if (!queue) throw new Error('No active queue');

      const response = await fetch('/api/daily/recheck', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ queue_id: queue.queue_id, slot_index: slotIndex }),
      });
      const body = (await response.json().catch(() => null)) as
        | RecheckResponse
        | FailedAnswerResponse
        | null;

      if (!response.ok) {
        throw new Error(
          body && 'message' in body && body.message
            ? body.message
            : 'Could not recheck that answer.',
        );
      }

      const accepted = Boolean(body && 'accepted' in body && body.accepted);
      const status = body && 'status' in body ? body.status : accepted ? 'accepted' : 'rejected';
      const reason = body && 'reason' in body && body.reason ? body.reason : null;
      const pointsAwarded =
        body && 'pointsAwarded' in body && typeof body.pointsAwarded === 'number'
          ? body.pointsAwarded
          : 0;
      const correctAnswer =
        body && 'correctAnswer' in body && body.correctAnswer ? body.correctAnswer : undefined;

      setQueue((existing) =>
        existing
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
                  : slot,
              ),
            }
          : existing,
      );

      if (accepted) {
        return {
          accepted: true,
          message: `Recheck accepted — +${pointsAwarded} ${pointsAwarded === 1 ? 'point' : 'points'}.`,
        };
      }
      if (status === 'needs_human') {
        return { accepted: false, message: reason ?? 'Flagged for a human look.' };
      }
      return { accepted: false, message: reason ?? 'Rechecked and still marked wrong.' };
    },
    [queue],
  );

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
          presenceSourceName: slot.presence_source_name ?? null,
          presenceSourceExtraCount: slot.presence_source_extra_count ?? 0,
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
          // Show the canonical answer on every reveal — including correct ones
          // — so it appears as the headline inside the result card.
          correctAnswer: slot.reveal_canonical_answer ?? null,
          consolation: slot.reveal_quip ?? null,
          insideJoke: slot.reveal_inside_joke ?? null,
          insideJokeKind: slot.reveal_inside_joke_kind ?? null,
          authorNote:
            slot.source === 'friend' || slot.source === 'house' ? (slot.author_note ?? null) : null,
          breadcrumb: slot.reveal_breadcrumb ?? null,
          explanation: slot.reveal_explainer ?? null,
          copyVariant: slot.slot_index,
          // D-3: house core slots surface the 'Joshing' name + Editorial badge
          // (creatorIsHouse), rendered non-relationally by GameplayChat.
          creatorName:
            slot.source === 'friend' || slot.source === 'house' ? (slot.author_name ?? null) : null,
          creatorIsHouse: slot.source === 'house',
          canonicalSubcategory: slot.domain,
          openedTerritoryDomain: openedTerritoryBySlot[slot.slot_index] ?? null,
          recheckAction:
            slot.answer_state === 'incorrect' && !gaveUp && !slot.recheck_status
              ? { onSubmit: () => requestRecheck(slot.slot_index) }
              : null,
        });
        continue;
      }
      if (slot.skipped) {
        // A rested bonus slot ("This is {Name}'s bag but not mine") is closed via
        // the same skip path, but it's an opt-out, not a "bring it back later" —
        // so it gets its own copy naming the category we've stopped surfacing.
        const restedLabel =
          (slot.broad_category && slot.broad_category.trim()) ||
          (slot.category ? categoryLabel(slot.category) : '') ||
          slot.domain;
        rows.push({
          id: `s-${slot.slot_index}`,
          kind: 'system',
          text: slot.presence_source_name
            ? `Resting ${restedLabel}. You won't see these in your five.`
            : "Skipped. We'll bring it back later.",
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
          presenceSourceName: slot.presence_source_name ?? null,
          presenceSourceExtraCount: slot.presence_source_extra_count ?? 0,
          isNew: true,
          badges: questionBadges(slot),
        });
        if (submitting && answer.trim()) {
          rows.push({ id: 'u-pending', kind: 'user', text: answer.trim() });
          rows.push({ id: 'grading', kind: 'typing' });
        } else if (pendingGiveUp) {
          // "Show me the answer" is not a graded submission — there's nothing to
          // check, so skip the "Grading..." indicator and go straight to the
          // reveal (the answered slot rebuilds with the gave_up result row).
          rows.push({ id: 'u-pending-giveup', kind: 'user', text: 'show me the answer' });
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
  }, [
    allDone,
    currentSlot?.slot_index,
    queue,
    requestRecheck,
    submitting,
    answer,
    pendingGiveUp,
    openedTerritoryBySlot,
  ]);

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

  const postAnswer = useCallback(
    async (opts: { submittedAnswer: string; gaveUp: boolean }) => {
      if (!queue || !currentSlot || submitting) return;
      setSubmitting(true);
      setError(null);
      setSubmitNotice(null);
      try {
        // The grader is allowed to be transiently unavailable (it returns a
        // retryable 503 rather than ever scoring a real player wrong). Auto-retry
        // those with backoff, showing a warm "retrying…" notice, and only ask the
        // player to try again later once the retries are spent.
        const body = await submitAnswerWithRetry<AnswerResponse>('/api/daily/answer', {
          body: {
            queue_id: queue.queue_id,
            slot_index: currentSlot.slot_index,
            // Pin the question this slot is displaying so the server won't grade
            // a stale slot_index against a different question (see the answer
            // route's identity guard). Bot slots carry generated_question_id,
            // friend/house slots carry question_id.
            expected_question_id:
              currentSlot.generated_question_id ?? currentSlot.question_id,
            submitted_answer: opts.submittedAnswer,
            gave_up: opts.gaveUp,
          },
          isSuccessBody: (value): value is AnswerResponse =>
            value != null && typeof value === 'object',
          resolveErrorMessage: (value) =>
            answerFailureMessage(value as FailedAnswerResponse | null),
          onRetry: ({ attempt, maxAttempts }) =>
            setSubmitNotice({
              tone: 'info',
              text: `${ANSWER_GRADER_RETRY_MESSAGE} (${attempt}/${maxAttempts})…`,
            }),
        });
        setSubmitNotice(null);

        const isCorrect = Boolean(body.isCorrect ?? body.correct);
        // A correct answer in an unfamiliar domain default-adds it to the KB
        // (B-1). The server reports the freshly-opened domain on masteryDelta;
        // stash it per-slot so the reveal can surface the "Added — remove?" undo.
        // Client-only — deliberately not persisted into the QueueSlot schema.
        const masteryDelta = body.masteryDelta ?? body.mastery_delta;
        const openedDomain = isCorrect ? pickOpenedTerritoryDomain(masteryDelta) : null;
        if (openedDomain) {
          setOpenedTerritoryBySlot((existing) => ({
            ...existing,
            [currentSlot.slot_index]: openedDomain,
          }));
        }
        setQueue((existing) =>
          existing
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
                        reveal_quip: opts.gaveUp ? null : (body.consolation ?? null),
                        reveal_inside_joke: body.insideJoke ?? null,
                        reveal_inside_joke_kind: body.insideJokeKind ?? null,
                      }
                    : slot,
                ),
              }
            : existing,
        );
        setPausedAfterSlotIndex(currentSlot.slot_index);
        window.setTimeout(() => setPausedAfterSlotIndex(null), 850);
        setAnswer('');
      } catch (caught) {
        // Stale snapshot: the slot moved on under us (the queue was re-indexed
        // after we loaded it). The server returned 409 slot_changed with its
        // fresh slots — reconcile to those and let the corrected current question
        // re-render rather than surfacing an error or recording a bogus miss.
        // Clear the input since the refreshed question is a different prompt.
        if (caught instanceof AnswerSubmitError) {
          const failed = caught.body as FailedAnswerResponse | null;
          if (failed?.error === 'slot_changed' && Array.isArray(failed.slots)) {
            const reconciledSlots = failed.slots;
            setQueue((existing) =>
              existing ? { ...existing, slots: reconciledSlots } : existing,
            );
            setAnswer('');
            setSubmitNotice(null);
            return;
          }
        }
        setSubmitNotice({
          tone: 'error',
          text: caught instanceof Error ? caught.message : 'Could not record that answer.',
        });
      } finally {
        setSubmitting(false);
      }
    },
    [currentSlot, queue, submitting],
  );

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

  // Bonus slots only (D-4 §B): "This is {Name}'s bag but not mine". Rests the
  // slot's domain so the category stops surfacing in future rounds, and closes
  // this bonus question (a skip — bonus slots are additive, so closing one never
  // drops the round below the core five). Optimistic: the slot is marked skipped
  // immediately, then reverted if either request fails.
  const muteBonusDomain = useCallback(async () => {
    if (!queue || !currentSlot || submitting) return;
    const slotIndex = currentSlot.slot_index;
    const { domain } = currentSlot;
    setError(null);
    setQueue((existing) =>
      existing
        ? {
            ...existing,
            slots: existing.slots.map((slot) =>
              slot.slot_index === slotIndex ? { ...slot, skipped: true } : slot,
            ),
          }
        : existing,
    );
    try {
      // Rest the category (durable preference). Best-effort, but the skip below
      // is what actually closes this question, so a failure here still throws.
      const restResponse = await fetch('/api/daily/preferences/domain-frequency', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ domain, frequency: 'resting' }),
      });
      if (!restResponse.ok) throw new Error('Could not update that category.');

      const skipResponse = await fetch('/api/daily/skip', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ queue_id: queue.queue_id, slot_index: slotIndex }),
      });
      if (!skipResponse.ok) throw new Error('Could not close that question.');
      const body = (await skipResponse.json().catch(() => null)) as { slots?: QueueSlot[] } | null;
      if (Array.isArray(body?.slots)) {
        const nextSlots = body.slots;
        setQueue((existing) => (existing ? { ...existing, slots: nextSlots } : existing));
      }
    } catch (caught) {
      // Revert the optimistic skip so the question stays answerable.
      setQueue((existing) =>
        existing
          ? {
              ...existing,
              slots: existing.slots.map((slot) =>
                slot.slot_index === slotIndex ? { ...slot, skipped: false } : slot,
              ),
            }
          : existing,
      );
      setError(caught instanceof Error ? caught.message : 'Could not update that category.');
    }
  }, [queue, currentSlot, submitting]);

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
            <p className="text-xs tracking-[0.1em] text-[var(--text-muted)] uppercase">
              Daily Five
            </p>
            <h1 className="font-serif text-xl font-semibold text-[var(--text)]">
              Today&apos;s five
            </h1>
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
            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md text-[var(--text-muted)] transition hover:bg-[var(--surface-2)] hover:text-[var(--text)] focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:outline-none"
          >
            <X className="size-5" strokeWidth={1.9} />
          </Link>
        </div>
      </header>

      <section
        className="flex-1 overflow-y-auto px-4 py-4"
        style={{
          paddingBottom:
            currentSlot && !loading
              ? 'calc(120px + env(safe-area-inset-bottom))'
              : 'calc(24px + env(safe-area-inset-bottom))',
        }}
      >
        {loading ? (
          generatingAttempt != null ? (
            <LoadingScreen fullScreen messages={GENERATING_MESSAGES} />
          ) : (
            <LoadingScreen fullScreen label="Loading today" />
          )
        ) : error ? (
          // Generation hiccups are warm and retryable, not alarming — keep this
          // neutral (not --danger) and give the player a one-tap way to retry.
          <div
            className="flex flex-col items-start gap-3 rounded-[var(--radius-sm)] border px-3 py-3 text-sm text-[var(--text)]"
            style={{ borderColor: 'var(--border)', background: 'var(--surface-2)' }}
          >
            <p className="text-[var(--text-muted)]">{error}</p>
            <button
              type="button"
              onClick={() => void loadQueue()}
              className="inline-flex min-h-11 items-center rounded-md border px-3 py-1.5 text-sm font-medium text-[var(--text)] transition hover:bg-[var(--surface)] focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:outline-none"
              style={{ borderColor: 'var(--border)' }}
            >
              Try again
            </button>
          </div>
        ) : (
          <GameplayChatThread
            messages={messages}
            onGiveUp={() => void giveUpCurrent()}
            giveUpDisabled={submitting}
            onMutePresence={() => void muteBonusDomain()}
            muteDisabled={submitting}
          />
        )}
      </section>

      {currentSlot && !loading ? (
        <AnswerInputBar
          value={answer}
          onChange={setAnswer}
          onSubmit={submitAnswer}
          submitting={submitting}
          inputRef={answerInputRef}
          notice={submitNotice}
        />
      ) : null}

      {showFirstRunIntro ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="first-run-intro-title"
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
          onClick={(e) => {
            if (e.target === e.currentTarget) dismissFirstRunIntro();
          }}
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
            <p
              id="first-run-intro-title"
              className="font-serif text-lg font-semibold text-[var(--text)]"
            >
              Your first five
            </p>
            <p className="mt-2 text-sm leading-6 text-[var(--text-muted)]">
              Your first five are drawn from the areas you picked. Answer however you&rsquo;d
              naturally say it.
            </p>
            <button
              type="button"
              className="btn-primary mt-5 w-full"
              onClick={dismissFirstRunIntro}
            >
              Start
            </button>
          </div>
        </div>
      ) : null}
    </main>
  );
}
