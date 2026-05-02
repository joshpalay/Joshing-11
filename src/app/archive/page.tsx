'use client';

import Link from 'next/link';
import { Bookmark, Loader2, Search, Send, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { AddToBankAction } from '@/components/AddToBankAction';
import { SendQuestionAction } from '@/components/SendQuestionAction';
import { QuestionRatingButtons } from '@/components/games/QuestionRatingButtons';
import { cn } from '@/lib/utils';

type ArchiveSource = 'daily' | 'feed' | 'joshing_game' | 'sent_to_me' | 'written_by_me';
type ArchiveResult = 'correct' | 'incorrect' | 'skipped';

type ArchiveItem = {
  id: string;
  questionId: string;
  questionText: string;
  domain: string;
  domainDisplayName: string;
  source: ArchiveSource;
  sourceLabel: string;
  result: ArchiveResult | null;
  submittedAnswer: string | null;
  correctAnswer: string;
  explanation: string | null;
  pointsAwarded: number | null;
  answeredAt: string | null;
  isInBank: boolean;
  myRating: 'up' | 'down' | null;
  canUseQuestionActions?: boolean;
  creatorNote: { authorName: string; noteText: string } | null;
};

type ArchiveFacet = {
  domain: string;
  domainDisplayName: string;
};

type ArchiveResponse = {
  items: ArchiveItem[];
  nextCursor: string | null;
  totalCount: number;
  correctCount: number;
  domains: ArchiveFacet[];
};

type SourceOption = {
  value: ArchiveSource | '';
  label: string;
};

const sourceOptions: SourceOption[] = [
  { value: '', label: 'All' },
  { value: 'daily', label: 'Daily Five' },
  { value: 'feed', label: 'Feed' },
  { value: 'joshing_game', label: 'Joshing Games' },
  { value: 'sent_to_me', label: 'Sent to me' },
  { value: 'written_by_me', label: 'Mine' },
];

const resultOptions: Array<{ value: ArchiveResult | ''; label: string }> = [
  { value: '', label: 'All' },
  { value: 'correct', label: 'Correct' },
  { value: 'incorrect', label: 'Incorrect' },
  { value: 'skipped', label: 'Skipped' },
];

function formatCount(value: number) {
  return new Intl.NumberFormat().format(value);
}

function formatDate(value: string | null) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(date);
}

function resultLabel(item: ArchiveItem) {
  if (item.source === 'written_by_me') return 'AUTHORED';
  if (item.result === 'correct') return 'CORRECT';
  if (item.result === 'incorrect') return 'WRONG';
  return 'SKIPPED';
}

function resultClass(item: ArchiveItem) {
  if (item.source === 'written_by_me') return 'border-sky-200 bg-sky-50 text-sky-700';
  if (item.result === 'correct') return 'border-emerald-200 bg-emerald-50 text-emerald-700';
  if (item.result === 'incorrect') return 'border-rose-200 bg-rose-50 text-rose-700';
  return 'border-stone-200 bg-stone-50 text-stone-600';
}

function sourceLabel(value: ArchiveSource) {
  return sourceOptions.find((option) => option.value === value)?.label ?? value;
}

function buildArchiveUrl(params: {
  source: ArchiveSource | '';
  domain: string;
  result: ArchiveResult | '';
  cursor?: string | null;
}) {
  const search = new URLSearchParams();
  search.set('limit', '50');
  if (params.source) search.set('source', params.source);
  if (params.domain) search.set('domain', params.domain);
  if (params.result) search.set('result', params.result);
  if (params.cursor) search.set('cursor', params.cursor);
  return `/api/archive?${search.toString()}`;
}

export default function ArchivePage() {
  const [source, setSource] = useState<ArchiveSource | ''>('');
  const [domain, setDomain] = useState('');
  const [result, setResult] = useState<ArchiveResult | ''>('');
  const [search, setSearch] = useState('');
  const [items, setItems] = useState<ArchiveItem[]>([]);
  const [domains, setDomains] = useState<ArchiveFacet[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [correctCount, setCorrectCount] = useState(0);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  const loadArchive = useCallback(async (cursor?: string | null) => {
    const isNextPage = Boolean(cursor);
    if (isNextPage) setLoadingMore(true);
    else setLoading(true);
    setError(null);

    try {
      const response = await fetch(buildArchiveUrl({ source, domain, result, cursor }), {
        cache: 'no-store',
        credentials: 'include',
      });
      const body = await response.json().catch(() => null) as ArchiveResponse | { message?: string; error?: string } | null;
      if (!response.ok || !body || !('items' in body)) {
        throw new Error((body as { message?: string; error?: string } | null)?.message ?? 'Could not load your archive.');
      }

      setItems((current) => (isNextPage ? [...current, ...body.items] : body.items));
      setNextCursor(body.nextCursor);
      setDomains(body.domains);
      setTotalCount(body.totalCount);
      setCorrectCount(body.correctCount);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not load your archive.');
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [domain, result, source]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadArchive(null), 0);
    return () => window.clearTimeout(timer);
  }, [loadArchive]);

  useEffect(() => {
    const target = sentinelRef.current;
    if (!target || !nextCursor || loading || loadingMore) return;

    const observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting) void loadArchive(nextCursor);
    }, { rootMargin: '320px' });

    observer.observe(target);
    return () => observer.disconnect();
  }, [loadArchive, loading, loadingMore, nextCursor]);

  const visibleItems = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return items;
    return items.filter((item) => (
      item.questionText.toLowerCase().includes(query)
      || item.correctAnswer.toLowerCase().includes(query)
      || item.domainDisplayName.toLowerCase().includes(query)
    ));
  }, [items, search]);

  const activeFilters = useMemo(() => {
    const chips: Array<{ key: string; label: string; clear: () => void }> = [];
    if (source) chips.push({ key: 'source', label: sourceLabel(source), clear: () => setSource('') });
    if (domain) {
      chips.push({
        key: 'domain',
        label: domains.find((item) => item.domain === domain)?.domainDisplayName ?? domain,
        clear: () => setDomain(''),
      });
    }
    if (result) chips.push({ key: 'result', label: resultOptions.find((option) => option.value === result)?.label ?? result, clear: () => setResult('') });
    return chips;
  }, [domain, domains, result, source]);

  const hasServerFilters = Boolean(source || domain || result);
  const isFilteredEmpty = !loading && items.length === 0 && hasServerFilters;
  const isSearchEmpty = !loading && items.length > 0 && visibleItems.length === 0;

  return (
    <main className="mx-auto min-h-dvh max-w-3xl px-4 py-6 pb-20">
      <header>
        <p className="font-mono text-[0.62rem] uppercase tracking-[0.06em] text-muted-foreground">
          <Link href="/" className="underline underline-offset-2">HOME</Link>
          {' / '}
          <Link href="/account" className="underline underline-offset-2">ACCOUNT</Link>
          {' / ARCHIVE'}
        </p>
        <h1 className="mt-3 font-serif text-4xl font-semibold leading-tight text-foreground">Your Archive</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {formatCount(totalCount)} questions · {formatCount(correctCount)} correct
        </p>
      </header>

      <section className="sticky top-0 z-20 mt-5 border-b bg-background/95 py-3 backdrop-blur">
        <div className="grid gap-2 sm:grid-cols-3">
          <label className="text-xs font-medium uppercase tracking-[0.06em] text-muted-foreground">
            Source
            <select
              className="mt-1 h-10 w-full rounded-md border bg-background px-3 text-sm normal-case tracking-normal text-foreground"
              value={source}
              onChange={(event) => setSource(event.target.value as ArchiveSource | '')}
            >
              {sourceOptions.map((option) => (
                <option key={option.value || 'all'} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
          <label className="text-xs font-medium uppercase tracking-[0.06em] text-muted-foreground">
            Domain
            <select
              className="mt-1 h-10 w-full rounded-md border bg-background px-3 text-sm normal-case tracking-normal text-foreground"
              value={domain}
              onChange={(event) => setDomain(event.target.value)}
            >
              <option value="">All domains</option>
              {domains.map((item) => (
                <option key={item.domain} value={item.domain}>{item.domainDisplayName}</option>
              ))}
            </select>
          </label>
          <label className="text-xs font-medium uppercase tracking-[0.06em] text-muted-foreground">
            Result
            <select
              className="mt-1 h-10 w-full rounded-md border bg-background px-3 text-sm normal-case tracking-normal text-foreground"
              value={result}
              onChange={(event) => setResult(event.target.value as ArchiveResult | '')}
            >
              {resultOptions.map((option) => (
                <option key={option.value || 'all'} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
        </div>

        <label className="relative mt-3 block">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            className="h-11 w-full rounded-md border bg-background pl-10 pr-3 text-sm outline-none focus:border-primary"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search questions..."
          />
        </label>

        {activeFilters.length > 0 ? (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {activeFilters.map((chip) => (
              <button
                key={chip.key}
                type="button"
                className="inline-flex min-h-8 items-center gap-2 rounded-full border bg-card px-3 text-xs text-card-foreground"
                onClick={chip.clear}
              >
                {chip.label}
                <X className="size-3" />
              </button>
            ))}
            <button
              type="button"
              className="text-xs font-medium text-muted-foreground underline underline-offset-2"
              onClick={() => {
                setSource('');
                setDomain('');
                setResult('');
              }}
            >
              Clear all
            </button>
          </div>
        ) : null}
      </section>

      {error ? (
        <section className="mt-8 rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
          {error}
        </section>
      ) : null}

      {loading ? (
        <section className="flex min-h-64 items-center justify-center text-sm text-muted-foreground">
          <Loader2 className="mr-2 size-4 animate-spin" />
          Loading your archive...
        </section>
      ) : visibleItems.length === 0 ? (
        <section className="flex min-h-64 items-center justify-center text-center text-sm text-muted-foreground">
          {isFilteredEmpty || isSearchEmpty ? 'No questions match your filter.' : "Nothing here yet. Play some questions and they'll show up."}
        </section>
      ) : (
        <section className="mt-5 space-y-3">
          {visibleItems.map((item) => (
            <ArchiveCard key={item.id} item={item} />
          ))}
        </section>
      )}

      <div ref={sentinelRef} className="h-8" />
      {!loading && visibleItems.length > 0 ? (
        <div className="py-5 text-center text-sm text-muted-foreground">
          {loadingMore ? (
            <span className="inline-flex items-center gap-2">
              <Loader2 className="size-4 animate-spin" />
              Loading more...
            </span>
          ) : nextCursor ? null : 'End of archive'}
        </div>
      ) : null}
    </main>
  );
}

function ArchiveCard({ item }: { item: ArchiveItem }) {
  const [inBank, setInBank] = useState(item.isInBank);
  const canUseActions = item.canUseQuestionActions !== false;

  return (
    <article className="card p-4">
      <div className="flex items-start justify-between gap-3">
        <p className="font-mono text-[0.62rem] uppercase tracking-[0.06em] text-muted-foreground">
          {item.sourceLabel}
        </p>
        <span className={cn('rounded-sm border px-2 py-1 text-[0.65rem] font-semibold uppercase tracking-[0.08em]', resultClass(item))}>
          {resultLabel(item)}
        </span>
      </div>

      <p className="mt-3 font-medium leading-snug text-foreground">{item.questionText}</p>

      <div className="mt-3 space-y-1 text-sm">
        <p className="text-muted-foreground">
          <span className="font-medium text-foreground">You:</span>{' '}
          {item.source === 'written_by_me'
            ? item.sourceLabel
            : item.result === 'skipped'
              ? 'skipped'
              : item.submittedAnswer?.trim() || 'Not saved'}
        </p>
        <p className="text-muted-foreground">
          <span className="font-medium text-foreground">Answer:</span> {item.correctAnswer || 'No answer available'}
        </p>
      </div>

      {item.explanation ? (
        <details className="mt-3 text-sm leading-6 text-muted-foreground">
          <summary className="cursor-pointer font-medium text-foreground">Explanation</summary>
          <p className="mt-2">{item.explanation}</p>
        </details>
      ) : null}

      {item.creatorNote ? (
        <p className="mt-3 rounded-md border bg-muted/50 p-3 text-sm leading-6 text-foreground">
          <span className="font-medium">A note from {item.creatorNote.authorName}:</span>{' '}
          {item.creatorNote.noteText}
        </p>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <Link
          href={`/knowledge/${encodeURIComponent(item.domain)}`}
          className="rounded-full bg-secondary px-2.5 py-1 font-medium text-secondary-foreground"
        >
          {item.domainDisplayName}
        </Link>
        {item.pointsAwarded !== null ? (
          <span className="font-mono font-semibold text-foreground">+{Math.round(item.pointsAwarded)} pts</span>
        ) : null}
        {item.answeredAt ? <span>· {formatDate(item.answeredAt)}</span> : null}
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
        {canUseActions ? (
          <>
            <QuestionRatingButtons questionId={item.questionId} />
            <SendQuestionAction
              question={{ id: item.questionId, text: item.questionText, domain: item.domainDisplayName }}
              label=""
              className="inline-flex size-9 items-center justify-center rounded-md border text-muted-foreground transition hover:bg-muted hover:text-foreground"
            />
            <AddToBankAction
              questionId={item.questionId}
              initialInBank={inBank}
              contextType={item.source === 'joshing_game' ? 'joshing_game' : item.source === 'feed' || item.source === 'sent_to_me' ? 'feed' : 'manual'}
              contextId={item.id}
              label=""
              className="inline-flex size-9 items-center justify-center rounded-md border px-0"
              onChange={setInBank}
            />
          </>
        ) : (
          <div className="flex items-center gap-2 text-muted-foreground">
            <button className="inline-flex size-9 items-center justify-center rounded-md border opacity-50" type="button" disabled title="Send to friend">
              <Send className="size-4" />
            </button>
            <button className="inline-flex size-9 items-center justify-center rounded-md border opacity-50" type="button" disabled title="Add to bank">
              <Bookmark className="size-4" />
            </button>
          </div>
        )}
      </div>
    </article>
  );
}
