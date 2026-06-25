'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  newMessageId,
  type ChatMessage,
  type RecheckAction,
  type RecheckActionResult,
} from '@/components/play/GameplayChat';
import { parseCatchupItemId } from '@/server/daily/catchup';
import { CATCH_UP_BATCH_SIZE } from '@/lib/game-constants';
import { difficultyEstimateToTierLabel } from '@/lib/questions/difficulty-tier';
import { LLM_QUESTION_ATTRIBUTION, type InsideJokeKind } from '@/lib/questions-types';
import {
  parseCatchUpAnswerErrorBody,
  userFacingCatchUpSubmitMessage,
  type CatchUpSubmitParsedError,
} from '@/server/play/catch-up-submit-error';
import { shouldIntroduceCatchUpQuestion } from '@/server/play/catch-up-turn-sequencing';
import { type ReportReasonTarget } from '@/components/report/ReportReasonSheet';

export type CatchupQueueItem = {
  dailyQueueItemId: string;
  questionId: string;
  questionText: string;
  correctAnswer: string;
  alternateAnswers: string[];
  explanation: string | null;
  domain: string;
  domainDisplayName: string;
  queueDate: string;
  queueAge: number;
  wasSkipped: boolean;
  expiresAt: string;
  expiresSoon?: boolean;
  difficultyEstimate?: 'accessible' | 'moderate' | 'specialist' | null;
  /** Human author's name, the house name ('Joshing'), or null for LLM-origin questions (rendered non-relationally). */
  authorName?: string | null;
  /** Human author's `users.id`, so the recap can link the name to their profile. Null for house/LLM-origin. */
  authorId?: string | null;
  /** D-3: the author is the non-human house/editorial author (renders the Editorial badge, no relational copy). */
  authorIsHouse?: boolean;
  /**
   * Content-report target for the recap ⋯ menu. Curated/bank + feed items carry
   * `questionId`; LLM-origin daily items carry `generatedQuestionId`. Optional so a
   * stale client payload without it just hides the report menu rather than crashing.
   */
  reportTarget?: ReportReasonTarget;
};

export type CatchupAnswerResponse = {
  result?: 'correct' | 'wrong';
  isCorrect?: boolean;
  correct?: boolean;
  pointsAwarded?: number;
  awarded_points?: number;
  correctAnswer?: string;
  answer?: string;
  explanation?: string | null;
  explainer?: string | null;
  consolation?: string | null;
  breadcrumb?: string | null;
  // B-7/B-9: author commentary + aside travel with the question into catch-up,
  // gated server-side by selectInsideJokeForViewer (same provenance-calibrated
  // label and display gate as the live path). The server emits `creatorNote`,
  // which maps to the message's `authorNote` (matching the live path field name
  // so GameplayChat renders it with no special-casing).
  creatorNote?: string | null;
  insideJoke?: string | null;
  insideJokeKind?: InsideJokeKind | null;
  nextItem?: CatchupQueueItem | null;
};

type CatchupLoadResponse = {
  items?: CatchupQueueItem[];
  questions?: CatchupQueueItem[];
  introCopy?: string;
};

// Shape returned by POST /api/daily/recheck. Catch-up reuses that route for
// daily-queue-backed items (their dailyQueueItemId is `${queueId}:${slotIndex}`,
// exactly the route's inputs); feed-backed catch-up items are not rechecked here.
type DailyRecheckResponse = {
  accepted?: boolean;
  status?: string;
  reason?: string | null;
  pointsAwarded?: number;
  correctAnswer?: string;
  message?: string;
};

export type CatchupStats = {
  answered: number;
  correct: number;
  dismissed: number;
};

/** Per-question recap entry, used to render the round summary (Daily Five style). */
export type CatchupBatchRecord = {
  questionId: string;
  questionText: string;
  outcome: 'correct' | 'wrong' | 'revealed';
  submittedAnswer: string | null;
  correctAnswer: string;
  explanation: string | null;
  domainDisplayName: string;
  authorName: string | null;
  /** Human author's `users.id` for the recap profile link. Null for house/LLM-origin. */
  authorId: string | null;
  authorIsHouse: boolean;
  /**
   * Author's "why I asked" commentary. The live thread defers this to keep its
   * momentum (it shows at most one light reflection), so the round recap carries
   * the fuller note here so it is never lost.
   */
  authorNote: string | null;
  /**
   * Content-report target the recap ⋯ menu reports against. Threaded from the
   * queue item so "This is incorrect" / "This is inappropriate" land a
   * ContentReport on the right FK. Null when the item arrived without one.
   */
  reportTarget: ReportReasonTarget | null;
};

/**
 * 'playing' — the round's chat thread + answer input is live.
 * 'round_complete' — the round is done; the thread stays up and closes with a
 *   card offering the recap or another round (mirroring the Daily Five
 *   session-close turn) instead of cutting straight to the recap.
 * 'summary' — show the recap with "play next" / "return home".
 */
export type CatchupPhase = 'playing' | 'round_complete' | 'summary';

function formatQuestionSubhead(item: CatchupQueueItem): string {
  if (item.queueAge <= 1) return 'FROM YESTERDAY';
  if (item.queueAge > 1 && item.queueAge <= 6) return `FROM ${item.queueAge} DAYS AGO`;

  const date = new Date(`${item.queueDate}T12:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return 'FROM EARLIER';
  return `FROM ${new Intl.DateTimeFormat('en-US', { weekday: 'long' }).format(date).toUpperCase()}`;
}

// Builds the result-turn message a catch-up answer produces, mapping the
// server's provenance-resolved commentary + aside onto the exact field names
// GameplayChat renders (B-9). Extracted as a pure function so a test can assert
// these values reach the render layer — the B-7 regression was that the inline
// builder set creatorName/creatorIsHouse but silently dropped the note/aside,
// and a green route test never caught it because it asserted on the route JSON
// the player never sees, not the message the hook builds.
export function buildCatchupResultMessage(params: {
  id: string;
  item: CatchupQueueItem;
  data: CatchupAnswerResponse;
  isCorrect: boolean;
  submittedAnswer: string;
  pointsAwarded: number;
  // Wrong daily-slot answers carry a recheck affordance (reused from the live
  // Daily Five thread). Correct answers and feed-backed items pass null.
  recheckAction?: RecheckAction | null;
}): Extract<ChatMessage, { kind: 'result' }> {
  const { id, item, data, isCorrect, submittedAnswer, pointsAwarded, recheckAction } = params;
  return {
    id,
    kind: 'result',
    assignmentId: item.dailyQueueItemId,
    questionText: item.questionText,
    result: isCorrect ? 'correct' : 'wrong',
    submitted: submittedAnswer,
    correctAnswer: data.correctAnswer ?? data.answer ?? item.correctAnswer,
    consolation: data.consolation ?? null,
    breadcrumb: null,
    explanation: data.explanation ?? data.explainer ?? item.explanation ?? null,
    copyVariant: item.queueAge,
    creatorName: item.authorName ?? LLM_QUESTION_ATTRIBUTION,
    creatorIsHouse: item.authorIsHouse ?? false,
    // B-9: surface the server's provenance-resolved commentary + aside.
    // GameplayChat renders `authorNote` (live path maps server `creatorNote`
    // to this name) and gates the aside via insideJoke/insideJokeKind, which
    // the route already calibrated through selectInsideJokeForViewer.
    authorNote: data.creatorNote ?? null,
    insideJoke: data.insideJoke ?? null,
    insideJokeKind: data.insideJokeKind ?? null,
    canonicalSubcategory: item.domain,
    pointsAwarded,
    pointsLabel: 'Catch-up - 0.25x points',
    recheckAction: recheckAction ?? null,
  };
}

function questionMessage(item: CatchupQueueItem, position: number): ChatMessage {
  const badges: NonNullable<Extract<ChatMessage, { kind: 'question' }>['badges']> = [];
  const tier = difficultyEstimateToTierLabel(item.difficultyEstimate);
  if (tier) badges.push({ label: tier });
  if (item.wasSkipped) badges.push({ label: 'you skipped this', tone: 'muted' });
  if (item.expiresSoon) badges.push({ label: 'expires tomorrow', tone: 'warning' });

  return {
    id: `catchup-q-${item.dailyQueueItemId}`,
    kind: 'question',
    assignmentId: item.dailyQueueItemId,
    questionText: item.questionText,
    creatorName: item.authorName ?? LLM_QUESTION_ATTRIBUTION,
    creatorIsHouse: item.authorIsHouse ?? false,
    subhead: formatQuestionSubhead(item),
    // B-GAMEPLAY-QUESTION-NUMBER-BOX-01: the same editorial number marker the
    // Daily Five shows in the gutter above each card. Catch-up plays in rounds of
    // up to CATCH_UP_BATCH_SIZE, so `position` is the question's 1-based slot in
    // the current round. Catch-up has no bonus questions, so `bonus` is never set.
    numberMarker: { value: position, bonus: false },
    badges,
  };
}

// Once the player engages the next turn (answers, skips, or dismisses again), a
// lingering "Removed from catch up · Undo" notice is retired to a plain
// "Removed from catch up." line so undo can't rewind across a resolved turn.
function retireDismissNotices(messages: ChatMessage[]): ChatMessage[] {
  return messages.map((message) =>
    message.kind === 'dismiss_notice'
      ? { id: message.id, kind: 'system' as const, text: 'Removed from catch up.' }
      : message,
  );
}

// Rebuilds the introduced/result-posted sequencing sets from a thread, used
// after an undo drops the notice: every still-shown question is "introduced",
// and a question is "resolved" once it has a result after it. A dismissed
// question's card is removed from the thread entirely, so it appears in neither
// set and gets re-introduced cleanly when the queue reaches it again.
function deriveCatchupRefs(messages: ChatMessage[]): { introduced: Set<string>; resultPosted: Set<string> } {
  const introduced = new Set<string>();
  const resultPosted = new Set<string>();
  for (const message of messages) {
    if (message.kind === 'question') {
      introduced.add(message.assignmentId);
    } else if (message.kind === 'result') {
      resultPosted.add(message.assignmentId);
    }
  }
  return { introduced, resultPosted };
}

// A failed submit/dismiss falls into one of three buckets, each of which gets a
// different response so a single stale item never blows away an in-progress
// round (the "That question moved on" full-screen wipe regression):
//  - 'stale_item' — this one question moved on (resolved elsewhere, window
//    closed, no longer yours). Drop it inline and keep the round going.
//  - 'transient'  — the server is briefly unavailable (grader breather, bad
//    body, network blip). Keep the question on screen so it can be retried.
//  - 'fatal'      — a session/load-level failure that genuinely ends the round.
type CatchupErrorClass = 'stale_item' | 'transient' | 'fatal';

function classifyCatchupSubmitError(parsed: CatchUpSubmitParsedError): CatchupErrorClass {
  // The server flags every per-item "your list changed underneath you" case with
  // next_action: 'refetch_missed'; trust that first, then fall back to the code.
  if (parsed.next_action === 'refetch_missed') return 'stale_item';
  switch (parsed.code) {
    case 'assignment_not_found':
    case 'not_found':
    case 'forbidden':
    case 'forbidden_assignment':
    case 'catch_up_window_closed':
    case 'catch_up_not_eligible':
    case 'invalid_state':
      return 'stale_item';
    case 'grader_unavailable':
    case 'network':
    case 'parse_failed':
      return 'transient';
    default:
      return 'fatal';
  }
}

export function useCatchupFlow() {
  const [items, setItems] = useState<CatchupQueueItem[]>([]);
  const [initialTotal, setInitialTotal] = useState(0);
  const [introCopy, setIntroCopy] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [isResolvingTurn, setIsResolvingTurn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<CatchupStats>({ answered: 0, correct: 0, dismissed: 0 });
  const [phase, setPhase] = useState<CatchupPhase>('playing');
  const [batchRecords, setBatchRecords] = useState<CatchupBatchRecord[]>([]);

  const introducedItemIdsRef = useRef<Set<string>>(new Set());
  const resultPostedItemIdsRef = useRef<Set<string>>(new Set());
  // Number of items remaining when the current round started, so the round size
  // is min(CATCH_UP_BATCH_SIZE, that) and we know when the round is full.
  const batchStartRemainingRef = useRef(0);
  const answeredInBatchRef = useRef(0);

  const currentItem = items[0] ?? null;
  const completed = !loading && initialTotal > 0 && items.length === 0;
  const remainingCount = items.length;
  const nextBatchSize = Math.min(CATCH_UP_BATCH_SIZE, remainingCount);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/daily/catchup', {
        cache: 'no-store',
        credentials: 'include',
      });
      const raw = await response.json().catch(() => null);
      if (!response.ok) throw new Error(userFacingCatchUpSubmitMessage(parseCatchUpAnswerErrorBody(raw)));
      const data = raw as CatchupLoadResponse | null;
      const nextItems = data?.items ?? data?.questions ?? [];
      setItems(nextItems);
      setInitialTotal(nextItems.length);
      setIntroCopy(data?.introCopy ?? '');
      setMessages([]);
      setStats({ answered: 0, correct: 0, dismissed: 0 });
      setPhase('playing');
      setBatchRecords([]);
      batchStartRemainingRef.current = nextItems.length;
      answeredInBatchRef.current = 0;
      introducedItemIdsRef.current = new Set();
      resultPostedItemIdsRef.current = new Set();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not load catch-up.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Kick off the initial load via a nested async fn so load()'s synchronous
    // loading/error state isn't set directly in the effect body (which the
    // react-hooks set-state-in-effect rule flags).
    void (async () => {
      await load();
    })();
  }, [load]);

  useEffect(() => {
    const id = currentItem?.dailyQueueItemId ?? null;
    if (!currentItem) return;
    // Don't introduce the next round's first question while the round-close
    // card or the summary is up; it gets introduced when startNextBatch flips
    // the phase back to 'playing'.
    if (phase !== 'playing') return;
    if (!shouldIntroduceCatchUpQuestion({
      currentCatchUpItemId: id,
      loading,
      isResolvingTurn,
      introducedItemIds: introducedItemIdsRef.current,
      resultPostedItemIds: resultPostedItemIdsRef.current,
    })) return;

    introducedItemIdsRef.current.add(currentItem.dailyQueueItemId);
    // 1-based position within the current round: the count already resolved this
    // round, plus this one. Matches the Daily Five's 1.–5. numbering.
    const position = answeredInBatchRef.current + 1;
    setMessages((existing) => [...existing, questionMessage(currentItem, position)]);
  }, [currentItem, isResolvingTurn, loading, phase]);

  const advancePast = useCallback((dailyQueueItemId: string) => {
    setItems((existing) => existing.filter((item) => item.dailyQueueItemId !== dailyQueueItemId));
  }, []);

  // Records the resolved turn and, once the round is full, closes the round
  // (the thread stays up with the round-close options; the recap is opened
  // explicitly via openSummary). Called from inside the post-result timeout in
  // both submit and give-up.
  const finishTurn = useCallback((dailyQueueItemId: string, record: CatchupBatchRecord) => {
    answeredInBatchRef.current += 1;
    setBatchRecords((existing) => [...existing, record]);
    advancePast(dailyQueueItemId);
    setIsResolvingTurn(false);
    const roundSize = Math.min(CATCH_UP_BATCH_SIZE, batchStartRemainingRef.current);
    if (answeredInBatchRef.current >= roundSize) {
      setPhase('round_complete');
    }
  }, [advancePast]);

  // Moves from the round-close card to the full recap.
  const openSummary = useCallback(() => {
    setPhase('summary');
  }, []);

  // Begins the next round: clears the thread + recap and re-enters 'playing',
  // which re-introduces the next current question via the effect above.
  const startNextBatch = useCallback(() => {
    if (items.length === 0) return;
    batchStartRemainingRef.current = items.length;
    answeredInBatchRef.current = 0;
    setBatchRecords([]);
    setMessages([]);
    setPhase('playing');
  }, [items.length]);

  // Retires a question that the server no longer recognises (it moved on between
  // load and submit) without tearing down the round: drop a quiet inline note,
  // advance past it, and let the sequencing effect introduce the next one. The
  // vanished item never belonged to this round's answerable set, so the round
  // target shrinks with it (and it gets no recap card).
  const dropStaleItem = useCallback((staleId: string, notice: string) => {
    resultPostedItemIdsRef.current.add(staleId);
    setMessages((existing) => [
      ...retireDismissNotices(existing),
      { id: newMessageId(), kind: 'system' as const, text: notice },
    ]);
    const emptiesQueue = items.length <= 1;
    advancePast(staleId);
    setIsResolvingTurn(false);
    batchStartRemainingRef.current = Math.max(0, batchStartRemainingRef.current - 1);
    const roundSize = Math.min(CATCH_UP_BATCH_SIZE, batchStartRemainingRef.current);
    // End the round if the queue is now empty (otherwise the thread dead-ends
    // with no current question and no input) or the shrunken target is met.
    if (emptiesQueue || answeredInBatchRef.current >= roundSize) {
      setPhase('round_complete');
    }
  }, [advancePast, items.length]);

  // Single place that decides how a submit/dismiss failure is surfaced, so the
  // three error classes stay consistent across both call sites.
  const applyCatchupSubmitFailure = useCallback((item: CatchupQueueItem, parsed: CatchUpSubmitParsedError) => {
    const message = userFacingCatchUpSubmitMessage(parsed);
    switch (classifyCatchupSubmitError(parsed)) {
      case 'stale_item':
        dropStaleItem(item.dailyQueueItemId, message);
        return;
      case 'transient':
        // Keep the question in place so the same answer can be retried; surface
        // the reason as an inline line rather than a full-screen takeover.
        setIsResolvingTurn(false);
        setMessages((existing) => [
          ...retireDismissNotices(existing),
          { id: newMessageId(), kind: 'system' as const, text: message },
        ]);
        return;
      default:
        // Session/load-level failure: the full-screen error + Retry is right.
        setIsResolvingTurn(false);
        setError(message);
    }
  }, [dropStaleItem]);

  const skipCurrent = useCallback(() => {
    if (!currentItem || submitting || isResolvingTurn) return;
    const item = currentItem;
    resultPostedItemIdsRef.current.add(item.dailyQueueItemId);
    setIsResolvingTurn(true);
    setMessages((existing) => [
      ...retireDismissNotices(existing),
      { id: newMessageId(), kind: 'user', text: 'i give up' },
      {
        id: newMessageId(),
        kind: 'result',
        assignmentId: item.dailyQueueItemId,
        questionText: item.questionText,
        result: 'gave_up',
        submitted: '',
        correctAnswer: item.correctAnswer,
        consolation: null,
        breadcrumb: null,
        copyVariant: item.queueAge,
        creatorName: item.authorName ?? LLM_QUESTION_ATTRIBUTION,
        creatorIsHouse: item.authorIsHouse ?? false,
        canonicalSubcategory: item.domain,
      },
    ]);
    window.setTimeout(() => {
      finishTurn(item.dailyQueueItemId, {
        questionId: item.questionId,
        questionText: item.questionText,
        outcome: 'revealed',
        submittedAnswer: null,
        correctAnswer: item.correctAnswer,
        explanation: item.explanation,
        domainDisplayName: item.domainDisplayName,
        authorName: item.authorName ?? null,
        authorId: item.authorId ?? null,
        authorIsHouse: item.authorIsHouse ?? false,
        authorNote: null,
        reportTarget: item.reportTarget ?? null,
      });
    }, 1200);
  }, [currentItem, finishTurn, isResolvingTurn, submitting]);

  // Reverses a dismissal: un-dismisses server-side, then drops the notice and
  // puts the item back at the front of the queue so the introduce effect re-adds
  // its card as the active question. (The card was removed from the thread on
  // dismiss, so there is nothing to un-fade.) Throws on failure so the notice
  // row can surface a retry without losing the dismissal.
  const undismissItem = useCallback(async (item: CatchupQueueItem) => {
    const itemId = item.dailyQueueItemId;
    setSubmitting(true);
    try {
      const response = await fetch('/api/daily/catchup/undismiss', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ dailyQueueItemId: itemId }),
      });
      if (!response.ok) {
        const raw = await response.json().catch(() => null);
        throw new Error(userFacingCatchUpSubmitMessage(parseCatchUpAnswerErrorBody(raw)));
      }
      setStats((existing) => ({ ...existing, dismissed: Math.max(0, existing.dismissed - 1) }));
      setItems((existing) => [item, ...existing.filter((entry) => entry.dailyQueueItemId !== itemId)]);
      // Undo returns this question to the answerable round, so restore the round
      // target and re-enter 'playing' (a dismissal of the last item may have
      // closed the round — see dismissCurrent / PLR-17).
      batchStartRemainingRef.current += 1;
      setPhase('playing');
      setMessages((existing) => {
        // Drop the active "Removed from catch up · Undo" notice; the restored
        // item is back at the front of the queue, so re-deriving the sequencing
        // sets from the remaining thread leaves it un-introduced and the
        // introduce effect re-adds its card as the current question.
        const withoutNotice = existing.filter((message) => message.kind !== 'dismiss_notice');
        const refs = deriveCatchupRefs(withoutNotice);
        introducedItemIdsRef.current = refs.introduced;
        resultPostedItemIdsRef.current = refs.resultPosted;
        return withoutNotice;
      });
    } finally {
      setSubmitting(false);
    }
  }, []);

  const dismissCurrent = useCallback(async (reason: 'not_interested' | 'too_old' | 'unclear' = 'not_interested') => {
    if (!currentItem || submitting || isResolvingTurn) return;
    const item = currentItem;
    const itemId = item.dailyQueueItemId;
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch('/api/daily/catchup/dismiss', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ dailyQueueItemId: itemId, reason }),
      });
      const raw = await response.json().catch(() => null);
      if (!response.ok) {
        applyCatchupSubmitFailure(item, parseCatchUpAnswerErrorBody(raw));
        return;
      }
      // Mark the prompt resolved so the next question can be introduced.
      resultPostedItemIdsRef.current.add(itemId);
      setStats((existing) => ({ ...existing, dismissed: existing.dismissed + 1 }));
      setMessages((existing) => {
        // Remove the dismissed question's card from the thread outright (it must
        // not linger as a dimmed ghost) and leave a "Removed from catch up ·
        // Undo" notice in its place. Undo re-introduces the card via the queue.
        const retired = retireDismissNotices(existing).filter(
          (message) => !(message.kind === 'question' && message.assignmentId === itemId),
        );
        return [
          ...retired,
          {
            id: newMessageId(),
            kind: 'dismiss_notice',
            questionText: item.questionText,
            onUndo: () => undismissItem(item),
          },
        ];
      });
      // A dismissed item leaves the answerable round (it won't be answered), so
      // mirror dropStaleItem: shrink the round target and, if dismissing empties
      // the queue (or meets the shrunken target), close the round. Without this
      // the thread dead-ends with no current question and no input after the last
      // missed question is dismissed (PLR-17).
      const emptiesQueue = items.length <= 1;
      advancePast(itemId);
      batchStartRemainingRef.current = Math.max(0, batchStartRemainingRef.current - 1);
      const roundSize = Math.min(CATCH_UP_BATCH_SIZE, batchStartRemainingRef.current);
      if (emptiesQueue || answeredInBatchRef.current >= roundSize) {
        setPhase('round_complete');
      }
    } catch {
      applyCatchupSubmitFailure(item, parseCatchUpAnswerErrorBody({ code: 'network' }));
    } finally {
      setSubmitting(false);
    }
  }, [advancePast, applyCatchupSubmitFailure, currentItem, isResolvingTurn, items.length, submitting, undismissItem]);

  // Re-grade a wrong daily-slot answer via the shared /api/daily/recheck route.
  // On accept we flip this turn's tally + recap entry to correct; GameplayChat's
  // ResultRow surfaces the returned message inline. Feed-backed items never reach
  // here (their recheckAction is null), so the daily route's queue lookup holds.
  const requestRecheck = useCallback(
    async (item: CatchupQueueItem): Promise<RecheckActionResult> => {
      const parsed = parseCatchupItemId(item.dailyQueueItemId);
      if (!parsed || parsed.surface !== 'daily') {
        return { accepted: false, message: 'Recheck isn’t available for this question.' };
      }

      let response: Response;
      try {
        response = await fetch('/api/daily/recheck', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ queue_id: parsed.queueId, slot_index: parsed.slotIndex }),
        });
      } catch {
        return { accepted: false, message: 'Could not recheck that answer.' };
      }

      const raw = (await response.json().catch(() => null)) as DailyRecheckResponse | null;
      if (!response.ok || !raw) {
        return { accepted: false, message: raw?.message ?? 'Could not recheck that answer.' };
      }
      if (!raw.accepted) {
        return { accepted: false, message: raw.reason ?? 'Rechecked and still marked wrong.' };
      }

      const pointsAwarded = Number(raw.pointsAwarded ?? 0);
      // Reflect the flip in the round tally + recap so the summary doesn't still
      // read this turn as a miss. The recap entry is keyed by questionId.
      setStats((existing) => ({ ...existing, correct: existing.correct + 1 }));
      setBatchRecords((existing) =>
        existing.map((record) =>
          record.questionId === item.questionId && record.outcome === 'wrong'
            ? { ...record, outcome: 'correct' }
            : record,
        ),
      );
      return {
        accepted: true,
        message: `Recheck accepted — +${pointsAwarded} ${pointsAwarded === 1 ? 'point' : 'points'}.`,
      };
    },
    [],
  );

  const submitCurrent = useCallback(async (submittedAnswer: string) => {
    if (!currentItem || submitting || !submittedAnswer.trim()) return;

    const item = currentItem;
    const trimmedAnswer = submittedAnswer.trim();
    setSubmitting(true);
    setIsResolvingTurn(true);
    setError(null);

    try {
      const response = await fetch('/api/daily/catchup/answer', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          dailyQueueItemId: item.dailyQueueItemId,
          submittedAnswer: trimmedAnswer,
        }),
      });
      const raw = await response.json().catch(() => null);
      if (!response.ok || !raw) {
        applyCatchupSubmitFailure(item, parseCatchUpAnswerErrorBody(raw));
        return;
      }

      const data = raw as CatchupAnswerResponse;
      const isCorrect = Boolean(data.isCorrect ?? data.correct ?? data.result === 'correct');
      const pointsAwarded = Number(data.pointsAwarded ?? data.awarded_points ?? 0);
      const resultMessageId = newMessageId();
      resultPostedItemIdsRef.current.add(item.dailyQueueItemId);
      // Only wrong, daily-queue-backed answers get a recheck button — feed-backed
      // catch-up items aren't supported by /api/daily/recheck.
      const recheckAction: RecheckAction | null =
        !isCorrect && parseCatchupItemId(item.dailyQueueItemId)?.surface === 'daily'
          ? { onSubmit: () => requestRecheck(item) }
          : null;
      setStats((existing) => ({
        answered: existing.answered + 1,
        correct: existing.correct + (isCorrect ? 1 : 0),
        dismissed: existing.dismissed,
      }));
      setMessages((existing) => [
        ...retireDismissNotices(existing),
        { id: newMessageId(), kind: 'user', text: trimmedAnswer },
        buildCatchupResultMessage({
          id: resultMessageId,
          item,
          data,
          isCorrect,
          submittedAnswer: trimmedAnswer,
          pointsAwarded,
          recheckAction,
        }),
      ]);

      const revealedAnswer = data.correctAnswer ?? data.answer ?? item.correctAnswer;
      window.setTimeout(() => {
        finishTurn(item.dailyQueueItemId, {
          questionId: item.questionId,
          questionText: item.questionText,
          outcome: isCorrect ? 'correct' : 'wrong',
          submittedAnswer: trimmedAnswer,
          correctAnswer: revealedAnswer,
          explanation: data.explanation ?? data.explainer ?? item.explanation ?? null,
          domainDisplayName: item.domainDisplayName,
          authorName: item.authorName ?? null,
          authorId: item.authorId ?? null,
          authorIsHouse: item.authorIsHouse ?? false,
          authorNote: data.creatorNote ?? null,
          reportTarget: item.reportTarget ?? null,
        });
      }, 1200);
    } catch {
      // No server verdict reached us (network blip / thrown fetch). Treat it as
      // transient: keep the question on screen so the same answer can be retried
      // rather than wiping the round.
      applyCatchupSubmitFailure(item, parseCatchUpAnswerErrorBody({ code: 'network' }));
    } finally {
      setSubmitting(false);
    }
  }, [applyCatchupSubmitFailure, currentItem, finishTurn, requestRecheck, submitting]);

  const remainingLabel = useMemo(() => {
    const total = initialTotal || items.length;
    return `${items.length} of ${total} remaining`;
  }, [initialTotal, items.length]);

  return {
    items,
    currentItem,
    initialTotal,
    introCopy,
    messages,
    loading,
    submitting,
    isResolvingTurn,
    error,
    stats,
    completed,
    remainingLabel,
    phase,
    batchRecords,
    remainingCount,
    nextBatchSize,
    startNextBatch,
    openSummary,
    reload: load,
    submitCurrent,
    skipCurrent,
    dismissCurrent,
  };
}
