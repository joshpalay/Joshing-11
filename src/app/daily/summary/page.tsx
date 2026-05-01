'use client';

import Link from 'next/link';
import { ThumbsDown, ThumbsUp } from 'lucide-react';
import { type CSSProperties, useCallback, useEffect, useMemo, useState, useTransition } from 'react';

import { cn } from '@/lib/utils';
import type { DailySummaryView, QuestionRecap, TierCrossing } from '@/server/db/queries/daily-summary';

type FeedbackSignal = 'thumbs_up' | 'thumbs_down';

const monoStyle: CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: '0.62rem',
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
};

const titleStyle: CSSProperties = {
  fontFamily: 'var(--font-neutral), system-ui, sans-serif',
  fontSize: '1.05rem',
  fontWeight: 600,
  color: '#111111',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
};

const domainPalette = ['#178245', '#b7791f', '#2563eb', '#9f1239', '#6d28d9', '#0f766e'];

function formatDate(value: string) {
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, { month: 'long', day: 'numeric', year: 'numeric' }).format(date);
}

function domainColor(domain: string) {
  const total = [...domain].reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return domainPalette[total % domainPalette.length] ?? domainPalette[0];
}

function formatTier(tier: string) {
  return tier.replace(/_/g, ' ').toUpperCase();
}

function interpretiveLine(summary: DailySummaryView) {
  const crossing = summary.tierCrossings[0];
  if (crossing) {
    const domain = summary.domainGains.find((gain) => gain.domain === crossing.domain)?.displayName ?? crossing.domain;
    return `You crossed into ${formatTier(crossing.toTier).toLowerCase()} in ${domain}.`;
  }
  const newDomain = summary.domainGains.find((gain) => gain.isNewTerritory);
  if (newDomain) return `You picked up something new in ${newDomain.displayName}.`;
  if (summary.questions.length > 0 && summary.totalCorrect === summary.questions.length) return 'Clean sweep.';
  return null;
}

export default function DailySummaryPage() {
  const [summary, setSummary] = useState<DailySummaryView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const response = await fetch('/api/daily/summary', { credentials: 'include', cache: 'no-store' });
        const body = await response.json().catch(() => null);
        if (!response.ok) throw new Error(body?.message ?? 'Could not load your daily summary.');
        if (!cancelled) setSummary(body as DailySummaryView);
      } catch (caught) {
        if (!cancelled) setError(caught instanceof Error ? caught.message : 'Could not load your daily summary.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const line = useMemo(() => summary ? interpretiveLine(summary) : null, [summary]);

  if (loading) {
    return (
      <main className="mx-auto min-h-dvh max-w-3xl px-4 py-6">
        <p style={{ ...monoStyle, color: 'var(--text-muted)' }}>Loading summary...</p>
      </main>
    );
  }

  if (error || !summary) {
    return (
      <main className="mx-auto min-h-dvh max-w-3xl px-4 py-6">
        <p className="text-sm text-muted-foreground">{error ?? 'No summary is ready yet.'}</p>
        <Link className="btn-ghost mt-4" href="/">Back home</Link>
      </main>
    );
  }

  return (
    <main className="mx-auto min-h-dvh max-w-3xl px-4 py-6">
      <header>
        <p style={{ ...monoStyle, color: 'var(--text-muted)' }}>
          <Link href="/" className="underline underline-offset-2">HOME</Link>
          {' / DAILY FIVE / SUMMARY'}
        </p>
        <h1
          style={{
            marginTop: '10px',
            fontFamily: 'var(--font-neutral), system-ui, sans-serif',
            fontSize: '1.45rem',
            fontWeight: 700,
            color: '#111111',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
          }}
        >
          How You Did
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">{formatDate(summary.date)}</p>
      </header>

      <section
        className="mt-5 rounded-md border px-5 py-5"
        style={{
          background: 'color-mix(in srgb, var(--success) 10%, var(--surface))',
          borderColor: 'color-mix(in srgb, var(--success) 22%, var(--border))',
        }}
      >
        <p style={{ ...monoStyle, color: 'var(--text-muted)' }}>Total</p>
        <p className="mt-2 font-mono text-5xl font-bold leading-none text-[#111111]">
          +{Math.round(summary.pointsEarned)}
        </p>
        <p style={{ ...monoStyle, marginTop: '12px', color: 'var(--text-muted)' }}>
          {summary.totalCorrect}/{summary.questions.length} correct
          {summary.totalSkipped > 0 ? ` · ${summary.totalSkipped} skipped` : ''}
        </p>
      </section>

      <section className="mt-6">
        <h2 style={titleStyle}>Round Recap</h2>
        <div className="mt-3 space-y-3">
          {summary.questions.map((question) => (
            <QuestionCard key={question.questionId} question={question} />
          ))}
        </div>
      </section>

      <section className="card mt-4 px-5 py-4">
        <h2 style={titleStyle}>Your Growth Recap</h2>
        {summary.domainGains.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">No mastery movement was recorded today.</p>
        ) : (
          <div className="mt-3 divide-y">
            {summary.domainGains.map((gain) => {
              const crossing = summary.tierCrossings.find((item) => item.domain === gain.domain);
              return (
                <div key={gain.domain} className="flex items-center gap-3 py-3">
                  <span
                    className="h-4 w-4 shrink-0 rounded-full border"
                    style={{
                      background: gain.isNewTerritory ? 'var(--muted)' : domainColor(gain.domain),
                      borderColor: gain.isNewTerritory ? 'var(--border)' : 'transparent',
                    }}
                    aria-hidden
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      {gain.isNewTerritory ? (
                        <p style={{ ...monoStyle, fontSize: '0.52rem', color: 'var(--text-muted)' }}>New Territory</p>
                      ) : null}
                      {crossing ? <TierLabel crossing={crossing} /> : null}
                    </div>
                    <p className="truncate font-serif text-sm font-bold text-[#111111]">{gain.displayName}</p>
                  </div>
                  <p className="shrink-0 font-mono text-sm font-bold uppercase text-[#111111]">
                    +{Math.round(gain.pointsGained)} PTS
                  </p>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {line ? (
        <p className="mt-4 text-sm leading-6 text-muted-foreground">{line}</p>
      ) : null}

      <div className="mt-6 flex flex-col gap-3 sm:flex-row">
        <Link className="btn-primary sm:flex-1" href="/knowledge">See your knowledge map</Link>
        <Link className="btn-ghost sm:flex-1" href="/">Back home</Link>
      </div>
    </main>
  );
}

function QuestionCard({ question }: { question: QuestionRecap }) {
  return (
    <article className="card p-4">
      <div className="flex items-start justify-between gap-3">
        <p style={{ ...monoStyle, color: 'var(--text-muted)' }}>
          JOSHING BOT · {question.domainDisplayName.toUpperCase()}
        </p>
        <span
          className={cn(
            'rounded-sm border px-2 py-1 text-[0.65rem] font-semibold uppercase tracking-[0.08em]',
            question.isSkipped
              ? 'border-stone-200 bg-stone-50 text-stone-600'
              : question.isCorrect
                ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                : 'border-rose-200 bg-rose-50 text-rose-700',
          )}
        >
          {question.isSkipped ? 'SKIPPED' : question.isCorrect ? 'CORRECT' : 'WRONG'}
        </span>
      </div>
      <p className="mt-3 font-medium leading-snug text-foreground">{question.questionText}</p>
      <div className="mt-3 space-y-1 text-sm">
        <p className="text-muted-foreground">
          <span className="font-medium text-foreground">You:</span>{' '}
          {question.isSkipped ? 'skipped' : question.submittedAnswer?.trim() || 'No answer submitted'}
        </p>
        <p className="text-muted-foreground">
          <span className="font-medium text-foreground">Answer:</span> {question.correctAnswer || 'No answer available'}
        </p>
      </div>
      {question.explanation ? (
        <p className="mt-3 text-sm leading-6 text-muted-foreground">{question.explanation}</p>
      ) : null}
      <div className="mt-4">
        <DailyQuestionFeedbackButtons questionId={question.questionId} />
      </div>
    </article>
  );
}

function DailyQuestionFeedbackButtons({ questionId }: { questionId: string }) {
  const [rating, setRating] = useState<FeedbackSignal | null>(null);
  const [isPending, startTransition] = useTransition();

  const update = useCallback((next: FeedbackSignal) => {
    const previous = rating;
    const signal = previous === next ? null : next;
    setRating(signal);

    if (!signal) return;
    startTransition(async () => {
      const response = await fetch('/api/daily/feedback', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ generated_question_id: questionId, signal }),
      });
      if (!response.ok) setRating(previous);
    });
  }, [questionId, rating]);

  return (
    <div className="flex items-center justify-end gap-2">
      <button
        aria-label="Thumbs up"
        aria-pressed={rating === 'thumbs_up'}
        className={cn(
          'inline-flex size-9 items-center justify-center rounded-md border text-muted-foreground transition',
          rating === 'thumbs_up'
            ? 'border-amber-300 bg-amber-100 text-amber-700'
            : 'border-border bg-background hover:bg-muted hover:text-foreground',
        )}
        disabled={isPending}
        type="button"
        onClick={() => update('thumbs_up')}
      >
        <ThumbsUp className="size-4" />
      </button>
      <button
        aria-label="Thumbs down"
        aria-pressed={rating === 'thumbs_down'}
        className={cn(
          'inline-flex size-9 items-center justify-center rounded-md border text-muted-foreground transition',
          rating === 'thumbs_down'
            ? 'border-stone-400 bg-stone-200 text-stone-800'
            : 'border-border bg-background hover:bg-muted hover:text-foreground',
        )}
        disabled={isPending}
        type="button"
        onClick={() => update('thumbs_down')}
      >
        <ThumbsDown className="size-4" />
      </button>
    </div>
  );
}

function TierLabel({ crossing }: { crossing: TierCrossing }) {
  return (
    <p style={{ ...monoStyle, fontSize: '0.52rem', color: 'var(--success)' }}>
      ↑ Now {formatTier(crossing.toTier)}
    </p>
  );
}
