'use client';

import { ChevronDown, Plus, Search, X } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';

import { QuestionForm, type QuestionFormValues } from '@/components/QuestionForm';
import { MyQuestionCard } from '@/components/questions/MyQuestionCard';
import { AnsweredQuestionsList, type AnsweredQuestionItem } from '@/components/questions/AnsweredQuestionsList';
import type { QuestionView } from '@/server/db/queries/questions';

type SortMode = 'newest' | 'most_answered' | 'hardest' | 'easiest';
type OrderMode = 'category' | 'recency';
type Tab = 'authored' | 'answered';
// Capability 8 (B-4 Stage A): the CreateChooser passes a three-way intent that
// pre-selects the composer's destinations. 'followers' maps to D-1 Stage 4's
// 'friends' visibility (followers-only) — not a hardcoded 'public'.
type CreateIntent = 'bank' | 'followers' | 'specific';
type DrawerState =
  | { mode: 'closed' }
  // intent is null for the page's own "Write a question" buttons (and the
  // legacy `?create=1` link), which keep the form's existing defaults. Only the
  // CreateChooser supplies an explicit intent.
  | { mode: 'create'; intent: CreateIntent | null; prefillText?: string }
  | { mode: 'edit'; question: QuestionView };

function parseIntent(raw: string | null): CreateIntent | null {
  return raw === 'bank' || raw === 'followers' || raw === 'specific' ? raw : null;
}

// Translate the create intent into the QuestionForm's initial destination
// state. The form still surfaces every control, so these are starting points
// the author can adjust — not a locked mode. A null intent returns no
// overrides, preserving the form's pre-existing default destinations.
function createFormProps(intent: CreateIntent | null): {
  initialValues?: Partial<QuestionFormValues>;
  initialSpecificMode?: boolean;
} {
  switch (intent) {
    case 'followers':
      return { initialValues: { shareToFeed: true, visibility: 'friends' } };
    case 'specific':
      return { initialSpecificMode: true };
    case 'bank':
      return { initialValues: { shareToFeed: false } };
    default:
      return {};
  }
}

type AnsweredApiResponse = {
  items?: AnsweredQuestionItem[];
  error?: string;
  message?: string;
};

type QuestionsApiResponse = {
  questions?: QuestionView[] | null;
  message?: string;
  error?: string;
};

type CreateQuestionResponse = {
  question?: QuestionView;
  id?: string;
  error?: string;
  message?: string;
  feedShare?: {
    requested: boolean;
    createdCount: number;
    friendCount?: number;
    sharedRecipientIds?: string[];
    skippedDismissedDomainRecipientIds?: string[];
    skippedExistingFeedRecipientIds?: string[];
  };
};

const NO_QUESTIONS_PATTERNS = [
  /no questions/i,
  /not found/i,
  /empty/i,
];

function isNoQuestionsResponse(response: Response, body: QuestionsApiResponse | null): boolean {
  const apiMessage = body?.message ?? body?.error ?? '';
  return response.status === 204
    || response.status === 404
    || NO_QUESTIONS_PATTERNS.some((pattern) => pattern.test(apiMessage));
}

function initialValues(question: QuestionView): QuestionFormValues {
  return {
    text: question.text,
    correctAnswer: question.correctAnswer,
    alternateAnswers: question.alternateAnswers,
    explanation: question.explanation,
    verified: question.verified,
    llmSuggestedAnswer: question.llmSuggestedAnswer,
    critiqueIterations: question.critiqueIterations,
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
  const router = useRouter();
  const pathname = usePathname();
  const [tab, setTab] = useState<Tab>('authored');
  const [questions, setQuestions] = useState<QuestionView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [answered, setAnswered] = useState<AnsweredQuestionItem[] | null>(null);
  const [answeredLoading, setAnsweredLoading] = useState(false);
  const [answeredError, setAnsweredError] = useState<string | null>(null);
  const [orderMode, setOrderMode] = useState<OrderMode>('recency');
  const [sortMode, setSortMode] = useState<SortMode>('newest');
  const [search, setSearch] = useState('');
  // The composer (create) drawer is driven by the URL so the global Nav FAB,
  // the CreateChooser, and the feed footer can all open it by navigating to
  // ?create=1 — including when we're already on /questions, where the page
  // doesn't remount. The editor (edit) drawer is local, opened by a card.
  const [editingQuestion, setEditingQuestion] = useState<QuestionView | null>(null);
  const createRequested = searchParams.get('create') === '1';
  const drawer: DrawerState = editingQuestion
    ? { mode: 'edit', question: editingQuestion }
    : createRequested
      ? {
          mode: 'create',
          intent: parseIntent(searchParams.get('intent')),
          // The feed's "what would you like to be asked?" prompt rides the idea
          // in via ?text= so the composer opens pre-filled with the reader's words.
          prefillText: searchParams.get('text')?.trim() || undefined,
        }
      : { mode: 'closed' };
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [cardError, setCardError] = useState<Record<string, string>>({});
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const loadQuestions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/questions', { cache: 'no-store', credentials: 'include' });
      const body = await response.json().catch(() => null) as QuestionsApiResponse | null;
      if (isNoQuestionsResponse(response, body)) {
        setQuestions([]);
        return;
      }
      if (!response.ok || !Array.isArray(body?.questions)) throw new Error(body?.message ?? body?.error ?? 'Could not load your questions.');
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

  const loadAnswered = useCallback(async () => {
    setAnsweredLoading(true);
    setAnsweredError(null);
    try {
      const response = await fetch('/api/questions/answered', { cache: 'no-store', credentials: 'include' });
      const body = await response.json().catch(() => null) as AnsweredApiResponse | null;
      if (!response.ok || !Array.isArray(body?.items)) {
        throw new Error(body?.message ?? body?.error ?? 'Could not load your answered questions.');
      }
      setAnswered(body.items);
    } catch (caught) {
      setAnsweredError(caught instanceof Error ? caught.message : 'Could not load your answered questions.');
    } finally {
      setAnsweredLoading(false);
    }
  }, []);

  useEffect(() => {
    if (answered !== null || answeredLoading || answeredError) return;
    void Promise.resolve().then(loadAnswered);
  }, [answered, answeredLoading, answeredError, loadAnswered]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 2200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  // Strip the composer params from the URL (no-op if none are present). Keeping
  // this separate lets the FAB reopen the composer with a fresh ?create=1 push —
  // a same-URL push would otherwise be a no-op and leave the drawer closed.
  const clearComposerParams = useCallback(() => {
    if (searchParams.has('create') || searchParams.has('intent') || searchParams.has('text')) {
      router.replace(pathname, { scroll: false });
    }
  }, [pathname, router, searchParams]);

  const openComposer = useCallback(() => {
    router.push('/questions?create=1', { scroll: false });
  }, [router]);

  const openEditor = useCallback((question: QuestionView) => {
    setEditingQuestion(question);
    // The editor takes precedence over a URL-driven composer; clear the params
    // so closing the editor returns to the list instead of reopening it.
    clearComposerParams();
  }, [clearComposerParams]);

  const closeDrawer = useCallback(() => {
    setEditingQuestion(null);
    clearComposerParams();
  }, [clearComposerParams]);

  const totalAnswersReceived = useMemo(
    () => questions.reduce((total, question) => total + question.timesAnswered, 0),
    [questions],
  );

  const answeredCountLabel = answered === null ? (answeredLoading ? '…' : '—') : String(answered.length);

  const filteredQuestions = useMemo(() => {
    const query = search.trim().toLowerCase();
    return questions
      .filter((question) => !query || question.text.toLowerCase().includes(query))
      .slice()
      .sort((a, b) => {
        // "By category" groups questions by their domain name (e.g. Literature),
        // then falls back to the secondary sort within each category.
        if (orderMode === 'category') {
          const byCategory = a.domainDisplayName.localeCompare(b.domainDisplayName);
          if (byCategory !== 0) return byCategory;
        }
        if (sortMode === 'most_answered') return b.timesAnswered - a.timesAnswered || Date.parse(b.createdAt) - Date.parse(a.createdAt);
        if (sortMode === 'hardest') return a.correctRate - b.correctRate || b.timesAnswered - a.timesAnswered;
        if (sortMode === 'easiest') return b.correctRate - a.correctRate || b.timesAnswered - a.timesAnswered;
        return Date.parse(b.createdAt) - Date.parse(a.createdAt);
      });
  }, [orderMode, questions, search, sortMode]);

  function clearFilters() {
    setOrderMode('recency');
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
    const body = await response.json().catch(() => null) as CreateQuestionResponse | null;
    if (!response.ok || !body?.question) throw new Error(body?.message ?? body?.error ?? 'Could not save that question.');
    setQuestions((current) => [body.question!, ...current]);
    closeDrawer();
    if (values.sendToFriendIds.length > 0) {
      const n = values.sendToFriendIds.length;
      setToast(`Sent to ${n} ${n === 1 ? 'friend' : 'friends'}.`);
    } else if (body.feedShare?.createdCount && body.feedShare.createdCount > 0) {
      const n = body.feedShare.createdCount;
      setToast(`Saved and shared with ${n} ${n === 1 ? 'friend' : 'friends'}.`);
    } else if (body.feedShare?.requested && body.feedShare.createdCount === 0) {
      setToast('No friends received this because they already had it or filtered that domain.');
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
    const body = await response.json().catch(() => null) as { question?: QuestionView; error?: string; message?: string } | null;
    if (!response.ok || !body?.question) throw new Error(body?.message ?? body?.error ?? 'Could not update that question.');
    setQuestions((current) => current.map((question) => question.id === questionId ? body.question! : question));
    closeDrawer();
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

  if (loading && tab === 'authored') return <LoadingSkeleton />;

  if (error && tab === 'authored') {
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
      <section className="mb-5 grid grid-cols-2 gap-3" aria-label="Question activity metrics">
        <div className="rounded-md border bg-muted/30 px-4 py-3">
          <p className="text-xs uppercase tracking-[0.1em] text-muted-foreground">Answers gotten</p>
          <p className="mt-1 font-serif text-3xl font-semibold">{totalAnswersReceived}</p>
        </div>
        <div className="rounded-md border bg-muted/30 px-4 py-3">
          <p className="text-xs uppercase tracking-[0.1em] text-muted-foreground">Questions answered</p>
          <p className="mt-1 font-serif text-3xl font-semibold">{answeredCountLabel}</p>
        </div>
      </section>

      <div className="mb-5 flex border-b">
        <button
          type="button"
          className={`px-4 py-2.5 text-sm font-medium transition-colors ${
            tab === 'authored'
              ? 'border-b-2 border-foreground text-foreground'
              : 'text-muted-foreground hover:text-foreground'
          }`}
          onClick={() => setTab('authored')}
        >
          Your Questions
        </button>
        <button
          type="button"
          className={`px-4 py-2.5 text-sm font-medium transition-colors ${
            tab === 'answered'
              ? 'border-b-2 border-foreground text-foreground'
              : 'text-muted-foreground hover:text-foreground'
          }`}
          onClick={() => setTab('answered')}
        >
          Answered
        </button>
      </div>

      {tab === 'authored' ? (
        <>
          <header className="mb-5 flex flex-col gap-4 border-b pb-5 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h1 className="font-serif text-3xl font-semibold">Your Questions</h1>
              <p className="mt-1 text-sm text-muted-foreground">{questions.length} questions</p>
            </div>
            <button className="btn-primary inline-flex items-center gap-2" type="button" onClick={openComposer}>
              <Plus className="size-4" />
              Write a question
            </button>
          </header>

          <section className="mb-4 grid grid-cols-2 gap-2 rounded-md border bg-muted/30 p-2 sm:grid-cols-[1fr_1fr_2fr]" aria-label="Question filters">
            <label className="relative">
              <select
                value={orderMode}
                onChange={(event) => setOrderMode(event.target.value as OrderMode)}
                className="h-10 w-full appearance-none rounded-md border bg-background px-3 pr-9 text-sm outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
                aria-label="Order by"
              >
                <option value="recency">By recency</option>
                <option value="category">By category</option>
              </select>
              <ChevronDown className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            </label>
            <label className="relative">
              <select
                value={sortMode}
                onChange={(event) => setSortMode(event.target.value as SortMode)}
                className="h-10 w-full appearance-none rounded-md border bg-background px-3 pr-9 text-sm outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
                aria-label="Sort by"
              >
                <option value="newest">Newest</option>
                <option value="most_answered">Most answered</option>
                <option value="hardest">Hardest</option>
                <option value="easiest">Easiest</option>
              </select>
              <ChevronDown className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            </label>
            <label className="relative col-span-2 sm:col-span-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search questions..."
                className="h-10 w-full rounded-md border bg-background pl-10 pr-3 text-sm outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
              />
            </label>
          </section>

          {questions.length === 0 ? (
            <section className="flex flex-1 flex-col items-center justify-center py-16 text-center">
              <h2 className="font-serif text-2xl font-semibold">No questions yet.</h2>
              <p className="mt-2 max-w-sm text-sm text-muted-foreground">
                You haven&apos;t written any questions yet. Write one to get started.
              </p>
              <button className="btn-primary mt-5" type="button" onClick={openComposer}>
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
            <section className="divide-y divide-border border-t border-border">
              {filteredQuestions.map((question) => (
                <MyQuestionCard
                  key={question.id}
                  question={question}
                  confirming={confirmingId === question.id}
                  cardError={cardError[question.id]}
                  deleting={removingId === question.id}
                  onEdit={() => openEditor(question)}
                  onDeleteRequest={() => setConfirmingId(question.id)}
                  onConfirmDelete={() => void confirmDelete(question)}
                  onCancelConfirm={() => setConfirmingId(null)}
                />
              ))}
            </section>
          )}
        </>
      ) : (
        <>
          <header className="mb-5 border-b pb-5">
            <h1 className="font-serif text-3xl font-semibold">Answered</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {answered === null ? 'Loading…' : `${answered.length} answered`}
            </p>
          </header>

          {answeredLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 4 }).map((_, index) => (
                <div key={index} className="h-16 animate-pulse rounded-lg border bg-card" />
              ))}
            </div>
          ) : answeredError ? (
            <section className="flex flex-1 flex-col items-center justify-center py-16 text-center">
              <h2 className="font-serif text-2xl font-semibold">Could not load your answers</h2>
              <p className="mt-2 text-sm text-muted-foreground">{answeredError}</p>
              <button className="btn-primary mt-5" type="button" onClick={() => void loadAnswered()}>
                Try again
              </button>
            </section>
          ) : (
            <AnsweredQuestionsList items={answered ?? []} />
          )}
        </>
      )}

      {drawer.mode !== 'closed' ? (
        <div className="fixed inset-0 z-[60] flex items-end bg-black/35 md:items-stretch md:justify-end" role="dialog" aria-modal="true">
          <button className="absolute inset-0 cursor-default" type="button" aria-label="Close" onClick={closeDrawer} />
          <aside className="relative max-h-[92dvh] w-full overflow-y-auto rounded-t-lg bg-background px-5 pt-5 shadow-xl md:h-full md:max-h-none md:w-[440px] md:rounded-none">
            <div className="mb-5 flex items-center justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.1em] text-muted-foreground">{drawer.mode === 'edit' ? 'Edit' : 'Create'}</p>
                <h2 className="font-serif text-2xl font-semibold">{drawer.mode === 'edit' ? 'Edit question' : 'Write a question'}</h2>
              </div>
              <button className="rounded-md border p-2 hover:bg-muted" type="button" onClick={closeDrawer} title="Close">
                <X className="size-4" />
              </button>
            </div>
            <QuestionForm
              mode={drawer.mode}
              initialValues={drawer.mode === 'edit'
                ? initialValues(drawer.question)
                : { ...createFormProps(drawer.intent).initialValues, ...(drawer.prefillText ? { text: drawer.prefillText } : {}) }}
              initialSpecificMode={drawer.mode === 'create' ? createFormProps(drawer.intent).initialSpecificMode : undefined}
              onSubmit={drawer.mode === 'edit' ? (values) => saveEdit(drawer.question.id, values) : saveCreate}
              onCancel={closeDrawer}
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
