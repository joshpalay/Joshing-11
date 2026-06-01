'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';

import {
  DomainVisibilityToggle,
  type DomainVisibility,
} from '@/components/knowledge/DomainVisibilityToggle';
import { TierProgressBar } from '@/components/progression/TierProgressBar';
import { AddToBankAction } from '@/components/AddToBankAction';
import { SendQuestionAction } from '@/components/SendQuestionAction';
import { KNOWLEDGE_TIER_LABEL } from '@/server/profile/knowledge-tier-copy';
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
  isInBank?: boolean;
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
      <div className="bg-muted mb-6 h-36 animate-pulse rounded-lg border" />
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="bg-muted h-44 animate-pulse rounded-lg border" />
        <div className="bg-muted h-44 animate-pulse rounded-lg border" />
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
    // Run inside an async fn so the initial loading/error state isn't set
    // synchronously in the effect body (react-hooks set-state-in-effect).
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch(`/api/knowledge/${encodeURIComponent(decodedDomain)}`, {
          credentials: 'include',
          cache: 'no-store',
        });
        const body = await response.json().catch(() => null);
        if (response.status === 401) {
          router.replace('/login');
          return;
        }
        if (!response.ok || !body) throw new Error(body?.message ?? 'Could not load this domain.');
        if (active) setDetail(body as DomainDetail);
      } catch (caught) {
        if (active)
          setError(caught instanceof Error ? caught.message : 'Could not load this domain.');
      } finally {
        if (active) setLoading(false);
      }
    })();

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
    setDetail((current) => (current ? { ...current, visibility } : current));
  };

  if (loading) return <LoadingState />;

  if (error || !detail) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-xl flex-col items-center justify-center px-4 text-center">
        <p className="text-muted-foreground text-xs tracking-[0.12em] uppercase">Knowledge</p>
        <h1 className="mt-2 font-serif text-3xl font-semibold">Domain not found</h1>
        <p className="text-muted-foreground mt-3 text-sm">
          {error ?? 'This domain is not in your knowledge map yet.'}
        </p>
        <Link href="/knowledge" className="btn-primary mt-6">
          Back to Knowledge
        </Link>
      </main>
    );
  }

  const tier = asTier(detail.tier);
  const visibilityHelp = VISIBILITY_HELP[detail.visibility];

  return (
    <main className="mx-auto min-h-dvh max-w-4xl px-4 py-6 pb-24">
      <header className="mb-7">
        <nav className="text-muted-foreground text-xs font-medium tracking-[0.12em] uppercase">
          <Link href="/" className="hover:text-foreground">
            Home
          </Link>
          <span className="px-2">/</span>
          <Link href="/knowledge" className="hover:text-foreground">
            Knowledge
          </Link>
          <span className="px-2">/</span>
          <span>{detail.displayName}</span>
        </nav>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <h1 className="font-serif text-5xl leading-tight font-semibold">{detail.displayName}</h1>
          {detail.isDeclaredInterest ? (
            <span className="rounded-full border px-3 py-1 text-xs font-semibold tracking-[0.1em] uppercase">
              Declared Interest
            </span>
          ) : null}
        </div>
      </header>

      <section className="bg-card text-card-foreground mb-5 rounded-lg border p-5">
        <p className="text-muted-foreground text-xs tracking-[0.12em] uppercase">Current tier</p>
        <h2 className="mt-2 font-serif text-4xl font-semibold">{KNOWLEDGE_TIER_LABEL[tier]}</h2>
        <div className="mt-5">
          <TierProgressBar
            tier={tier}
            progressWithinTier={detail.tierProgress / 100}
            ariaLabelPrefix={`${detail.displayName} tier progression`}
          />
        </div>
        <p className="text-muted-foreground mt-3 text-sm">
          {formatNumber(detail.points)} points
          {detail.nextTier && detail.pointsToNextTier !== null
            ? ` · ${formatNumber(detail.pointsToNextTier)} to ${KNOWLEDGE_TIER_LABEL[asTier(detail.nextTier)]}`
            : ' · Top tier reached'}
        </p>
      </section>

      <section className="mb-5 grid gap-3 sm:grid-cols-4">
        <StatTile label="Questions answered" value={formatNumber(detail.questionsAnswered)} />
        <StatTile label="Correct rate" value={`${detail.correctRate}%`} />
        <StatTile label="First answered" value={relativeTime(detail.firstAnsweredAt)} />
        <StatTile label="Last active" value={relativeTime(detail.lastAnsweredAt)} />
      </section>

      <section className="bg-card mb-5 rounded-lg border p-5">
        <h2 className="font-serif text-2xl font-semibold">Who can see this on your profile?</h2>
        <div className="mt-4">
          <DomainVisibilityToggle
            domainName={detail.domain}
            initialVisibility={detail.visibility}
            onChange={updateVisibility}
          />
        </div>
        <p className="text-muted-foreground mt-3 text-sm">{visibilityHelp}</p>
      </section>

      <section className="mb-7 grid gap-3 sm:grid-cols-2">
        <Link
          href={`/daily/setup?domainMode=custom&domain=${encodeURIComponent(detail.domain)}`}
          className="bg-card hover:border-foreground/30 rounded-lg border p-4 font-medium transition"
        >
          Answer questions in {detail.displayName}
        </Link>
        {/*
          // v11.1: Joshing Game creation disabled at FAB level. Re-enable
          // when game creation flow is restored.
        */}
      </section>

      <section className="mb-7">
        <h2 className="font-serif text-2xl font-semibold">Recent activity in this domain</h2>
        {detail.recentEvents.length === 0 ? (
          <p className="bg-card text-muted-foreground mt-3 rounded-lg border p-4 text-sm">
            No activity here yet.
          </p>
        ) : (
          <div className="bg-card mt-3 divide-y rounded-lg border">
            {detail.recentEvents.map((event) => (
              <div key={event.id} className="flex items-center gap-3 px-4 py-3 text-sm">
                <span className="text-foreground font-semibold">
                  +{formatNumber(event.points)} pts
                </span>
                <span className="min-w-0 flex-1 truncate">{truncate(event.questionText)}</span>
                <span className="text-muted-foreground shrink-0">
                  {relativeTime(event.createdAt)}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="font-serif text-2xl font-semibold">Your questions in this domain</h2>
        {detail.questionHistory.length === 0 ? (
          <p className="bg-card text-muted-foreground mt-3 rounded-lg border p-4 text-sm">
            No answered questions here yet.
          </p>
        ) : (
          <div className="bg-card mt-3 divide-y rounded-lg border">
            {detail.questionHistory.map((answer) => {
              const expanded = expandedAnswerId === answer.id;
              return (
                <div key={answer.id} className="hover:bg-muted/50 px-4 py-3 transition">
                  <button
                    type="button"
                    className="block w-full text-left"
                    onClick={() => setExpandedAnswerId(expanded ? null : answer.id)}
                    aria-expanded={expanded}
                  >
                    <div className="flex items-start gap-3">
                      <span
                        className={`mt-0.5 font-semibold ${answer.isCorrect ? 'text-green-700' : 'text-destructive'}`}
                      >
                        {answer.isCorrect ? '✓' : '✗'}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{answer.questionText}</p>
                        <p className="text-muted-foreground mt-1 text-xs">
                          {relativeTime(answer.answeredAt)}
                        </p>
                      </div>
                    </div>
                  </button>
                  {expanded ? (
                    <div className="bg-background mt-3 ml-7 space-y-2 rounded-md border p-3 text-sm">
                      <p>{answer.questionText}</p>
                      <p>
                        <span className="font-medium">Correct answer:</span>{' '}
                        {answer.correctAnswer ?? 'Not saved'}
                      </p>
                      <p>
                        <span className="font-medium">Your answer:</span>{' '}
                        {answer.submittedAnswer ?? 'Not saved'}
                      </p>
                      {answer.questionId ? (
                        <div className="flex flex-wrap gap-2">
                          <SendQuestionAction
                            question={{
                              id: answer.questionId,
                              text: answer.questionText,
                              domain: detail.displayName,
                            }}
                          />
                          {answer.source === 'joshing_game' ? (
                            <AddToBankAction
                              questionId={answer.questionId}
                              initialInBank={Boolean(answer.isInBank)}
                              contextType="joshing_game"
                              label=""
                              className="inline-flex min-h-10 w-10 items-center justify-center rounded-md border px-0"
                            />
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
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
    <div className="bg-card rounded-lg border p-4">
      <p className="text-muted-foreground text-xs tracking-[0.1em] uppercase">{label}</p>
      <p className="mt-2 text-2xl font-semibold">{value}</p>
    </div>
  );
}
