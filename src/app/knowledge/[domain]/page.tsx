'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';

import { DomainVisibilityToggle, type DomainVisibility } from '@/components/knowledge/DomainVisibilityToggle';
import { TierProgressBar } from '@/components/progression/TierProgressBar';
import type { MasteryTier } from '@/types/db';

type MasteryEvent = {
  id: string;
  points: number;
  source: string;
  questionText: string | null;
  createdAt: string;
};

type QuestionAnswer = {
  id: string;
  questionId: string | null;
  questionText: string;
  correctAnswer: string | null;
  submittedAnswer: string | null;
  isCorrect: boolean;
  answeredAt: string;
  source: 'daily' | 'joshing_game';
};

type DomainDetail = {
  domain: string;
  displayName: string;
  isDeclaredInterest: boolean;
  points: number;
  tier: string;
  tierProgress: number;
  nextTier: string | null;
  pointsToNextTier: number | null;
  questionsAnswered: number;
  questionsCorrect: number;
  correctRate: number;
  firstAnsweredAt: string | null;
  lastAnsweredAt: string | null;
  visibility: DomainVisibility;
  recentEvents: MasteryEvent[];
  questionHistory: QuestionAnswer[];
};

const TIER_LABEL: Record<MasteryTier, string> = {
  establishing: 'Curious',
  familiar: 'Explorer',
  solid: 'Scholar',
  mastery: 'Sage',
};

const VISIBILITY_HELP: Record<DomainVisibility, string> = {
  private: 'Only you can see this domain on your profile.',
  friends: 'Your friends can see this domain on your profile.',
  public: 'Anyone with your profile link can see this domain.',
};

function asTier(value: string): MasteryTier {
  return value === 'familiar' || value === 'solid' || value === 'mastery' ? value : 'establishing';
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat().format(Math.round(value));
}

function truncate(value: string | null, max = 88): string {
  if (!value) return 'Question';
  return value.length > max ? `${value.slice(0, max - 1)}...` : value;
}

function relativeTime(value: string | null): string {
  if (!value) return 'Not yet';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Not yet';
  const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return days === 1 ? 'Yesterday' : `${days} days ago`;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function LoadingState() {
  return (
    <main className="mx-auto min-h-dvh max-w-4xl px-4 py-6 pb-24">
      <div className="mb-6 h-36 animate-pulse rounded-lg border bg-muted" />
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="h-44 animate-pulse rounded-lg border bg-muted" />
        <div className="h-44 animate-pulse rounded-lg border bg-muted" />
      </div>
    </main>
  );
}

export default function DomainDetailPage() {
  const params = useParams<{ domain: string }>();
  const router = useRouter();
  const encodedDomain = params.domain;
  const decodedDomain = useMemo(() => decodeURIComponent(encodedDomain), [encodedDomain]);
  const [detail, setDetail] = useState<DomainDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedAnswerId, setExpandedAnswerId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);

    fetch(`/api/knowledge/${encodeURIComponent(decodedDomain)}`, { credentials: 'include', cache: 'no-store' })
      .then(async (response) => {
        const body = await response.json().catch(() => null);
        if (response.status === 401) {
          router.replace('/login');
          return null;
        }
        if (!response.ok || !body) throw new Error(body?.message ?? 'Could not load this domain.');
        return body as DomainDetail;
      })
      .then((body) => {
        if (active && body) setDetail(body);
      })
      .catch((caught) => {
        if (active) setError(caught instanceof Error ? caught.message : 'Could not load this domain.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [decodedDomain, router]);

  const updateVisibility = async (visibility: DomainVisibility) => {
    const response = await fetch(`/api/knowledge/${encodeURIComponent(decodedDomain)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ visibility }),
    });
    if (!response.ok) throw new Error('Could not update visibility');
    setDetail((current) => current ? { ...current, visibility } : current);
  };

  if (loading) return <LoadingState />;

  if (error || !detail) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-xl flex-col items-center justify-center px-4 text-center">
        <p className="text-xs uppercase tracking-[0.12em] text-muted-foreground">Knowledge</p>
        <h1 className="mt-2 font-serif text-3xl font-semibold">Domain not found</h1>
        <p className="mt-3 text-sm text-muted-foreground">{error ?? 'This domain is not in your knowledge map yet.'}</p>
        <Link href="/knowledge" className="btn-primary mt-6">Back to Knowledge</Link>
      </main>
    );
  }

  const tier = asTier(detail.tier);
  const visibilityHelp = VISIBILITY_HELP[detail.visibility];

  return (
    <main className="mx-auto min-h-dvh max-w-4xl px-4 py-6 pb-24">
      <header className="mb-7">
        <nav className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
          <Link href="/" className="hover:text-foreground">Home</Link>
          <span className="px-2">/</span>
          <Link href="/knowledge" className="hover:text-foreground">Knowledge</Link>
          <span className="px-2">/</span>
          <span>{detail.displayName}</span>
        </nav>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <h1 className="font-serif text-5xl font-semibold leading-tight">{detail.displayName}</h1>
          {detail.isDeclaredInterest ? (
            <span className="rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.1em]">
              Declared Interest
            </span>
          ) : null}
        </div>
      </header>

      <section className="mb-5 rounded-lg border bg-card p-5 text-card-foreground">
        <p className="text-xs uppercase tracking-[0.12em] text-muted-foreground">Current tier</p>
        <h2 className="mt-2 font-serif text-4xl font-semibold">{TIER_LABEL[tier]}</h2>
        <div className="mt-5">
          <TierProgressBar
            tier={tier}
            progressWithinTier={detail.tierProgress / 100}
            ariaLabelPrefix={`${detail.displayName} tier progression`}
          />
        </div>
        <p className="mt-3 text-sm text-muted-foreground">
          {formatNumber(detail.points)} points
          {detail.nextTier && detail.pointsToNextTier !== null
            ? ` · ${formatNumber(detail.pointsToNextTier)} to ${TIER_LABEL[asTier(detail.nextTier)]}`
            : ' · Top tier reached'}
        </p>
      </section>

      <section className="mb-5 grid gap-3 sm:grid-cols-4">
        <StatTile label="Questions answered" value={formatNumber(detail.questionsAnswered)} />
        <StatTile label="Correct rate" value={`${detail.correctRate}%`} />
        <StatTile label="First answered" value={relativeTime(detail.firstAnsweredAt)} />
        <StatTile label="Last active" value={relativeTime(detail.lastAnsweredAt)} />
      </section>

      <section className="mb-5 rounded-lg border bg-card p-5">
        <h2 className="font-serif text-2xl font-semibold">Who can see this on your profile?</h2>
        <div className="mt-4">
          <DomainVisibilityToggle
            domainName={detail.domain}
            initialVisibility={detail.visibility}
            onChange={updateVisibility}
          />
        </div>
        <p className="mt-3 text-sm text-muted-foreground">{visibilityHelp}</p>
      </section>

      <section className="mb-7 grid gap-3 sm:grid-cols-2">
        <Link
          href={`/daily/setup?domainMode=custom&domain=${encodeURIComponent(detail.domain)}`}
          className="rounded-lg border bg-card p-4 font-medium transition hover:border-foreground/30"
        >
          Answer questions in {detail.displayName}
        </Link>
        <Link
          href={`/new-game?domain=${encodeURIComponent(detail.domain)}`}
          className="rounded-lg border bg-card p-4 font-medium transition hover:border-foreground/30"
        >
          Send a question in {detail.displayName}
        </Link>
      </section>

      <section className="mb-7">
        <h2 className="font-serif text-2xl font-semibold">Recent activity in this domain</h2>
        {detail.recentEvents.length === 0 ? (
          <p className="mt-3 rounded-lg border bg-card p-4 text-sm text-muted-foreground">No activity here yet.</p>
        ) : (
          <div className="mt-3 divide-y rounded-lg border bg-card">
            {detail.recentEvents.map((event) => (
              <div key={event.id} className="flex items-center gap-3 px-4 py-3 text-sm">
                <span className="font-semibold text-foreground">+{formatNumber(event.points)} pts</span>
                <span className="min-w-0 flex-1 truncate">{truncate(event.questionText)}</span>
                <span className="shrink-0 text-muted-foreground">{relativeTime(event.createdAt)}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="font-serif text-2xl font-semibold">Your questions in this domain</h2>
        {detail.questionHistory.length === 0 ? (
          <p className="mt-3 rounded-lg border bg-card p-4 text-sm text-muted-foreground">No answered questions here yet.</p>
        ) : (
          <div className="mt-3 divide-y rounded-lg border bg-card">
            {detail.questionHistory.map((answer) => {
              const expanded = expandedAnswerId === answer.id;
              return (
                <button
                  key={answer.id}
                  type="button"
                  className="block w-full px-4 py-3 text-left transition hover:bg-muted/50"
                  onClick={() => setExpandedAnswerId(expanded ? null : answer.id)}
                  aria-expanded={expanded}
                >
                  <div className="flex items-start gap-3">
                    <span className={`mt-0.5 font-semibold ${answer.isCorrect ? 'text-green-700' : 'text-destructive'}`}>
                      {answer.isCorrect ? '✓' : '✗'}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{answer.questionText}</p>
                      <p className="mt-1 text-xs text-muted-foreground">{relativeTime(answer.answeredAt)}</p>
                      {expanded ? (
                        <div className="mt-3 space-y-2 rounded-md border bg-background p-3 text-sm">
                          <p>{answer.questionText}</p>
                          <p><span className="font-medium">Correct answer:</span> {answer.correctAnswer ?? 'Not saved'}</p>
                          <p><span className="font-medium">Your answer:</span> {answer.submittedAnswer ?? 'Not saved'}</p>
                        </div>
                      ) : null}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <p className="text-xs uppercase tracking-[0.1em] text-muted-foreground">{label}</p>
      <p className="mt-2 text-2xl font-semibold">{value}</p>
    </div>
  );
}
