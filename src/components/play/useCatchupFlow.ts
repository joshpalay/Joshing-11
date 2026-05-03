'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { newMessageId, type ChatMessage } from '@/components/play/GameplayChat';
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
};

type CatchupAnswerResponse = {
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
  quip?: string | null;
  breadcrumb?: string | null;
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

function formatQuestionSubhead(item: CatchupQueueItem): string {
  if (item.queueAge <= 1) return 'FROM YESTERDAY';
  if (item.queueAge > 1 && item.queueAge <= 6) return `FROM ${item.queueAge} DAYS AGO`;

  const date = new Date(`${item.queueDate}T12:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return 'FROM EARLIER';
  return `FROM ${new Intl.DateTimeFormat('en-US', { weekday: 'long' }).format(date).toUpperCase()}`;
}

function questionMessage(item: CatchupQueueItem): ChatMessage {
  const badges: NonNullable<Extract<ChatMessage, { kind: 'question' }>['badges']> = [];
  if (item.wasSkipped) badges.push({ label: 'you skipped this', tone: 'muted' });
  if (item.expiresSoon) badges.push({ label: 'expires tomorrow', tone: 'warning' });

  return {
    id: `catchup-q-${item.dailyQueueItemId}`,
    kind: 'question',
    assignmentId: item.dailyQueueItemId,
    questionText: item.questionText,
    creatorName: null,
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

  const introducedItemIdsRef = useRef<Set<string>>(new Set());
  const resultPostedItemIdsRef = useRef<Set<string>>(new Set());

  const currentItem = items[0] ?? null;
  const completed = !loading && initialTotal > 0 && items.length === 0;

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
      introducedItemIdsRef.current = new Set();
      resultPostedItemIdsRef.current = new Set();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not load catch-up.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const id = currentItem?.dailyQueueItemId ?? null;
    if (!currentItem) return;
    if (!shouldIntroduceCatchUpQuestion({
      currentCatchUpItemId: id,
      loading,
      isResolvingTurn,
      introducedItemIds: introducedItemIdsRef.current,
      resultPostedItemIds: resultPostedItemIdsRef.current,
    })) return;

    introducedItemIdsRef.current.add(currentItem.dailyQueueItemId);
    setMessages((existing) => [...existing, questionMessage(currentItem)]);
  }, [currentItem, isResolvingTurn, loading]);

  const advancePast = useCallback((dailyQueueItemId: string) => {
    setItems((existing) => existing.filter((item) => item.dailyQueueItemId !== dailyQueueItemId));
  }, []);

  const skipCurrent = useCallback(() => {
    if (!currentItem || submitting) return;
    resultPostedItemIdsRef.current.add(currentItem.dailyQueueItemId);
    setMessages((existing) => [
      ...existing,
      { id: newMessageId(), kind: 'system', text: 'Skipped for now.' },
    ]);
    advancePast(currentItem.dailyQueueItemId);
  }, [advancePast, currentItem, submitting]);

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
      resultPostedItemIdsRef.current.add(item.dailyQueueItemId);
      setStats((existing) => ({
        answered: existing.answered + 1,
        correct: existing.correct + (isCorrect ? 1 : 0),
        dismissed: existing.dismissed,
      }));
      setMessages((existing) => [
        ...existing,
        { id: newMessageId(), kind: 'user', text: trimmedAnswer },
        {
          id: newMessageId(),
          kind: 'result',
          assignmentId: item.dailyQueueItemId,
          questionText: item.questionText,
          result: isCorrect ? 'correct' : 'wrong',
          submitted: trimmedAnswer,
          correctAnswer: isCorrect ? null : data.correctAnswer ?? data.answer ?? item.correctAnswer,
          consolation: data.consolation ?? data.quip ?? null,
          breadcrumb: data.breadcrumb ?? null,
          copyVariant: item.queueAge,
          creatorName: 'Joshing',
          canonicalSubcategory: item.domain,
          pointsAwarded,
          pointsLabel: 'Catch-up - 0.25x points',
        },
      ]);

      window.setTimeout(() => {
        advancePast(item.dailyQueueItemId);
        setIsResolvingTurn(false);
      }, 1200);
    } catch (caught) {
      setIsResolvingTurn(false);
      setError(caught instanceof Error ? caught.message : 'Could not record that answer.');
    } finally {
      setSubmitting(false);
    }
  }, [advancePast, currentItem, submitting]);

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
    reload: load,
    submitCurrent,
    skipCurrent,
    dismissCurrent,
  };
}
