'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Send, SkipForward, X } from 'lucide-react';

import { AddToBankAction } from '@/components/AddToBankAction';
import { SendQuestionAction } from '@/components/SendQuestionAction';
import { QuestionReactionPrompt } from '@/components/play/GameplayChat';
import { difficultyCopyFromEstimate } from '@/lib/questions/difficulty-copy';

type FriendResult = {
  userId: string;
  displayName: string;
  result: 'correct' | 'incorrect' | null;
};

type FeedApiItem = {
  id: string;
  kind: 'question';
  question_id: string | null;
  source_type: string;
  source_user_id: string;
  source_friend_display_name: string;
  source_attribution: string;
  source_result: 'correct' | 'incorrect' | null;
  friend_results: FriendResult[] | null;
  source_event_at: string;
  personal_message: string | null;
  state: string;
  is_pinned: boolean;
  question_text: string | null;
  verified: boolean;
  is_in_bank: boolean;
  domain_pill: string | null;
  difficulty: string | null;
};

type FeedMeta = {
  has_friends: boolean;
  has_dismissed_domains: boolean;
  total_item_count: number;
  active_item_count: number;
  pre_filter_active_count: number;
  page_item_count?: number;
  limit?: number;
  offset?: number;
  has_more?: boolean;
};

type FeedResponse = {
  viewer_user_id: string;
  meta?: FeedMeta;
  items: FeedApiItem[];
};

type CeremonyBanner = {
  id: string;
  firedAt: string;
};

type AnswerResponse = {
  correct?: boolean;
  isCorrect?: boolean;
  answer?: string;
  correctAnswer?: string;
  explanation?: string | null;
  quip?: string | null;
  consolation?: string | null;
  breadcrumb?: string | null;
};

type ResultState = {
  correct: boolean;
  answer: string;
  explanation: string | null;
  quip: string | null;
  breadcrumb: string | null;
};

function formatEventTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(date);
}

function comparisonCopy(playerCorrect: boolean, friendResults: FriendResult[] | null): string {
  const primaryFriend = friendResults?.[0];
  const friendName = primaryFriend?.displayName ?? 'They';
  const friendCorrect = primaryFriend?.result === 'correct';

  if (playerCorrect && friendCorrect) return 'You both had it.';
  if (playerCorrect && !friendCorrect) return `You found a connection ${friendName} missed.`;
  if (!playerCorrect && friendCorrect) return `${friendName} recognized this one. You might next time.`;
  return 'This one is still waiting for common ground.';
}

type FeedListProps = {
  limit?: number;
};

type QuestionCardState = 'unanswered' | 'answered' | 'reacted';

export default function FeedList({ limit = 25 }: FeedListProps) {
  const [items, setItems] = useState<FeedApiItem[]>([]);
  const [feedMeta, setFeedMeta] = useState<FeedMeta | null>(null);
  const [viewerId, setViewerId] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [results, setResults] = useState<Record<string, ResultState>>({});
  const [cardStates, setCardStates] = useState<Record<string, QuestionCardState>>({});
  const [toasts, setToasts] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ceremonyBanner, setCeremonyBanner] = useState<CeremonyBanner | null>(null);

  const loadFeed = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/feed?limit=${encodeURIComponent(String(limit))}`, { cache: 'no-store', credentials: 'include' });
      const body = await response.json().catch(() => null) as FeedResponse | { message?: string } | null;
      if (!response.ok || !body || !('items' in body)) {
        throw new Error((body as { message?: string } | null)?.message ?? 'Could not load your Feed.');
      }
      setViewerId(body.viewer_user_id);
      setFeedMeta(body.meta ?? null);
      setItems(body.items);
      const bannerResponse = await fetch('/api/ceremony/banner', { cache: 'no-store', credentials: 'include' });
      const bannerBody = await bannerResponse.json().catch(() => null) as { ceremony?: CeremonyBanner | null } | null;
      setCeremonyBanner(bannerResponse.ok ? bannerBody?.ceremony ?? null : null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not load your Feed.');
    } finally {
      setLoading(false);
    }
  }, [limit]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadFeed();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadFeed]);

  const visibleItems = useMemo(() => items.slice(0, limit), [items, limit]);

  const emptyCopy = useMemo(() => {
    if (loading) return 'Loading your Feed...';
    if (error) return error;
    if (!feedMeta?.has_friends) return "When friends recognize each other’s questions, those moments will appear here.";
    // pre_filter_active_count > 0 means items exist in active/skipped state but are hidden by domain filters
    if (feedMeta.has_dismissed_domains && feedMeta.pre_filter_active_count > 0) {
      return "You've focused your Feed. You can re-open domains from your Knowledge page.";
    }
    if (feedMeta.total_item_count > 0) return "You're caught up. Answer questions to reveal more common ground.";
    return "Answer questions to reveal common ground.";
  }, [error, feedMeta, loading]);

  const emptyDiagnostics = useMemo(() => {
    if (process.env.NODE_ENV === 'production' || !feedMeta) return null;

    return [
      `has_friends=${String(feedMeta.has_friends)}`,
      `has_dismissed_domains=${String(feedMeta.has_dismissed_domains)}`,
      `total_item_count=${feedMeta.total_item_count}`,
      `pre_filter_active_count=${feedMeta.pre_filter_active_count}`,
      `active_item_count=${feedMeta.active_item_count}`,
      `page_item_count=${feedMeta.page_item_count ?? items.length}`,
      `limit=${feedMeta.limit ?? limit}`,
      `offset=${feedMeta.offset ?? 0}`,
      `has_more=${String(feedMeta.has_more ?? false)}`,
    ].join(' · ');
  }, [feedMeta, items.length, limit]);

  const showToast = useCallback((itemId: string, message: string) => {
    setToasts((t) => ({ ...t, [itemId]: message }));
    setTimeout(() => setToasts((t) => { const next = { ...t }; delete next[itemId]; return next; }), 3000);
  }, []);

  const removeItem = useCallback((itemId: string) => {
    setItems((current) => current.filter((item) => item.id !== itemId));
  }, []);

  const updateState = useCallback(async (itemId: string, state: 'skipped' | 'dismissed') => {
    setBusyId(itemId);
    setError(null);
    try {
      const response = await fetch(`/api/feed/${itemId}/state`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ state }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.message ?? 'Could not update that Feed item.');
      }
      removeItem(itemId);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not update that Feed item.');
    } finally {
      setBusyId(null);
    }
  }, [removeItem]);

  const dismissDomain = useCallback(async (itemId: string, domain: string) => {
    setBusyId(itemId);
    try {
      const response = await fetch('/api/feed/dismiss-domain', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ domain }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.message ?? 'Could not dismiss domain.');
      }
      // Remove all items with this domain from local state
      setItems((current) => current.filter((item) => item.domain_pill !== domain));
      showToast(itemId, `Got it. No more ${domain} questions.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not dismiss domain.');
    } finally {
      setBusyId(null);
    }
  }, [showToast]);

  const submitAnswer = useCallback(async (item: FeedApiItem) => {
    const submitted = answers[item.id]?.trim();
    if (!submitted) return;
    setBusyId(item.id);
    setError(null);
    try {
      const response = await fetch(`/api/feed/${item.id}/answer`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ submitted_answer: submitted }),
      });
      const body = await response.json().catch(() => null) as AnswerResponse | { message?: string } | null;
      if (!response.ok || !body || !('correct' in body || 'isCorrect' in body)) {
        throw new Error((body as { message?: string } | null)?.message ?? 'Could not submit that answer.');
      }
      setResults((current) => ({
        ...current,
        [item.id]: {
          correct: Boolean(body.correct ?? body.isCorrect),
          answer: body.answer ?? body.correctAnswer ?? '',
          explanation: body.explanation ?? null,
          quip: body.quip ?? body.consolation ?? null,
          breadcrumb: body.breadcrumb ?? null,
        },
      }));
      setCardStates((s) => ({ ...s, [item.id]: 'answered' }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not submit that answer.');
    } finally {
      setBusyId(null);
    }
  }, [answers]);

  return (
    <>
      {ceremonyBanner ? (
        <Link
          href={`/ceremony/${ceremonyBanner.id}`}
          className="mb-4 block rounded-lg border border-amber-300 bg-amber-50 px-4 py-4 text-stone-950 shadow-sm"
        >
          <div className="flex items-start gap-3">
            <span className="mt-0.5 text-lg" aria-hidden>✦</span>
            <div>
              <p className="font-medium">Your two-week reflection is ready</p>
              <p className="mt-1 text-sm text-stone-700">See what you&rsquo;ve been up to {'->'}</p>
            </div>
          </div>
        </Link>
      ) : null}

      {visibleItems.length === 0 ? (
        <section className="flex min-h-48 flex-col items-center justify-center gap-3 py-12 text-center">
          <p className={error ? 'text-sm text-destructive' : 'text-sm text-muted-foreground'}>{emptyCopy}</p>
          {emptyDiagnostics ? (
            <p className="max-w-xl break-words rounded bg-muted px-3 py-2 font-mono text-xs text-muted-foreground">
              {emptyDiagnostics}
            </p>
          ) : null}
          {/*
            // v11.1: Joshing Game creation disabled at FAB level. Re-enable
            // when game creation flow is restored.
          */}
        </section>
      ) : (
        <section className="space-y-3 pb-8">
          {visibleItems.map((item) => {
            const result = results[item.id];
            const cardState = cardStates[item.id] ?? (item.state === 'answered' ? 'answered' : 'unanswered');
            const toast = toasts[item.id];


            return (
              <article
                key={item.id}
                className="rounded-lg border bg-card p-4 text-card-foreground"
              >
                {/* Header row */}
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  {item.is_pinned ? (
                    <span className="rounded-full bg-primary px-2.5 py-1 text-xs text-primary-foreground">Pinned</span>
                  ) : null}
                  {item.domain_pill ? (
                    <span className="rounded-full bg-secondary px-2.5 py-1 text-xs text-secondary-foreground">
                      {item.domain_pill}
                    </span>
                  ) : null}
                  {!item.verified ? (
                    <button
                      type="button"
                      className="rounded-full border px-2.5 py-1 text-xs text-muted-foreground"
                      title="The author wrote their own answer instead of using the LLM's suggestion. The answer may not be standard."
                      onClick={() => showToast(item.id, "The author wrote their own answer instead of using the LLM's suggestion. The answer may not be standard.")}
                    >
                      ⚠ unverified
                    </button>
                  ) : null}
                  {item.difficulty ? (
                    <span className={[
                      'rounded-full px-2.5 py-1 text-xs font-medium',
                      item.difficulty === 'specialist' ? 'bg-rose-100 text-rose-700'
                      : item.difficulty === 'moderate' ? 'bg-amber-100 text-amber-700'
                      : 'bg-sky-100 text-sky-700',
                    ].join(' ')}>
                      {difficultyCopyFromEstimate(item.difficulty) ?? 'Unrated'}
                    </span>
                  ) : null}
                  <span className="ml-auto text-xs text-muted-foreground">{formatEventTime(item.source_event_at)}</span>
                </div>

                {/* Question text */}
                <p className="text-base leading-7 text-foreground">{item.question_text}</p>

                {/* Attribution line */}
                <div className="mt-2 flex items-center gap-1.5">
                  <p className="text-sm font-medium text-foreground">{item.source_attribution}</p>
                </div>
                {item.personal_message ? (
                  <p className="mt-1 text-sm italic text-muted-foreground">&ldquo;{item.personal_message}&rdquo;</p>
                ) : null}

                {/* Toast */}
                {toast ? (
                  <p className="mt-2 text-sm text-muted-foreground">{toast}</p>
                ) : null}


                {/* State 2 — Answered */}
                {cardState === 'answered' && result ? (
                  <div className="mt-4 rounded-md bg-muted p-3 text-sm">
                    {/* Comparison copy */}
                    <p className="font-medium">
                      {item.source_type === 'friend_answered'
                        ? comparisonCopy(result.correct, item.friend_results)
                        : result.correct ? 'This one connected.' : 'Not quite.'}
                    </p>
                    {!result.correct ? <p className="mt-1">Answer: {result.answer}</p> : null}
                    {result.explanation ? <p className="mt-1 text-muted-foreground">{result.explanation}</p> : null}
                    {result.quip ? <p className="mt-1 text-muted-foreground">{result.quip}</p> : null}
                    {result.breadcrumb ? <p className="mt-2 text-muted-foreground italic">{result.breadcrumb}</p> : null}

                    {/* Post-answer actions */}
                    <div className="mt-3 flex flex-wrap gap-2">
                      {item.question_id ? (
                        <SendQuestionAction
                          question={{ id: item.question_id, text: item.question_text ?? '', domain: item.domain_pill ?? '' }}
                          label="Send to friend"
                          className="inline-flex h-9 items-center gap-2 rounded-md border px-3 text-sm hover:bg-muted"
                        />
                      ) : null}
                      {item.question_id ? (
                        <AddToBankAction
                          questionId={item.question_id}
                          initialInBank={item.is_in_bank}
                          contextType="feed"
                          contextId={item.id}
                          label=""
                          className="inline-flex size-9 items-center justify-center rounded-md border px-0"
                          onChange={(inBank) => setItems((current) => current.map((row) => row.id === item.id ? { ...row, is_in_bank: inBank } : row))}
                        />
                      ) : null}
                      {item.question_id && viewerId && item.source_user_id !== viewerId ? (
                        <QuestionReactionPrompt
                          prompt={{
                            senderName: item.source_friend_display_name,
                            questionId: item.question_id,
                            contextType: 'feed',
                            contextId: item.id,
                          }}
                        />
                      ) : null}
                    </div>
                  </div>
                ) : cardState === 'unanswered' ? (
                  /* State 1 — Unanswered */
                  <form
                    className="mt-4 flex flex-col gap-3 sm:flex-row"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void submitAnswer(item);
                    }}
                  >
                    <input
                      className="min-h-11 flex-1 rounded-md border bg-background px-3 text-base outline-none"
                      value={answers[item.id] ?? ''}
                      onChange={(event) => setAnswers((current) => ({ ...current, [item.id]: event.target.value }))}
                      placeholder="Your answer..."
                      disabled={busyId === item.id}
                    />
                    <div className="flex flex-wrap gap-2">
                      <button className="btn-primary inline-flex h-11 items-center gap-2" type="submit" disabled={busyId === item.id || !answers[item.id]?.trim()}>
                        <Send className="size-4" />
                        Send
                      </button>
                      <button
                        className="inline-flex h-11 w-11 items-center justify-center rounded-md border"
                        type="button"
                        onClick={() => void updateState(item.id, 'skipped')}
                        disabled={busyId === item.id}
                        title="Skip"
                      >
                        <SkipForward className="size-4" />
                      </button>
                      <button
                        className="inline-flex h-11 w-11 items-center justify-center rounded-md border"
                        type="button"
                        onClick={() => void updateState(item.id, 'dismissed')}
                        disabled={busyId === item.id}
                        title="Dismiss"
                      >
                        <X className="size-4" />
                      </button>
                      <button
                        className="inline-flex h-11 items-center gap-1.5 rounded-md border px-3 text-sm text-muted-foreground"
                        type="button"
                        onClick={() => item.domain_pill ? void dismissDomain(item.id, item.domain_pill) : undefined}
                        disabled={busyId === item.id || !item.domain_pill}
                        title={item.domain_pill ? `Not my focus: ${item.domain_pill}` : 'No category to focus'}
                      >
                        Not my focus
                      </button>
                      {item.question_id ? (
                        <SendQuestionAction
                          question={{ id: item.question_id, text: item.question_text ?? '', domain: item.domain_pill ?? '' }}
                          label=""
                          className="inline-flex h-11 w-11 items-center justify-center rounded-md border hover:bg-muted"
                        />
                      ) : null}
                      {item.question_id ? (
                        <AddToBankAction
                          questionId={item.question_id}
                          initialInBank={item.is_in_bank}
                          contextType="feed"
                          contextId={item.id}
                          label=""
                          className="inline-flex h-11 w-11 items-center justify-center rounded-md border px-0"
                          onChange={(inBank) => setItems((current) => current.map((row) => row.id === item.id ? { ...row, is_in_bank: inBank } : row))}
                        />
                      ) : null}
                    </div>
                  </form>
                ) : null}
              </article>
            );
          })}
        </section>
      )}
    </>
  );
}
