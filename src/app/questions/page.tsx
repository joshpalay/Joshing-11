'use client';

import { Lock, Pencil, Plus, Search, Trash2, X } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';

import { QuestionForm, type QuestionFormValues } from '@/components/QuestionForm';
import { SendQuestionAction } from '@/components/SendQuestionAction';
import { CATEGORIES, categoryLabel } from '@/lib/questions-types';
import type { QuestionView } from '@/server/db/queries/questions';

type SortMode = 'newest' | 'most_answered' | 'hardest' | 'easiest';
type OwnershipFilter = 'all' | 'mine' | 'saved';
type DrawerState =
  | { mode: 'closed' }
  | { mode: 'create' }
  | { mode: 'edit'; question: QuestionView };


const DIFFICULTY_COPY: Record<number, string> = {
  1: 'Accessible',
  2: 'Accessible → Moderate',
  3: 'Moderate',
  4: 'Moderate → Specialist',
  5: 'Specialist',
};

const DOMAIN_COLORS: Record<string, string> = {
  music: '#7c3aed',
  literature: '#0f766e',
  history: '#b45309',
  film_tv: '#be123c',
  sport: '#15803d',
  science: '#2563eb',
  philosophy: '#6d28d9',
  pop_culture: '#db2777',
  language: '#0369a1',
  other: '#64748b',
};

function relativeTime(value: string | null): string {
  if (!value) return 'Unused';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unused';
  const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days}d ago`;
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(date);
}

function difficultyDots(value: number) {
  return Array.from({ length: 5 }, (_, index) => index < value ? '●' : '○').join(' ');
}

function initialValues(question: QuestionView): QuestionFormValues {
  return {
    text: question.text,
    correctAnswer: question.correctAnswer,
    alternateAnswers: question.alternateAnswers,
    explanation: question.explanation,
    domain: question.domain,
    difficulty: question.difficulty,
    sendToFriendIds: [],
  };
}

function LoadingSkeleton() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-4xl flex-col px-4 py-6 pb-24">
      <div className="mb-5 h-20 animate-pulse rounded-lg bg-muted" />
      <div className="mb-5 h-14 animate-pulse rounded-lg bg-muted" />
      <div className="space-y-3">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="h-36 animate-pulse rounded-lg border bg-card" />
        ))}
      </div>
    </main>
  );
}

export default function QuestionsPage() {
  return (
    <Suspense fallback={<LoadingSkeleton />}>
      <QuestionsPageContent />
    </Suspense>
  );
}

function QuestionsPageContent() {
  const searchParams = useSearchParams();
  const [questions, setQuestions] = useState<QuestionView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [domainFilter, setDomainFilter] = useState('all');
  const [ownershipFilter, setOwnershipFilter] = useState<OwnershipFilter>('all');
  const [sortMode, setSortMode] = useState<SortMode>('newest');
  const [search, setSearch] = useState('');
  const [drawer, setDrawer] = useState<DrawerState>(() => (
    searchParams.get('create') === '1' ? { mode: 'create' } : { mode: 'closed' }
  ));
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [cardError, setCardError] = useState<Record<string, string>>({});
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const loadQuestions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/questions', { cache: 'no-store', credentials: 'include' });
      const body = await response.json().catch(() => null) as { questions?: QuestionView[]; message?: string } | null;
      if (!response.ok || !Array.isArray(body?.questions)) throw new Error(body?.message ?? 'Could not load your questions.');
      setQuestions(body.questions);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not load your questions.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void Promise.resolve().then(loadQuestions);
  }, [loadQuestions]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 2200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const availableDomains = useMemo(() => {
    const seen = new Set(questions.map((question) => question.domain));
    return CATEGORIES.filter((category) => seen.has(category));
  }, [questions]);

  const filteredQuestions = useMemo(() => {
    const query = search.trim().toLowerCase();
    return questions
      .filter((question) => (
        ownershipFilter === 'all'
          || (ownershipFilter === 'mine' ? question.isOwnAuthored : !question.isOwnAuthored)
      ))
      .filter((question) => domainFilter === 'all' || question.domain === domainFilter)
      .filter((question) => !query || question.text.toLowerCase().includes(query))
      .slice()
      .sort((a, b) => {
        if (sortMode === 'most_answered') return b.timesAnswered - a.timesAnswered || Date.parse(b.createdAt) - Date.parse(a.createdAt);
        if (sortMode === 'hardest') return a.correctRate - b.correctRate || b.timesAnswered - a.timesAnswered;
        if (sortMode === 'easiest') return b.correctRate - a.correctRate || b.timesAnswered - a.timesAnswered;
        return Date.parse(b.createdAt) - Date.parse(a.createdAt);
      });
  }, [domainFilter, ownershipFilter, questions, search, sortMode]);

  function clearFilters() {
    setDomainFilter('all');
    setOwnershipFilter('all');
    setSortMode('newest');
    setSearch('');
  }

  async function saveCreate(values: QuestionFormValues) {
    const response = await fetch('/api/questions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(values),
    });
    const body = await response.json().catch(() => null) as { question?: QuestionView; id?: string; error?: string } | null;
    if (!response.ok || !body?.question) throw new Error(body?.error ?? 'Could not save that question.');
    setQuestions((current) => [body.question!, ...current]);
    setDrawer({ mode: 'closed' });
    if (values.sendToFriendIds.length > 0) {
      const n = values.sendToFriendIds.length;
      setToast(`Sent to ${n} ${n === 1 ? 'friend' : 'friends'}.`);
    } else {
      setToast('Saved to your bank.');
    }
  }

  async function saveEdit(questionId: string, values: QuestionFormValues) {
    const response = await fetch(`/api/questions/${questionId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(values),
    });
    const body = await response.json().catch(() => null) as { question?: QuestionView; error?: string } | null;
    if (!response.ok || !body?.question) throw new Error(body?.error ?? 'Could not update that question.');
    setQuestions((current) => current.map((question) => question.id === questionId ? body.question! : question));
    setDrawer({ mode: 'closed' });
    setToast('Question updated.');
  }

  async function confirmDelete(question: QuestionView) {
    setCardError((current) => ({ ...current, [question.id]: '' }));
    const response = question.isOwnAuthored
      ? await fetch(`/api/questions/${question.id}`, {
          method: 'DELETE',
          credentials: 'include',
        })
      : await fetch('/api/bank', {
          method: 'DELETE',
          headers: { 'content-type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ questionId: question.id }),
        });
    if (response.status === 409) {
      setCardError((current) => ({ ...current, [question.id]: 'This question has been used in a game.' }));
      setConfirmingId(null);
      return;
    }
    if (!response.ok) {
      setCardError((current) => ({ ...current, [question.id]: 'Could not delete this question.' }));
      setConfirmingId(null);
      return;
    }
    setRemovingId(question.id);
    window.setTimeout(() => {
      setQuestions((current) => current.filter((item) => item.id !== question.id));
      setRemovingId(null);
    }, 180);
  }

  if (loading) return <LoadingSkeleton />;

  if (error) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-2xl flex-col items-center justify-center px-4 py-10 text-center">
        <h1 className="font-serif text-3xl font-semibold">Could not load your questions</h1>
        <p className="mt-3 text-sm text-muted-foreground">{error}</p>
        <button className="btn-primary mt-5" type="button" onClick={() => void loadQuestions()}>
          Try again
        </button>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-4xl flex-col px-4 py-6 pb-24">
      <header className="mb-5 flex flex-col gap-4 border-b pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-serif text-3xl font-semibold">Your Questions</h1>
          <p className="mt-1 text-sm text-muted-foreground">{questions.length} banked questions</p>
        </div>
        <button className="btn-primary inline-flex items-center gap-2" type="button" onClick={() => setDrawer({ mode: 'create' })}>
          <Plus className="size-4" />
          Write a question
        </button>
      </header>

      <section className="mb-4 flex flex-wrap gap-2">
        {(['all', 'mine', 'saved'] as OwnershipFilter[]).map((filter) => (
          <button
            key={filter}
            type="button"
            onClick={() => setOwnershipFilter(filter)}
            className={`rounded-md border px-3 py-2 text-sm ${ownershipFilter === filter ? 'border-primary bg-primary text-primary-foreground' : 'bg-card hover:bg-muted'}`}
          >
            {filter === 'all' ? 'All' : filter === 'mine' ? 'Mine' : 'Saved'}
          </button>
        ))}
      </section>

      <section className="mb-5 grid gap-3 rounded-lg border bg-card p-3 sm:grid-cols-[1fr_1fr_2fr]">
        <select
          value={domainFilter}
          onChange={(event) => setDomainFilter(event.target.value)}
          className="h-11 rounded-md border bg-background px-3 text-sm"
          aria-label="Filter by domain"
        >
          <option value="all">All domains</option>
          {availableDomains.map((domain) => (
            <option key={domain} value={domain}>{categoryLabel(domain)}</option>
          ))}
        </select>
        <select
          value={sortMode}
          onChange={(event) => setSortMode(event.target.value as SortMode)}
          className="h-11 rounded-md border bg-background px-3 text-sm"
          aria-label="Sort by"
        >
          <option value="newest">Newest</option>
          <option value="most_answered">Most answered</option>
          <option value="hardest">Hardest</option>
          <option value="easiest">Easiest</option>
        </select>
        <label className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search questions..."
            className="h-11 w-full rounded-md border bg-background pl-10 pr-3 text-sm outline-none focus:border-primary"
          />
        </label>
      </section>

      {questions.length === 0 ? (
        <section className="flex flex-1 flex-col items-center justify-center py-16 text-center">
          <h2 className="font-serif text-2xl font-semibold">You haven&apos;t written any questions yet.</h2>
          <button className="btn-primary mt-5" type="button" onClick={() => setDrawer({ mode: 'create' })}>
            Write a question
          </button>
        </section>
      ) : filteredQuestions.length === 0 ? (
        <section className="flex flex-1 flex-col items-center justify-center py-16 text-center">
          <h2 className="font-serif text-2xl font-semibold">No questions match your filter.</h2>
          <button className="mt-3 text-sm text-primary underline" type="button" onClick={clearFilters}>
            Clear filters
          </button>
        </section>
      ) : (
        <section className="space-y-3">
          {filteredQuestions.map((question) => {
            const isOwnAuthored = question.isOwnAuthored ?? true;
            const inUse = question.usedInGamesCount > 0;
            const color = DOMAIN_COLORS[question.domain] ?? '#64748b';
            const deleting = removingId === question.id;

            return (
              <article
                key={question.id}
                className={`rounded-lg border bg-card p-4 text-card-foreground transition duration-200 ${deleting ? 'scale-[0.98] opacity-0' : 'opacity-100'}`}
              >
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <span
                    className="rounded-full px-2.5 py-1 text-xs font-medium text-white"
                    style={{ backgroundColor: color }}
                  >
                    {question.domainDisplayName}
                  </span>
                  <span className="font-mono text-xs text-muted-foreground" aria-label={`Difficulty ${question.difficulty} of 5 (${DIFFICULTY_COPY[question.difficulty] ?? 'Unrated'})`}>
                    {difficultyDots(question.difficulty)}
                    {' · '}
                    {question.difficulty}/5 {DIFFICULTY_COPY[question.difficulty] ?? 'Unrated'}
                  </span>
                  <span className="rounded-sm border px-2 py-1 text-[0.65rem] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                    {isOwnAuthored ? 'Written by you' : `From ${question.authorName ?? 'a friend'}`}
                  </span>
                </div>
                <p className="line-clamp-2 text-base font-medium leading-7">{question.text}</p>
                <div className="mt-4 grid gap-1 text-sm text-muted-foreground sm:grid-cols-2">
                  <p>{question.timesAnswered} answers · {question.correctRate}% correct · {question.usedInGamesCount} games</p>
                  <p className="sm:text-right">Last used: {relativeTime(question.lastUsedAt)}</p>
                </div>
                {cardError[question.id] ? <p className="mt-3 text-sm text-destructive">{cardError[question.id]}</p> : null}
                <div className="mt-4 flex items-center gap-2">
                  {confirmingId === question.id ? (
                    <>
                      <span className="mr-auto text-sm font-medium">Delete this question?</span>
                      <button className="rounded-md border border-destructive px-3 py-2 text-sm text-destructive" type="button" onClick={() => void confirmDelete(question)}>
                        Confirm
                      </button>
                      <button className="rounded-md border px-3 py-2 text-sm" type="button" onClick={() => setConfirmingId(null)}>
                        Cancel
                      </button>
                    </>
                  ) : (
                    <>
                      {!isOwnAuthored ? (
                        <span className="inline-flex min-h-10 items-center gap-2 rounded-md border px-3 text-sm text-muted-foreground" title="Original author only">
                          <Lock className="size-4" />
                          Edit
                        </span>
                      ) : inUse ? (
                        <span className="inline-flex min-h-10 items-center gap-2 rounded-md border px-3 text-sm text-muted-foreground" title="Used in a game - cannot be edited">
                          <Lock className="size-4" />
                          Edit
                        </span>
                      ) : (
                        <button className="inline-flex min-h-10 items-center gap-2 rounded-md border px-3 text-sm hover:bg-muted" type="button" onClick={() => setDrawer({ mode: 'edit', question })}>
                          <Pencil className="size-4" />
                          Edit
                        </button>
                      )}
                      {isOwnAuthored && inUse ? (
                        <span className="inline-flex min-h-10 items-center gap-2 rounded-md border px-3 text-sm text-muted-foreground" title="Used in a game - cannot be edited">
                          <Lock className="size-4" />
                          Delete
                        </span>
                      ) : (
                        <button className="inline-flex min-h-10 items-center gap-2 rounded-md border px-3 text-sm hover:bg-muted" type="button" onClick={() => setConfirmingId(question.id)}>
                          <Trash2 className="size-4" />
                          Delete
                        </button>
                      )}
                      <SendQuestionAction
                        question={{ id: question.id, text: question.text, domain: question.domainDisplayName }}
                      />
                    </>
                  )}
                </div>
              </article>
            );
          })}
        </section>
      )}

      {drawer.mode !== 'closed' ? (
        <div className="fixed inset-0 z-50 flex items-end bg-black/35 md:items-stretch md:justify-end" role="dialog" aria-modal="true">
          <button className="absolute inset-0 cursor-default" type="button" aria-label="Close" onClick={() => setDrawer({ mode: 'closed' })} />
          <aside className="relative max-h-[92dvh] w-full overflow-y-auto rounded-t-lg bg-background p-5 shadow-xl md:h-full md:max-h-none md:w-[440px] md:rounded-none">
            <div className="mb-5 flex items-center justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.1em] text-muted-foreground">{drawer.mode === 'edit' ? 'Edit' : 'Create'}</p>
                <h2 className="font-serif text-2xl font-semibold">{drawer.mode === 'edit' ? 'Edit question' : 'Write a question'}</h2>
              </div>
              <button className="rounded-md border p-2 hover:bg-muted" type="button" onClick={() => setDrawer({ mode: 'closed' })} title="Close">
                <X className="size-4" />
              </button>
            </div>
            <QuestionForm
              mode={drawer.mode}
              initialValues={drawer.mode === 'edit' ? initialValues(drawer.question) : undefined}
              onSubmit={drawer.mode === 'edit' ? (values) => saveEdit(drawer.question.id, values) : saveCreate}
              onCancel={() => setDrawer({ mode: 'closed' })}
            />
          </aside>
        </div>
      ) : null}

      {toast ? (
        <div className="fixed bottom-24 left-1/2 z-50 -translate-x-1/2 rounded-full bg-foreground px-4 py-2 text-sm text-background shadow-lg md:bottom-8">
          {toast}
        </div>
      ) : null}
    </main>
  );
}
