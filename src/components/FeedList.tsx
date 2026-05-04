'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { Send, SkipForward, ThumbsDown, ThumbsUp, X } from 'lucide-react';

import { AddToBankAction } from '@/components/AddToBankAction';
import { SendQuestionAction } from '@/components/SendQuestionAction';
import { QuestionReactionPrompt } from '@/components/play/GameplayChat';

type FriendResult = {
  userId: string;
  displayName: string;
  result: 'correct' | 'incorrect' | null;
};

type FeedApiItem = {
  id: string;
  kind: 'question' | 'joshing_game';
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
  joshing_game_id: string | null;
  question_text: string | null;
  is_in_bank: boolean;
  domain_pill: string;
  game_title: string | null;
};

type FeedResponse = {
  viewer_user_id: string;
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
  awarded_points?: number;
  pointsAwarded?: number;
  quip?: string | null;
  consolation?: string | null;
  breadcrumb?: string | null;
};

type ResultState = {
  correct: boolean;
  answer: string;
  explanation: string | null;
  points: number;
  quip: string | null;
  breadcrumb: string | null;
};

type JoshingGameFeedView = {
  game: { id: string; title: string };
  creator: { displayName: string };
  questions: Array<{ questionId: string }>;
  recipients: Array<{ userId: string; displayName: string; completedAt: string | null; score: number | null }>;
  responses: Array<{ userId: string; questionId: string; isCorrect: boolean | null }>;
  viewerStatus: 'not_started' | 'in_progress' | 'complete';
};

type FeedListProps = {
  limit?: number;
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
  if (playerCorrect && !friendCorrect) return `You got it. ${friendName} couldn't.`;
  if (!playerCorrect && friendCorrect) return `${friendName} had it. You'll get it next time.`;
  return 'Neither of you got it. Good question.';
}

function JoshingGameCard({ item, viewerId }: { item: FeedApiItem; viewerId: string | null }) {
  const [game, setGame] = useState<JoshingGameFeedView | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!item.joshing_game_id) return;
    fetch(`/api/joshing-games/${item.joshing_game_id}`, { cache: 'no-store', credentials: 'include' })
      .then(async (response) => {
        const body = await response.json().catch(() => null);
        if (!response.ok) throw new Error(body?.message ?? 'Could not load this game.');
        setGame(body);
      })
      .catch((caught) => setError(caught instanceof Error ? caught.message : 'Could not load this game.'));
  }, [item.joshing_game_id]);

  const questionCount = game?.questions.length ?? 0;
  const href = game?.viewerStatus === 'complete'
    ? `/games/${game.game.id}/summary`
    : `/games/${game?.game.id ?? item.joshing_game_id}`;
  const cta = game?.viewerStatus === 'complete' ? 'See results' : 'Play';

  return (
    <article className="rounded-lg border bg-card p-4 text-card-foreground">
      <div className="mb-3 flex items-center justify-between gap-3">
        <span className="rounded-full bg-primary px-2.5 py-1 text-xs text-primary-foreground">Pinned</span>
        <span className="text-xs text-muted-foreground">{formatEventTime(item.source_event_at)}</span>
      </div>
      <h2 className="font-serif text-xl font-semibold">🎯 {game?.game.title ?? item.game_title ?? 'Joshing Game'}</h2>
      <p className="mt-1 text-sm text-muted-foreground">From {game?.creator.displayName ?? item.source_friend_display_name}</p>

      <div className="mt-4 space-y-2">
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        {!game && !error ? <p className="text-sm text-muted-foreground">Loading game...</p> : null}
        {game?.recipients.map((recipient) => {
          const answered = game.responses.filter((r) => r.userId === recipient.userId);
          const score = recipient.score ?? answered.filter((r) => r.isCorrect).length;
          const label = recipient.completedAt
            ? `✅ ${score}/${questionCount}`
            : answered.length > 0
              ? '⏳ Playing...'
              : '— Not started';
          return (
            <div key={recipient.userId} className="flex items-center justify-between gap-3 text-sm">
              <span>{recipient.userId === viewerId ? 'You' : recipient.displayName}</span>
              <span className="text-muted-foreground">{label}</span>
            </div>
          );
        })}
      </div>

      <div className="mt-5 flex items-center justify-between gap-3">
        <Link href={href} className="btn-primary">
          {cta}
        </Link>
        <span className="text-sm text-muted-foreground">{questionCount || ''} {questionCount === 1 ? 'question' : 'questions'}</span>
      </div>
    </article>
  );
}

type QuestionCardState = 'unanswered' | 'answered' | 'reacted';

export default function FeedList({ limit = 25 }: FeedListProps) {
  const [items, setItems] = useState<FeedApiItem[]>([]);
  const [viewerId, setViewerId] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [results, setResults] = useState<Record<string, ResultState>>({});
  const [cardStates, setCardStates] = useState<Record<string, QuestionCardState>>({});
  const [toasts, setToasts] = useState<Record<string, string>>({});
  const [thumbsDownState, setThumbsDownState] = useState<Record<string, 'removed' | 'restored'>>({});
  const thumbsDownTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ceremonyBanner, setCeremonyBanner] = useState<CeremonyBanner | null>(null);

  const loadFeed = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/feed', { cache: 'no-store', credentials: 'include' });
      const body = await response.json().catch(() => null) as FeedResponse | { message?: string } | null;
      if (!response.ok || !body || !('items' in body)) {
        throw new Error((body as { message?: string } | null)?.message ?? 'Could not load your Feed.');
      }
      setViewerId(body.viewer_user_id);
      setItems(body.items);
      const bannerResponse = await fetch('/api/ceremony/banner', { cache: 'no-store', credentials: 'include' });
      const bannerBody = await bannerResponse.json().catch(() => null) as { ceremony?: CeremonyBanner | null } | null;
      setCeremonyBanner(bannerResponse.ok ? bannerBody?.ceremony ?? null : null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not load your Feed.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadFeed();
  }, [loadFeed]);

  const visibleItems = useMemo(() => items.slice(0, limit), [items, limit]);

  const emptyCopy = useMemo(() => {
    if (loading) return 'Loading your Feed...';
    if (error) return error;
    return "You're caught up. Check back later.";
  }, [error, loading]);

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
          points: body.awarded_points ?? body.pointsAwarded ?? 0,
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

  const thumbsup = useCallback(async (itemId: string) => {
    setBusyId(itemId);
    try {
      await fetch(`/api/feed/${itemId}/thumbsup`, { method: 'POST', credentials: 'include' });
    } finally {
      setBusyId(null);
    }
  }, []);

  const thumbsdown = useCallback(async (itemId: string) => {
    const current = thumbsDownState[itemId];
    setBusyId(itemId);
    try {
      if (current === 'removed') {
        // Undo: restore the item
        const response = await fetch(`/api/feed/${itemId}/thumbsdown`, { method: 'DELETE', credentials: 'include' });
        if (response.ok) {
          if (thumbsDownTimers.current[itemId]) {
            clearTimeout(thumbsDownTimers.current[itemId]);
            delete thumbsDownTimers.current[itemId];
          }
          setThumbsDownState((s) => ({ ...s, [itemId]: 'restored' }));
          // Auto-fade restored message after 4s
          thumbsDownTimers.current[itemId] = setTimeout(() => {
            setThumbsDownState((s) => { const next = { ...s }; delete next[itemId]; return next; });
            delete thumbsDownTimers.current[itemId];
          }, 4000);
        }
      } else {
        // First tap: dismiss and show confirmation
        const response = await fetch(`/api/feed/${itemId}/thumbsdown`, { method: 'POST', credentials: 'include' });
        if (response.ok) {
          setThumbsDownState((s) => ({ ...s, [itemId]: 'removed' }));
          // Auto-remove from list after 4s
          thumbsDownTimers.current[itemId] = setTimeout(() => {
            removeItem(itemId);
            setThumbsDownState((s) => { const next = { ...s }; delete next[itemId]; return next; });
            delete thumbsDownTimers.current[itemId];
          }, 4000);
        }
      }
    } finally {
      setBusyId(null);
    }
  }, [removeItem, thumbsDownState]);

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
              <p className="mt-1 text-sm text-stone-700">See what you've been up to {'->'}</p>
            </div>
          </div>
        </Link>
      ) : null}

      {visibleItems.length === 0 ? (
        <section className="flex min-h-48 items-center justify-center py-12 text-center">
          <p className={error ? 'text-sm text-destructive' : 'text-sm text-muted-foreground'}>{emptyCopy}</p>
        </section>
      ) : (
        <section className="space-y-3 pb-8">
          {visibleItems.map((item) => {
            const result = results[item.id];
            const cardState = cardStates[item.id] ?? (item.state === 'answered' ? 'answered' : 'unanswered');
            const toast = toasts[item.id];

            if (item.kind === 'joshing_game') {
              return <JoshingGameCard key={item.id} item={item} viewerId={viewerId} />;
            }

            const thumbsDownMsg = thumbsDownState[item.id];

            return (
              <article
                key={item.id}
                className={[
                  'rounded-lg border bg-card p-4 text-card-foreground',
                  item.source_type === 'direct_sent' ? 'border-l-4 border-l-primary shadow-sm' : '',
                ].join(' ')}
              >
                {/* Header row */}
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  {item.source_type === 'direct_sent' ? (
                    <span className="rounded-full bg-primary px-2.5 py-1 text-xs text-primary-foreground">Sent to you</span>
                  ) : null}
                  {item.is_pinned ? (
                    <span className="rounded-full bg-primary px-2.5 py-1 text-xs text-primary-foreground">Pinned</span>
                  ) : null}
                  <span className="rounded-full bg-secondary px-2.5 py-1 text-xs text-secondary-foreground">
                    {item.domain_pill}
                  </span>
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

                {/* Thumbs-down inline confirmation */}
                {thumbsDownMsg ? (
                  <p className="mt-2 text-xs italic text-muted-foreground">
                    {thumbsDownMsg === 'removed'
                      ? "Removed from your feed. Won’t pass to your friends."
                      : 'Restored. This may pass to your friends.'}
                  </p>
                ) : null}

                {/* State 2 — Answered */}
                {cardState === 'answered' && result ? (
                  <div className="mt-4 rounded-md bg-muted p-3 text-sm">
                    {/* Comparison copy */}
                    <p className="font-medium">
                      {item.source_type === 'friend_answered'
                        ? comparisonCopy(result.correct, item.friend_results)
                        : result.correct ? `Correct. +${result.points}` : 'Not quite.'}
                    </p>
                    {!result.correct ? <p className="mt-1">Answer: {result.answer}</p> : null}
                    {result.explanation ? <p className="mt-1 text-muted-foreground">{result.explanation}</p> : null}
                    {result.quip ? <p className="mt-1 text-muted-foreground">{result.quip}</p> : null}
                    {result.breadcrumb ? <p className="mt-2 text-muted-foreground italic">{result.breadcrumb}</p> : null}

                    {/* Post-answer actions */}
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        className="inline-flex h-9 items-center gap-2 rounded-md border px-3 text-sm"
                        type="button"
                        onClick={() => void thumbsup(item.id)}
                        disabled={busyId === item.id}
                        title="Great question"
                      >
                        <ThumbsUp className="size-4" />
                        Great question
                      </button>
                      <button
                        className="inline-flex h-9 items-center gap-2 rounded-md border px-3 text-sm text-muted-foreground"
                        type="button"
                        onClick={() => void thumbsdown(item.id)}
                        disabled={busyId === item.id}
                        title="Not a fair question"
                      >
                        <ThumbsDown className="size-4" />
                        Not fair
                      </button>
                      {item.question_id ? (
                        <SendQuestionAction
                          question={{ id: item.question_id, text: item.question_text ?? '', domain: item.domain_pill }}
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
                        onClick={() => void dismissDomain(item.id, item.domain_pill)}
                        disabled={busyId === item.id}
                        title={`Not my focus: ${item.domain_pill}`}
                      >
                        Not my focus
                      </button>
                      {item.question_id ? (
                        <SendQuestionAction
                          question={{ id: item.question_id, text: item.question_text ?? '', domain: item.domain_pill }}
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
