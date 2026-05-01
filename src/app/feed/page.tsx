'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Send, SkipForward, ThumbsUp, X } from 'lucide-react';

type FeedApiItem = {
  id: string;
  kind: 'question' | 'joshing_game';
  source_type: string;
  source_friend_display_name: string;
  source_attribution: string;
  source_event_at: string;
  state: string;
  is_pinned: boolean;
  joshing_game_id: string | null;
  question_text: string | null;
  domain_pill: string;
  game_title: string | null;
};

type FeedResponse = {
  viewer_user_id: string;
  items: FeedApiItem[];
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
};

type ResultState = {
  correct: boolean;
  answer: string;
  explanation: string | null;
  points: number;
  quip: string | null;
};

type JoshingGameFeedView = {
  game: { id: string; title: string };
  creator: { displayName: string };
  questions: Array<{ questionId: string }>;
  recipients: Array<{ userId: string; displayName: string; completedAt: string | null; score: number | null }>;
  responses: Array<{ userId: string; questionId: string; isCorrect: boolean | null }>;
  viewerStatus: 'not_started' | 'in_progress' | 'complete';
};

function formatEventTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(date);
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
          const answered = game.responses.filter((response) => response.userId === recipient.userId);
          const score = recipient.score ?? answered.filter((response) => response.isCorrect).length;
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

export default function FeedPage() {
  const [items, setItems] = useState<FeedApiItem[]>([]);
  const [viewerId, setViewerId] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [results, setResults] = useState<Record<string, ResultState>>({});
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not load your Feed.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadFeed();
  }, [loadFeed]);

  const emptyCopy = useMemo(() => {
    if (loading) return 'Loading your Feed...';
    if (error) return error;
    return "You're caught up. Check back later.";
  }, [error, loading]);

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
      setItems((current) => current.filter((item) => item.id !== itemId));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not update that Feed item.');
    } finally {
      setBusyId(null);
    }
  }, []);

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
        },
      }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not submit that answer.');
    } finally {
      setBusyId(null);
    }
  }, [answers]);

  const thumbsup = useCallback(async (itemId: string) => {
    setBusyId(itemId);
    setError(null);
    try {
      const response = await fetch(`/api/feed/${itemId}/thumbsup`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.message ?? 'Could not record that thumbs-up.');
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not record that thumbs-up.');
    } finally {
      setBusyId(null);
    }
  }, []);

  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col px-4 py-5">
      <header className="mb-5 flex items-end justify-between border-b pb-4">
        <div>
          <p className="text-xs uppercase tracking-[0.1em] text-muted-foreground">Feed</p>
          <h1 className="font-serif text-2xl font-semibold text-foreground">Friend-curated questions</h1>
        </div>
        <span className="text-sm text-muted-foreground">{items.length} waiting</span>
      </header>

      {items.length === 0 ? (
        <section className="flex flex-1 items-center justify-center py-16 text-center">
          <p className={error ? 'text-sm text-destructive' : 'text-sm text-muted-foreground'}>{emptyCopy}</p>
        </section>
      ) : (
        <section className="space-y-3 pb-8">
          {items.map((item) => {
            const result = results[item.id];
            if (item.kind === 'joshing_game') {
              return <JoshingGameCard key={item.id} item={item} viewerId={viewerId} />;
            }

            return (
              <article key={item.id} className="rounded-lg border bg-card p-4 text-card-foreground">
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  {item.is_pinned ? (
                    <span className="rounded-full bg-primary px-2.5 py-1 text-xs text-primary-foreground">Pinned</span>
                  ) : null}
                  <span className="rounded-full bg-secondary px-2.5 py-1 text-xs text-secondary-foreground">
                    {item.domain_pill}
                  </span>
                  <span className="ml-auto text-xs text-muted-foreground">{formatEventTime(item.source_event_at)}</span>
                </div>

                <p className="text-base leading-7 text-foreground">{item.question_text}</p>
                <p className="mt-2 text-sm text-muted-foreground">{item.source_attribution}</p>

                {result ? (
                  <div className="mt-4 rounded-md bg-muted p-3 text-sm">
                    <p className="font-medium">{result.correct ? `Correct. +${result.points}` : 'Not quite.'}</p>
                    {!result.correct ? <p className="mt-1">Answer: {result.answer}</p> : null}
                    {result.explanation ? <p className="mt-1 text-muted-foreground">{result.explanation}</p> : null}
                    {result.quip ? <p className="mt-1 text-muted-foreground">{result.quip}</p> : null}
                    <button
                      className="mt-3 inline-flex h-9 items-center gap-2 rounded-md border px-3 text-sm"
                      type="button"
                      onClick={() => void thumbsup(item.id)}
                      disabled={busyId === item.id}
                      title="Thumbs-up"
                    >
                      <ThumbsUp className="size-4" />
                      Pass it on
                    </button>
                  </div>
                ) : (
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
                    <div className="flex gap-2">
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
                    </div>
                  </form>
                )}
              </article>
            );
          })}
        </section>
      )}
    </main>
  );
}
