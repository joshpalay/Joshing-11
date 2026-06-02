'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';

import { newMessageId, type ChatMessage } from '@/components/play/GameplayChat';
import { CATCH_UP_BATCH_SIZE } from '@/lib/game-constants';
import { difficultyEstimateToTierLabel } from '@/lib/questions/difficulty-tier';
import { LLM_QUESTION_ATTRIBUTION, type InsideJokeKind } from '@/lib/questions-types';
import {
  parseCatchUpAnswerErrorBody,
  userFacingCatchUpSubmitMessage,
} from '@/server/play/catch-up-submit-error';
import { shouldIntroduceCatchUpQuestion } from '@/server/play/catch-up-turn-sequencing';

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
  /** D-3: the author is the non-human house/editorial author (renders the Editorial badge, no relational copy). */
  authorIsHouse?: boolean;
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
  authorIsHouse: boolean;
};

/**
 * 'playing' — the round's chat thread + answer input is live.
 * 'summary' — the round is done; show the recap with "play next" / "return home".
 */
export type CatchupPhase = 'playing' | 'summary';

function formatQuestionSubhead(item: CatchupQueueItem): string {
  if (item.queueAge <= 1) return 'FROM YESTERDAY';
  if (item.queueAge > 1 && item.queueAge <= 6) return `FROM ${item.queueAge} DAYS AGO`;

  const date = new Date(`${item.queueDate}T12:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return 'FROM EARLIER';
  return `FROM ${new Intl.DateTimeFormat('en-US', { weekday: 'long' }).format(date).toUpperCase()}`;
}

async function fetchBreadcrumbForCatchupMessage(
  queueId: string,
  slotIndex: number,
  messageId: string,
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>,
): Promise<void> {
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
    setMessages((existing) => existing.map((message) =>
      message.id === messageId && message.kind === 'result'
        ? { ...message, breadcrumb }
        : message,
    ));
  } catch {
    // Breadcrumb is purely additive context; failure is silently ignored.
  }
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
}): Extract<ChatMessage, { kind: 'result' }> {
  const { id, item, data, isCorrect, submittedAnswer, pointsAwarded } = params;
  return {
    id,
    kind: 'result',
    assignmentId: item.dailyQueueItemId,
    questionText: item.questionText,
    result: isCorrect ? 'correct' : 'wrong',
    submitted: submittedAnswer,
    correctAnswer: isCorrect ? null : data.correctAnswer ?? data.answer ?? item.correctAnswer,
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
  };
}

function questionMessage(item: CatchupQueueItem): ChatMessage {
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
    badges,
  };
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
    // Don't introduce the next round's first question while the summary is up;
    // it gets introduced when startNextBatch flips the phase back to 'playing'.
    if (phase !== 'playing') return;
    if (!shouldIntroduceCatchUpQuestion({
      currentCatchUpItemId: id,
      loading,
      isResolvingTurn,
      introducedItemIds: introducedItemIdsRef.current,
      resultPostedItemIds: resultPostedItemIdsRef.current,
    })) return;

    introducedItemIdsRef.current.add(currentItem.dailyQueueItemId);
    setMessages((existing) => [...existing, questionMessage(currentItem)]);
  }, [currentItem, isResolvingTurn, loading, phase]);

  const advancePast = useCallback((dailyQueueItemId: string) => {
    setItems((existing) => existing.filter((item) => item.dailyQueueItemId !== dailyQueueItemId));
  }, []);

  // Records the resolved turn and, once the round is full, flips to the summary.
  // Called from inside the post-result timeout in both submit and give-up.
  const finishTurn = useCallback((dailyQueueItemId: string, record: CatchupBatchRecord) => {
    answeredInBatchRef.current += 1;
    setBatchRecords((existing) => [...existing, record]);
    advancePast(dailyQueueItemId);
    setIsResolvingTurn(false);
    const roundSize = Math.min(CATCH_UP_BATCH_SIZE, batchStartRemainingRef.current);
    if (answeredInBatchRef.current >= roundSize) {
      setPhase('summary');
    }
  }, [advancePast]);

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

  const skipCurrent = useCallback(() => {
    if (!currentItem || submitting || isResolvingTurn) return;
    const item = currentItem;
    resultPostedItemIdsRef.current.add(item.dailyQueueItemId);
    setIsResolvingTurn(true);
    setMessages((existing) => [
      ...existing,
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
        authorIsHouse: item.authorIsHouse ?? false,
      });
    }, 1200);
  }, [currentItem, finishTurn, isResolvingTurn, submitting]);

  const dismissCurrent = useCallback(async (reason: 'not_interested' | 'too_old' | 'unclear' = 'not_interested') => {
    if (!currentItem || submitting) return;
    const itemId = currentItem.dailyQueueItemId;
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
      if (!response.ok) throw new Error(userFacingCatchUpSubmitMessage(parseCatchUpAnswerErrorBody(raw)));
      resultPostedItemIdsRef.current.add(itemId);
      setStats((existing) => ({ ...existing, dismissed: existing.dismissed + 1 }));
      setMessages((existing) => [
        ...existing,
        { id: newMessageId(), kind: 'system', text: 'Dropped from catch-up.' },
      ]);
      advancePast(itemId);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not dismiss that question.');
    } finally {
      setSubmitting(false);
    }
  }, [advancePast, currentItem, submitting]);

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
      if (!response.ok || !raw) throw new Error(userFacingCatchUpSubmitMessage(parseCatchUpAnswerErrorBody(raw)));

      const data = raw as CatchupAnswerResponse;
      const isCorrect = Boolean(data.isCorrect ?? data.correct ?? data.result === 'correct');
      const pointsAwarded = Number(data.pointsAwarded ?? data.awarded_points ?? 0);
      const resultMessageId = newMessageId();
      resultPostedItemIdsRef.current.add(item.dailyQueueItemId);
      setStats((existing) => ({
        answered: existing.answered + 1,
        correct: existing.correct + (isCorrect ? 1 : 0),
        dismissed: existing.dismissed,
      }));
      setMessages((existing) => [
        ...existing,
        { id: newMessageId(), kind: 'user', text: trimmedAnswer },
        buildCatchupResultMessage({
          id: resultMessageId,
          item,
          data,
          isCorrect,
          submittedAnswer: trimmedAnswer,
          pointsAwarded,
        }),
      ]);

      // Breadcrumbs are computed from daily-queue slots only; feed-sourced
      // catch-up items use a `feed:<feedItemId>` ID and have no slot to look up.
      if (!item.dailyQueueItemId.startsWith('feed:')) {
        const [queueId, slotIndexValue] = item.dailyQueueItemId.split(':');
        const slotIndex = Number(slotIndexValue);
        if (queueId && Number.isInteger(slotIndex)) {
          void fetchBreadcrumbForCatchupMessage(queueId, slotIndex, resultMessageId, setMessages);
        }
      }

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
          authorIsHouse: item.authorIsHouse ?? false,
        });
      }, 1200);
    } catch (caught) {
      setIsResolvingTurn(false);
      setError(caught instanceof Error ? caught.message : 'Could not record that answer.');
    } finally {
      setSubmitting(false);
    }
  }, [currentItem, finishTurn, submitting]);

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
    reload: load,
    submitCurrent,
    skipCurrent,
    dismissCurrent,
  };
}
