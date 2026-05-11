'use client';

import Link from 'next/link';
import { ThumbsDown, ThumbsUp } from 'lucide-react';
import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react';

import { SendQuestionAction } from '@/components/SendQuestionAction';
import { AddToBankAction } from '@/components/AddToBankAction';
import { CategoryGainsDisplay } from '@/components/review/CategoryGainsDisplay';
import MasteryMoment from '@/components/review/MasteryMoment';
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

function formatDate(value: string) {
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, { month: 'long', day: 'numeric', year: 'numeric' }).format(date);
}

function formatTier(tier: string) {
  return tier.replace(/_/g, ' ').toUpperCase();
}

function interpretiveLine(summary: DailySummaryView): string | null {
  // 1. Tier crossing
  const crossing = summary.tierCrossings[0];
  if (crossing) {
    const domain = summary.domainGains.find((gain) => gain.domain === crossing.domain)?.displayName ?? crossing.domain;
    return `You moved to ${formatTier(crossing.toTier).toLowerCase()} in ${domain}.`;
  }

  // 2. First correct in new demonstrated domain
  const newDomain = summary.domainGains.find((gain) => gain.isNewTerritory);
  if (newDomain) return `You found new ground in ${newDomain.displayName}.`;

  const answered = summary.questions.filter((q) => !q.isSkipped);
  const total = answered.length;

  // 3. 5/5
  if (total > 0 && summary.totalCorrect === total && total === 5) return 'Clean sweep.';

  // 4. 0/5
  if (total > 0 && summary.totalCorrect === 0 && total === 5) return 'Every one of them. Tomorrow.';

  // 5. 3+ correct in a row
  let streak = 0;
  let maxStreak = 0;
  for (const q of answered) {
    if (q.isCorrect) {
      streak += 1;
      if (streak > maxStreak) maxStreak = streak;
    } else {
      streak = 0;
    }
  }
  if (maxStreak >= 3) return 'Three in a row at one point.';

  // 6. All wrong in a single domain
  const domainGroups = new Map<string, { total: number; wrong: number }>();
  for (const q of answered) {
    const key = q.domainDisplayName;
    const entry = domainGroups.get(key) ?? { total: 0, wrong: 0 };
    entry.total += 1;
    if (!q.isCorrect) entry.wrong += 1;
    domainGroups.set(key, entry);
  }
  for (const [domain, counts] of domainGroups) {
    if (counts.total >= 2 && counts.wrong === counts.total) {
      return `${domain} is worth a deeper look.`;
    }
  }

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
  const growthCircleItems = useMemo(() => {
    if (!summary) return [];
    return summary.domainGains.map((gain) => ({
      canonical_subcategory: gain.displayName,
      broad_category: gain.broadCategory,
      points_total: gain.totalPoints,
      points_gained_this_round: gain.pointsGained,
      tier_current: gain.currentTier,
    }));
  }, [summary]);
  const firstTierCrossing = summary?.tierCrossings[0] ?? null;

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
          {summary.difficultyMode ? `${summary.difficultyMode.charAt(0).toUpperCase() + summary.difficultyMode.slice(1)} · ` : ''}
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
        <CategoryGainsDisplay
          roundItems={growthCircleItems}
          emptyMessage="No mastery movement was recorded today."
        />
      </section>

      {firstTierCrossing ? (
        <MasteryMoment
          subcategory={summary.domainGains.find((gain) => gain.domain === firstTierCrossing.domain)?.displayName ?? firstTierCrossing.domain}
          newTier={firstTierCrossing.toTier}
        />
      ) : null}

      {line ? <InterpretiveLine text={line} /> : null}

      <div className="mt-6 flex flex-col gap-3 sm:flex-row">
        <Link className="btn-primary sm:flex-1" href="/knowledge">See your knowledge map</Link>
        <Link className="btn-ghost sm:flex-1" href="/">Back home</Link>
      </div>
    </main>
  );
}

function InterpretiveLine({ text }: { text: string }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setVisible(true), 300);
    return () => window.clearTimeout(t);
  }, []);
  return (
    <p
      className="mt-4 text-sm italic leading-6 text-muted-foreground"
      style={{ opacity: visible ? 1 : 0, transition: 'opacity 0.4s ease' }}
    >
      {text}
    </p>
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
      {question.creatorNote ? (
        <p className="mt-3 rounded-md border bg-muted/50 p-3 text-sm leading-6 text-foreground">
          <span className="font-medium">A note from {question.creatorNote.authorName}:</span>{' '}
          {question.creatorNote.noteText}
        </p>
      ) : null}
      <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
        <DailyQuestionFeedbackButtons questionId={question.questionId} />
        <DomainExclusionAffordance domain={question.domain} domainDisplayName={question.domainDisplayName} />
        <SendQuestionAction
          question={{ id: question.questionId, text: question.questionText, domain: question.domainDisplayName }}
          label=""
          className="inline-flex size-9 items-center justify-center rounded-md border text-muted-foreground transition hover:bg-muted hover:text-foreground"
        />
        {question.bankQuestionId ? (
          <AddToBankAction
            questionId={question.bankQuestionId}
            initialInBank={question.isInBank}
            contextType="manual"
            label=""
            className="inline-flex size-9 items-center justify-center rounded-md border px-0"
          />
        ) : null}
      </div>
    </article>
  );
}


type ExclusionState =
  | { kind: 'idle' }
  | { kind: 'confirmed' }
  | { kind: 'undone' };

function DomainExclusionAffordance({
  domain,
  domainDisplayName,
}: {
  domain: string;
  domainDisplayName: string;
}) {
  const [state, setState] = useState<ExclusionState>({ kind: 'idle' });
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleExclude = useCallback(async () => {
    setState({ kind: 'confirmed' });
    undoTimerRef.current = setTimeout(() => {
      undoTimerRef.current = null;
    }, 5000);
    try {
      await fetch('/api/users/domain-exclusions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ canonical_subcategory: domain }),
      });
    } catch {
      // Optimistic UI is acceptable here; the next summary load will reflect persisted state.
    }
  }, [domain]);

  const handleUndo = useCallback(async () => {
    if (undoTimerRef.current) {
      clearTimeout(undoTimerRef.current);
      undoTimerRef.current = null;
    }
    setState({ kind: 'undone' });
    try {
      await fetch(`/api/users/domain-exclusions/${encodeURIComponent(domain)}`, {
        method: 'DELETE',
        credentials: 'include',
      });
    } catch {
      // Fire-and-forget; the affordance returns on reload if persistence failed.
    }
  }, [domain]);

  useEffect(() => {
    return () => {
      if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    };
  }, []);

  if (state.kind === 'undone') return null;

  if (state.kind === 'confirmed') {
    return (
      <div className="flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
        <span>{domainDisplayName} won&apos;t appear in your daily queue anymore.</span>
        <button
          type="button"
          onClick={handleUndo}
          className="font-medium uppercase tracking-[0.08em] underline underline-offset-4"
        >
          Undo
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={handleExclude}
      className="inline-flex min-h-9 items-center rounded-md border px-3 text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground transition hover:bg-muted hover:text-foreground"
    >
      Don&apos;t show questions like this
    </button>
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
