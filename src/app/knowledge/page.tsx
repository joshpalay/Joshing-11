'use client';

import { useEffect, useMemo, useState } from 'react';

import { DomainCircle } from '@/components/knowledge/DomainCircle';
import { DomainProgressBar } from '@/components/knowledge/DomainProgressBar';
import { TierProgressBar } from '@/components/progression/TierProgressBar';
import { getMasteryTierDisplay } from '@/server/mastery/get-mastery-tier-display';
import type { MasteryTier } from '@/types/db';

type DomainMastery = {
  domain: string;
  displayName: string;
  points: number;
  tier: string;
  tierProgress: number;
  questionsAnswered: number;
  questionsCorrect: number;
  correctRate: number;
  lastActivityAt: string | null;
};

type RecentActivity = {
  domain: string;
  displayName: string;
  points: number;
  source: string;
  createdAt: string;
};

type MasteryOverview = {
  totalPoints: number;
  currentTier: string;
  tierProgress: number;
  nextTier: string | null;
  pointsToNextTier: number | null;
  domains: DomainMastery[];
  recentActivity: RecentActivity[];
};

type StreakData = {
  currentStreak: number;
  longestStreak: number;
  lastActivityDate: string | null;
};

type KnowledgeResponse = {
  mastery: MasteryOverview;
  streak: StreakData;
};

const TIER_LABEL: Record<MasteryTier, string> = {
  establishing: 'Curious',
  familiar: 'Explorer',
  solid: 'Scholar',
  mastery: 'Sage',
};

const DOMAIN_TIER_LABEL: Record<MasteryTier, string> = {
  establishing: 'Establishing',
  familiar: 'Familiar',
  solid: 'Solid',
  mastery: 'Mastery',
};

function isMasteryTier(value: string): value is MasteryTier {
  return value === 'establishing' || value === 'familiar' || value === 'solid' || value === 'mastery';
}

function asTier(value: string): MasteryTier {
  return isMasteryTier(value) ? value : 'establishing';
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat().format(Math.round(value));
}

function daysAgo(value: string | null): string {
  if (!value) return 'No activity yet';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'No activity yet';
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startDate = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const diff = Math.max(0, Math.round((startToday - startDate) / 86_400_000));
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return `${diff} days ago`;
}

function relativeTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return daysAgo(value);
}

function sourceLabel(source: string): string {
  if (source === 'joshing_game') return 'Game';
  if (source === 'daily') return 'Daily';
  if (source === 'author_credit') return 'Creator';
  return source.replace(/_/g, ' ');
}

function LoadingSkeleton() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-5xl flex-col px-4 py-6 pb-24">
      <div className="mb-8 h-40 animate-pulse rounded-lg border bg-muted" />
      <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, index) => (
          <div key={index} className="h-48 animate-pulse rounded-lg border bg-muted" />
        ))}
      </div>
      <div className="space-y-3">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="h-14 animate-pulse rounded-lg border bg-muted" />
        ))}
      </div>
    </main>
  );
}

export default function KnowledgePage() {
  const [data, setData] = useState<KnowledgeResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    async function loadKnowledge() {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch('/api/knowledge', { cache: 'no-store', credentials: 'include' });
        const body = await response.json().catch(() => null) as KnowledgeResponse | { message?: string } | null;
        if (!response.ok || !body || !('mastery' in body)) {
          throw new Error((body as { message?: string } | null)?.message ?? 'Could not load your Knowledge Map.');
        }
        if (active) setData(body);
      } catch (caught) {
        if (active) setError(caught instanceof Error ? caught.message : 'Could not load your Knowledge Map.');
      } finally {
        if (active) setLoading(false);
      }
    }

    void loadKnowledge();
    return () => {
      active = false;
    };
  }, []);

  const highlights = useMemo(() => {
    if (!data) return [];
    const strongest = data.mastery.domains
      .filter((domain) => domain.questionsAnswered >= 5)
      .sort((a, b) => b.correctRate - a.correctRate || b.questionsAnswered - a.questionsAnswered)[0];
    const mostExplored = data.mastery.domains
      .filter((domain) => domain.questionsAnswered > 0)
      .sort((a, b) => b.questionsAnswered - a.questionsAnswered)[0];

    return [
      strongest
        ? {
          key: 'strongest',
          title: 'Strongest domain',
          body: `${strongest.displayName} - ${strongest.correctRate}% correct`,
          domain: strongest,
        }
        : null,
      mostExplored
        ? {
          key: 'explored',
          title: 'Most explored',
          body: `${mostExplored.displayName} - ${formatNumber(mostExplored.questionsAnswered)} questions`,
          domain: mostExplored,
        }
        : null,
      data.streak.currentStreak >= 3
        ? {
          key: 'streak',
          title: 'On a streak',
          body: `🔥 ${formatNumber(data.streak.currentStreak)} days in a row`,
          domain: null,
        }
        : null,
    ].filter((item): item is {
      key: string;
      title: string;
      body: string;
      domain: DomainMastery | null;
    } => Boolean(item));
  }, [data]);

  if (loading) return <LoadingSkeleton />;

  if (error || !data) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-2xl flex-col items-center justify-center px-4 py-10 text-center">
        <p className="text-sm uppercase tracking-[0.1em] text-muted-foreground">Knowledge</p>
        <h1 className="mt-2 font-serif text-3xl font-semibold">Could not load your map</h1>
        <p className="mt-3 text-sm text-muted-foreground">{error ?? 'Something went sideways.'}</p>
      </main>
    );
  }

  const overallDisplay = getMasteryTierDisplay(data.mastery.totalPoints);
  const overallTier = overallDisplay.tier;
  const atMaxTier = !data.mastery.nextTier;

  return (
    <main className="mx-auto flex min-h-dvh max-w-5xl flex-col px-4 py-6 pb-24">
      <section className="mb-8 rounded-lg border bg-card p-5 text-card-foreground">
        <p className="text-xs uppercase tracking-[0.1em] text-muted-foreground">Knowledge</p>
        <h1 className="mt-2 font-serif text-5xl font-semibold leading-tight">{TIER_LABEL[overallTier]}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{formatNumber(data.mastery.totalPoints)} total points</p>
        {data.streak.currentStreak > 0 ? (
          <p className="mt-4 text-sm font-medium">🔥 {formatNumber(data.streak.currentStreak)} day streak</p>
        ) : null}
        {atMaxTier ? (
          <p className="mt-5 text-sm text-muted-foreground">You've reached the top tier.</p>
        ) : (
          <div className="mt-5">
            <TierProgressBar
              tier={overallTier}
              progressWithinTier={data.mastery.tierProgress / 100}
              ariaLabelPrefix="Overall knowledge progression"
            />
            {data.mastery.pointsToNextTier !== null ? (
              <p className="mt-2 text-xs text-muted-foreground">
                {formatNumber(data.mastery.pointsToNextTier)} points to the next tier
              </p>
            ) : null}
          </div>
        )}
      </section>

      <section className="mb-8">
        <h2 className="font-serif text-2xl font-semibold">Your Knowledge Map</h2>
        {data.mastery.domains.length === 0 ? (
          <p className="mt-4 rounded-lg border bg-card p-5 text-sm text-muted-foreground">
            Answer some questions to start building your map.
          </p>
        ) : (
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {data.mastery.domains.map((domain) => {
              const tier = asTier(domain.tier);
              return (
                <article key={domain.domain} className="rounded-lg border bg-card p-4 text-card-foreground">
                  <div className="flex items-start gap-4">
                    <DomainCircle
                      diameter={70}
                      iconKey={domain.domain}
                      canonicalSubcategory={domain.displayName}
                      currentTier={tier}
                      showTierLabel={false}
                    />
                    <div className="min-w-0 flex-1">
                      <h3 className="text-lg font-semibold leading-snug">{domain.displayName}</h3>
                      <p className="mt-1 text-sm text-muted-foreground">{DOMAIN_TIER_LABEL[tier]}</p>
                      <DomainProgressBar tier={tier} progressWithinTier={domain.tierProgress / 100} />
                    </div>
                  </div>
                  <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <dt className="text-muted-foreground">Correct rate</dt>
                      <dd className="font-medium">{domain.correctRate}% correct</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Questions</dt>
                      <dd className="font-medium">{formatNumber(domain.questionsAnswered)} answered</dd>
                    </div>
                    <div className="col-span-2">
                      <dt className="text-muted-foreground">Last active</dt>
                      <dd className="font-medium">{daysAgo(domain.lastActivityAt)}</dd>
                    </div>
                  </dl>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <section className="mb-8">
        <h2 className="font-serif text-2xl font-semibold">Recent Activity</h2>
        {data.mastery.recentActivity.length === 0 ? (
          <p className="mt-4 rounded-lg border bg-card p-5 text-sm text-muted-foreground">No activity yet.</p>
        ) : (
          <div className="mt-4 divide-y rounded-lg border bg-card">
            {data.mastery.recentActivity.slice(0, 10).map((item, index) => (
              <div key={`${item.domain}-${item.createdAt}-${index}`} className="flex items-center gap-3 px-4 py-3 text-sm">
                <span className="min-w-0 flex-1 font-medium">{item.displayName}</span>
                <span className="text-foreground">+{formatNumber(item.points)} pts</span>
                <span className="text-muted-foreground">{sourceLabel(item.source)}</span>
                <span className="text-muted-foreground">{relativeTime(item.createdAt)}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      {highlights.length > 0 ? (
        <section>
          <h2 className="font-serif text-2xl font-semibold">Highlights</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            {highlights.map((highlight) => (
              <article key={highlight.key} className="rounded-lg border bg-card p-4 text-card-foreground">
                <div className="flex items-center gap-3">
                  {highlight.domain ? (
                    <DomainCircle
                      diameter={42}
                      iconKey={highlight.domain.domain}
                      canonicalSubcategory={highlight.domain.displayName}
                      currentTier={asTier(highlight.domain.tier)}
                      showTierLabel={false}
                    />
                  ) : null}
                  <div className="min-w-0">
                    <h3 className="text-sm font-semibold">{highlight.title}</h3>
                    <p className="mt-1 text-sm text-muted-foreground">{highlight.body}</p>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </section>
      ) : null}
    </main>
  );
}
