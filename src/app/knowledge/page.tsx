'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Combine, Plus, Repeat2, X } from 'lucide-react';

import { DomainCircle } from '@/components/knowledge/DomainCircle';
import { DomainList } from '@/components/knowledge/DomainList';
import { ProgressionLandscape, type ProgressionView } from '@/components/knowledge/ProgressionLandscape';
import { SpiderGraph } from '@/components/knowledge/SpiderGraph';
import { TierProgressBar } from '@/components/progression/TierProgressBar';
import { getMasteryTierDisplay } from '@/server/mastery/get-mastery-tier-display';
import type { KnowledgeDomain } from '@/server/profile/knowledge-types';
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
  broadCategory: string | null;
  iconKey: string;
  isDeclared: boolean;
  isDeclaredInterest: boolean;
  isDemonstrated: boolean;
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
  portraitData: unknown;
  progressionLandscape: ProgressionView[];
  pageData: {
    allDomains: DomainMastery[];
    declaredInterests: string[];
  };
};

type TidyResult = {
  mergesApplied: number;
  domainsBefore: number;
  domainsAfter: number;
  details: Array<{ sources: string[]; target: string; rationale: string }>;
};

type SortMode = 'points' | 'tier' | 'lastActive' | 'alphabetical';
type KnowledgeViewMode = 'spider' | 'list' | 'progression';
type InterestModalState = {
  slotIndex: number;
  currentDomain: string | null;
};
type ProposedInterest = {
  label: string;
  description?: string | null;
  broadCategory?: string | null;
};

const TIER_LABEL: Record<MasteryTier, string> = {
  establishing: 'Curious',
  familiar: 'Explorer',
  solid: 'Scholar',
  mastery: 'Sage',
};

const SORT_STORAGE_KEY = 'knowledge_sort_mode';
const VIEW_STORAGE_KEY = 'knowledge_view_mode';
const SORT_OPTIONS: Array<{ value: SortMode; label: string }> = [
  { value: 'points', label: 'By Points' },
  { value: 'tier', label: 'By Tier' },
  { value: 'lastActive', label: 'By Last Active' },
  { value: 'alphabetical', label: 'Alphabetical' },
];

const SORT_MODE_SET = new Set<SortMode>(SORT_OPTIONS.map((option) => option.value));
const TIER_RANK: Record<MasteryTier, number> = {
  establishing: 0,
  familiar: 1,
  solid: 2,
  mastery: 3,
};

const VIEW_OPTIONS: Array<{ value: KnowledgeViewMode; label: string }> = [
  { value: 'spider', label: 'Spider' },
  { value: 'list', label: 'List' },
  { value: 'progression', label: 'Progression' },
];

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

function readSavedSortMode(): SortMode {
  if (typeof window === 'undefined') return 'points';
  const saved = localStorage.getItem(SORT_STORAGE_KEY);
  return SORT_MODE_SET.has(saved as SortMode) ? (saved as SortMode) : 'points';
}

function readSavedViewMode(): KnowledgeViewMode {
  if (typeof window === 'undefined') return 'list';
  const saved = localStorage.getItem(VIEW_STORAGE_KEY);
  return saved === 'spider' || saved === 'list' || saved === 'progression' ? saved : 'list';
}

function domainKey(value: string): string {
  return value.trim().toLowerCase();
}

function emptyDomain(domain: string): DomainMastery {
  return {
    domain,
    displayName: domain,
    points: 0,
    tier: 'establishing',
    tierProgress: 0,
    questionsAnswered: 0,
    questionsCorrect: 0,
    correctRate: 0,
    lastActivityAt: null,
    broadCategory: null,
    iconKey: domain.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'other',
    isDeclared: true,
    isDeclaredInterest: true,
    isDemonstrated: false,
  };
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
  const router = useRouter();
  const [data, setData] = useState<KnowledgeResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortMode, setSortMode] = useState<SortMode>('points');
  const [viewMode, setViewMode] = useState<KnowledgeViewMode>('list');
  const [interestModal, setInterestModal] = useState<InterestModalState | null>(null);
  const [selectedInterest, setSelectedInterest] = useState<ProposedInterest | null>(null);
  const [customInterest, setCustomInterest] = useState('');
  const [canonicalizing, setCanonicalizing] = useState(false);
  const [savingInterests, setSavingInterests] = useState(false);
  const [interestError, setInterestError] = useState<string | null>(null);
  const [tidyConfirmOpen, setTidyConfirmOpen] = useState(false);
  const [tidying, setTidying] = useState(false);
  const [tidyNotice, setTidyNotice] = useState<string | null>(null);

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

  useEffect(() => {
    setSortMode(readSavedSortMode());
    setViewMode(readSavedViewMode());
  }, []);

  const onSortModeChange = (nextMode: SortMode) => {
    setSortMode(nextMode);
    localStorage.setItem(SORT_STORAGE_KEY, nextMode);
  };

  const onViewModeChange = (nextMode: KnowledgeViewMode) => {
    setViewMode(nextMode);
    localStorage.setItem(VIEW_STORAGE_KEY, nextMode);
  };

  const reloadKnowledge = async () => {
    const response = await fetch('/api/knowledge', { cache: 'no-store', credentials: 'include' });
    const body = await response.json().catch(() => null) as KnowledgeResponse | { message?: string } | null;
    if (!response.ok || !body || !('mastery' in body)) {
      throw new Error((body as { message?: string } | null)?.message ?? 'Could not refresh your Knowledge Map.');
    }
    setData(body);
  };

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

  const sortedDomains = useMemo(() => {
    if (!data) return [];
    return [...data.pageData.allDomains].sort((a, b) => {
      if (sortMode === 'tier') {
        const tierDiff = TIER_RANK[asTier(b.tier)] - TIER_RANK[asTier(a.tier)];
        if (tierDiff !== 0) return tierDiff;
        return b.points - a.points || a.displayName.localeCompare(b.displayName);
      }
      if (sortMode === 'lastActive') {
        const aTime = a.lastActivityAt ? new Date(a.lastActivityAt).getTime() : 0;
        const bTime = b.lastActivityAt ? new Date(b.lastActivityAt).getTime() : 0;
        return bTime - aTime || b.points - a.points || a.displayName.localeCompare(b.displayName);
      }
      if (sortMode === 'alphabetical') {
        return a.displayName.localeCompare(b.displayName) || b.points - a.points;
      }
      return b.points - a.points || a.displayName.localeCompare(b.displayName);
    });
  }, [data, sortMode]);

  const spiderDomains = useMemo<KnowledgeDomain[]>(() => {
    if (!data) return [];
    return sortedDomains.map((domain) => ({
      name: domain.displayName,
      tier: asTier(domain.tier),
      progressWithinTier: domain.tierProgress / 100,
      masteryPoints: domain.points,
      declaredQuestionCount: domain.isDeclaredInterest ? 1 : 0,
      provenCorrectCount: domain.questionsCorrect,
      isVisibleOnProfile: true,
      broadCategory: domain.broadCategory,
    }));
  }, [data, sortedDomains]);

  const declaredSlots = useMemo(() => {
    if (!data) return [];
    const byKey = new Map(data.pageData.allDomains.map((domain) => [domainKey(domain.domain), domain]));
    const filled = data.pageData.declaredInterests.slice(0, 5).map((domain) => {
      return byKey.get(domainKey(domain)) ?? emptyDomain(domain);
    });
    return Array.from({ length: 5 }, (_, index) => filled[index] ?? null);
  }, [data]);

  const declaredKeys = useMemo(
    () => new Set((data?.pageData.declaredInterests ?? []).map(domainKey)),
    [data],
  );

  const demonstratedChoices = useMemo(() => {
    if (!data) return [];
    return data.pageData.allDomains
      .filter((domain) => (domain.isDemonstrated || domain.points > 0) && !declaredKeys.has(domainKey(domain.domain)))
      .sort((a, b) => b.points - a.points || a.displayName.localeCompare(b.displayName));
  }, [data, declaredKeys]);

  const openInterestModal = (slotIndex: number, currentDomain: string | null) => {
    setInterestModal({ slotIndex, currentDomain });
    setSelectedInterest(null);
    setCustomInterest('');
    setInterestError(null);
  };

  const closeInterestModal = () => {
    if (savingInterests) return;
    setInterestModal(null);
    setSelectedInterest(null);
    setCustomInterest('');
    setInterestError(null);
  };

  const proposeCustomInterest = async () => {
    const raw = customInterest.trim();
    if (!raw) return;
    setCanonicalizing(true);
    setInterestError(null);
    try {
      const response = await fetch('/api/onboarding/propose-interests', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ warmupAnswers: [raw] }),
      });
      const body = await response.json().catch(() => null) as { interests?: ProposedInterest[]; message?: string } | null;
      if (!response.ok) throw new Error(body?.message ?? 'Could not refine that interest.');
      const proposal = body?.interests?.[0];
      setSelectedInterest(proposal?.label ? proposal : { label: raw });
    } catch (caught) {
      setInterestError(caught instanceof Error ? caught.message : 'Could not refine that interest.');
      setSelectedInterest({ label: raw });
    } finally {
      setCanonicalizing(false);
    }
  };

  const confirmInterestChange = async () => {
    if (!data || !interestModal || !selectedInterest?.label) return;
    setSavingInterests(true);
    setInterestError(null);

    const nextInterests = (declaredSlots
      .map((slot, index) => {
        if (index === interestModal.slotIndex) {
          return {
            label: selectedInterest.label.trim(),
            description: selectedInterest.description,
            broadCategory: selectedInterest.broadCategory,
          };
        }
        return slot
          ? {
            label: slot.domain,
            broadCategory: slot.broadCategory,
          }
          : null;
      }) as Array<ProposedInterest | null>)
      .filter((interest): interest is ProposedInterest => Boolean(interest?.label.trim()))
      .slice(0, 5);

    try {
      const response = await fetch('/api/onboarding/save-interests', {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ interests: nextInterests }),
      });
      const body = await response.json().catch(() => null) as { message?: string } | null;
      if (!response.ok) throw new Error(body?.message ?? 'Could not save your interests.');
      await reloadKnowledge();
      setInterestModal(null);
      setSelectedInterest(null);
      setCustomInterest('');
    } catch (caught) {
      setInterestError(caught instanceof Error ? caught.message : 'Could not save your interests.');
    } finally {
      setSavingInterests(false);
    }
  };

  const confirmTidy = async () => {
    setTidying(true);
    try {
      const response = await fetch('/api/knowledge/tidy', {
        method: 'POST',
        credentials: 'include',
      });
      const body = await response.json().catch(() => null) as TidyResult | { message?: string } | null;
      if (!response.ok || !body || !('mergesApplied' in body)) {
        throw new Error((body as { message?: string } | null)?.message ?? 'Could not tidy your map.');
      }
      await reloadKnowledge();
      setTidyConfirmOpen(false);
      setTidyNotice(body.mergesApplied > 0 ? `${body.mergesApplied} domains combined` : 'Nothing to combine');
      window.setTimeout(() => setTidyNotice(null), 3600);
    } catch (caught) {
      setTidyNotice(caught instanceof Error ? caught.message : 'Could not tidy your map.');
      window.setTimeout(() => setTidyNotice(null), 4200);
    } finally {
      setTidying(false);
    }
  };

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
        {sortedDomains.length === 0 ? (
          <div className="mt-4 rounded-lg border bg-card p-5 text-sm text-muted-foreground">
            <p>Your map will fill in as you answer questions.</p>
            <button
              type="button"
              className="mt-4 rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background transition-opacity hover:opacity-90"
              onClick={() => router.push('/daily/setup')}
            >
              Play today's round
            </button>
          </div>
        ) : (
          <>
            <div className="mt-4 inline-grid grid-cols-3 rounded-full border bg-card p-1 text-sm font-medium">
              {VIEW_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={`min-h-10 rounded-full px-4 transition ${
                    viewMode === option.value
                      ? 'bg-foreground text-background'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                  onClick={() => onViewModeChange(option.value)}
                  aria-pressed={viewMode === option.value}
                >
                  {option.label}
                </button>
              ))}
            </div>

            {viewMode === 'list' ? (
              <div className="mt-4 flex flex-wrap gap-2">
              {SORT_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${
                    sortMode === option.value
                      ? 'border-foreground bg-foreground text-background'
                      : 'border-border bg-card text-muted-foreground hover:text-foreground'
                  }`}
                  onClick={() => onSortModeChange(option.value)}
                  aria-pressed={sortMode === option.value}
                >
                  {option.label}
                </button>
              ))}
              </div>
            ) : null}

            {viewMode === 'spider' ? (
              <div className="mt-4 rounded-lg border bg-card p-3">
                <SpiderGraph domains={spiderDomains} />
              </div>
            ) : viewMode === 'progression' ? (
              <div>
                <h3 className="mt-5 text-sm font-semibold">Closest to next tier</h3>
                <ProgressionLandscape
                  domains={data.progressionLandscape}
                  onDomainSelect={(domain) => router.push(`/knowledge/${encodeURIComponent(domain)}`)}
                />
              </div>
            ) : (
              <DomainList
                domains={sortedDomains}
                onDomainSelect={(domain) => router.push(`/knowledge/${encodeURIComponent(domain)}`)}
              />
            )}
          </>
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
        <section className="mb-8">
          <h2 className="font-serif text-2xl font-semibold">Highlights</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            {highlights.map((highlight) => (
              <button
                key={highlight.key}
                type="button"
                className="rounded-lg border bg-card p-4 text-left text-card-foreground transition hover:border-foreground/30 disabled:cursor-default disabled:hover:border-border"
                onClick={() => {
                  if (highlight.domain) router.push(`/knowledge/${encodeURIComponent(highlight.domain.domain)}`);
                }}
                disabled={!highlight.domain}
              >
                <div className="flex items-center gap-3">
                  {highlight.domain ? (
                    <DomainCircle
                      diameter={42}
                      iconKey={highlight.domain.iconKey}
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
              </button>
            ))}
          </div>
        </section>
      ) : null}

      <section>
        <div>
          <h2 className="font-serif text-2xl font-semibold">Your Declared Interests</h2>
          <p className="mt-1 text-sm text-muted-foreground">These are what your daily round draws from.</p>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-5">
          {declaredSlots.map((slot, index) => (
            <div key={slot?.domain ?? `empty-${index}`} className="flex min-h-32 flex-col justify-between rounded-lg border bg-card p-3">
              {slot ? (
                <>
                  <div className="min-w-0">
                    <h3 className="line-clamp-2 text-sm font-semibold text-foreground">{slot.displayName}</h3>
                    <p className="mt-1 text-xs capitalize text-muted-foreground">{slot.tier}</p>
                  </div>
                  <button
                    type="button"
                    className="mt-4 inline-flex min-h-9 items-center justify-center gap-1 rounded-md border px-3 text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground transition hover:text-foreground"
                    onClick={() => openInterestModal(index, slot.domain)}
                  >
                    <Repeat2 className="size-3.5" />
                    Swap
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="flex h-full min-h-24 flex-col items-center justify-center gap-2 rounded-md border border-dashed text-sm font-medium text-muted-foreground transition hover:text-foreground"
                  onClick={() => openInterestModal(index, null)}
                >
                  <Plus className="size-4" />
                  Add interest
                </button>
              )}
            </div>
          ))}
        </div>
      </section>

      <section className="mt-8 border-t pt-4">
        <div className="flex flex-col gap-3 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <p>Map maintenance</p>
          <button
            type="button"
            className="inline-flex min-h-9 items-center justify-center gap-2 rounded-md border px-3 text-xs font-medium uppercase tracking-[0.08em] transition hover:text-foreground disabled:opacity-50"
            onClick={() => setTidyConfirmOpen(true)}
            disabled={tidying}
          >
            <Combine className="size-3.5" />
            Tidy up my map
          </button>
        </div>
      </section>

      {interestModal ? (
        <div className="fixed inset-0 z-50 flex items-end bg-black/30 px-3 py-4 sm:items-center sm:justify-center">
          <div className="w-full max-w-lg rounded-lg border bg-background p-5 shadow-xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="font-serif text-2xl font-semibold">
                  {interestModal.currentDomain ? `Swap ${interestModal.currentDomain}` : 'Add to your declared interests'}
                </h2>
                {interestModal.currentDomain ? (
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">
                    Your progress in {interestModal.currentDomain} is preserved. It will move to your demonstrated knowledge.
                  </p>
                ) : null}
              </div>
              <button
                type="button"
                className="grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-foreground"
                onClick={closeInterestModal}
                aria-label="Close"
              >
                <X className="size-4" />
              </button>
            </div>

            <div className="mt-5 grid gap-5">
              <div>
                <h3 className="text-sm font-semibold">Pick from your knowledge base</h3>
                {demonstratedChoices.length === 0 ? (
                  <p className="mt-2 rounded-lg border bg-card p-3 text-sm text-muted-foreground">
                    No demonstrated domains are available to add right now.
                  </p>
                ) : (
                  <div className="mt-2 max-h-44 overflow-y-auto rounded-lg border bg-card">
                    {demonstratedChoices.map((domain) => (
                      <button
                        key={domain.domain}
                        type="button"
                        className={`flex w-full items-center justify-between gap-3 border-b px-3 py-2 text-left text-sm last:border-b-0 ${
                          selectedInterest?.label === domain.domain ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground'
                        }`}
                        onClick={() => setSelectedInterest({ label: domain.domain, broadCategory: domain.broadCategory ?? undefined })}
                      >
                        <span className="min-w-0 truncate font-medium">{domain.displayName}</span>
                        <span className="shrink-0 text-xs capitalize">{domain.tier}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <h3 className="text-sm font-semibold">Write a new interest</h3>
                <div className="mt-2 flex gap-2">
                  <input
                    value={customInterest}
                    onChange={(event) => setCustomInterest(event.target.value)}
                    placeholder="Late-period Bowie, Weimar cinema..."
                    className="min-h-10 flex-1 rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                  <button
                    type="button"
                    className="min-h-10 rounded-md bg-foreground px-3 text-sm font-medium text-background disabled:opacity-50"
                    disabled={!customInterest.trim() || canonicalizing}
                    onClick={() => void proposeCustomInterest()}
                  >
                    {canonicalizing ? 'Refining...' : 'Refine'}
                  </button>
                </div>
                {selectedInterest ? (
                  <div className="mt-3 rounded-lg border bg-card p-3 text-sm">
                    <p className="font-medium">{selectedInterest.label}</p>
                    {selectedInterest.description ? (
                      <p className="mt-1 text-muted-foreground">{selectedInterest.description}</p>
                    ) : null}
                    <button
                      type="button"
                      className="mt-2 text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground underline underline-offset-4"
                      onClick={() => setSelectedInterest({ label: customInterest.trim() || selectedInterest.label })}
                    >
                      Use my wording
                    </button>
                  </div>
                ) : null}
              </div>
            </div>

            {interestError ? (
              <p className="mt-4 rounded-md border border-destructive/40 bg-card p-3 text-sm text-destructive">
                {interestError}
              </p>
            ) : null}

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                className="min-h-10 rounded-md border px-4 text-sm font-medium text-muted-foreground"
                onClick={closeInterestModal}
                disabled={savingInterests}
              >
                Cancel
              </button>
              <button
                type="button"
                className="min-h-10 rounded-md bg-foreground px-4 text-sm font-medium text-background disabled:opacity-50"
                onClick={() => void confirmInterestChange()}
                disabled={!selectedInterest?.label || savingInterests}
              >
                {savingInterests ? 'Saving...' : interestModal.currentDomain ? 'Confirm swap' : 'Confirm add'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {tidyConfirmOpen ? (
        <div className="fixed inset-0 z-50 flex items-end bg-black/30 px-3 py-4 sm:items-center sm:justify-center">
          <div className="w-full max-w-md rounded-lg border bg-background p-5 shadow-xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="font-serif text-2xl font-semibold">Tidy up your map?</h2>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  We'll look for domains in your map that could be combined. This is automatic and based on what you've answered. You can't undo this.
                </p>
              </div>
              <button
                type="button"
                className="grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-foreground"
                onClick={() => setTidyConfirmOpen(false)}
                aria-label="Close"
                disabled={tidying}
              >
                <X className="size-4" />
              </button>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                className="min-h-10 rounded-md border px-4 text-sm font-medium text-muted-foreground"
                onClick={() => setTidyConfirmOpen(false)}
                disabled={tidying}
              >
                Cancel
              </button>
              <button
                type="button"
                className="min-h-10 rounded-md bg-foreground px-4 text-sm font-medium text-background disabled:opacity-50"
                onClick={() => void confirmTidy()}
                disabled={tidying}
              >
                {tidying ? 'Tidying...' : 'Confirm tidy'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {tidyNotice ? (
        <div className="fixed bottom-5 left-1/2 z-50 -translate-x-1/2 rounded-full border bg-background px-4 py-2 text-sm font-medium shadow-lg">
          {tidyNotice}
        </div>
      ) : null}
    </main>
  );
}
