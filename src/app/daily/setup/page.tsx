'use client';

export const dynamic = 'force-dynamic';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Check } from 'lucide-react';
import { KNOWLEDGE_TIER_LABEL } from '@/server/profile/knowledge-tier-copy';

type Difficulty = 'normal' | 'moderate' | 'challenging' | 'ridiculous' | 'adaptive';
type DomainMode = 'random' | 'custom';
type DomainSortMode = 'category' | 'mastery';

type DomainRow = {
  domain: string;
  broadCategory: string | null;
  totalPoints: number;
  tier: 'establishing' | 'familiar' | 'solid' | 'mastery';
};

type PreferencesResponse = {
  preferences: {
    difficulty: Difficulty;
    domainMode: DomainMode;
    selectedDomains: string[];
  };
  domains: DomainRow[];
};

type AdaptiveLevelResponse = {
  level: number;
  label: string;
};

const DIFFICULTIES: { value: Difficulty; label: string; copy: string }[] = [
  { value: 'normal', label: 'Establishing', copy: 'Approachable, core-recognition questions.' },
  { value: 'moderate', label: 'Familiar', copy: 'Recognizable questions for anyone reasonably engaged with the domain.' },
  { value: 'challenging', label: 'Solid', copy: 'Deeper-domain questions with more specific recall.' },
  { value: 'ridiculous', label: 'Mastery', copy: 'Mastery-level deep cuts within the domain.' },
  { value: 'adaptive', label: 'Adaptive', copy: 'Calibrated to your recent performance.' },
];

const TIER_NEXT_POINTS = {
  establishing: 100,
  familiar: 1000,
  solid: 2000,
  mastery: Number.POSITIVE_INFINITY,
};

function selectedCopy(difficulty: Difficulty): string {
  return DIFFICULTIES.find((item) => item.value === difficulty)?.copy ?? DIFFICULTIES[4].copy;
}

function masteryDistance(domain: DomainRow): number {
  const next = TIER_NEXT_POINTS[domain.tier];
  return Number.isFinite(next) ? Math.max(0, next - domain.totalPoints) : Number.POSITIVE_INFINITY;
}

function groupByCategory(domains: DomainRow[]) {
  const groups = new Map<string, DomainRow[]>();
  for (const domain of domains) {
    const category = domain.broadCategory ?? 'General Knowledge';
    groups.set(category, [...(groups.get(category) ?? []), domain]);
  }
  return Array.from(groups.entries())
    .map(([category, rows]) => ({
      category,
      domains: rows.sort((a, b) => a.domain.localeCompare(b.domain)),
    }))
    .sort((a, b) => a.category.localeCompare(b.category));
}

export default function DailySetupPage() {
  return (
    <Suspense>
      <DailySetupContent />
    </Suspense>
  );
}

function DailySetupContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [domains, setDomains] = useState<DomainRow[]>([]);
  const [difficulty, setDifficulty] = useState<Difficulty>('adaptive');
  const [domainMode, setDomainMode] = useState<DomainMode>('random');
  const [sortMode, setSortMode] = useState<DomainSortMode>('category');
  const [selectedDomains, setSelectedDomains] = useState<Set<string>>(new Set());
  const [adaptiveLabel, setAdaptiveLabel] = useState<string | null>(null);
  const [hasUnstartedQueue, setHasUnstartedQueue] = useState(false);
  const [roundComplete, setRoundComplete] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const [statusResponse, preferencesResponse, adaptiveResponse] = await Promise.all([
          fetch('/api/daily/status', { credentials: 'include', cache: 'no-store' }),
          fetch('/api/daily/preferences', { credentials: 'include', cache: 'no-store' }),
          fetch('/api/account/adaptive-level', { credentials: 'include', cache: 'no-store' }),
        ]);

        if (statusResponse.status === 401 || preferencesResponse.status === 401 || adaptiveResponse.status === 401) {
          router.replace('/login');
          return;
        }

        if (!statusResponse.ok || !preferencesResponse.ok) {
          throw new Error('Could not load setup.');
        }

        const status = await statusResponse.json();
        const questionsAnswered =
          typeof status.questionsAnswered === 'number'
            ? status.questionsAnswered
            : typeof status.answered === 'number'
              ? status.answered
              : 0;
        const isComplete = Boolean(status.complete || status.isComplete);
        const inProgress = Boolean(status.queue_id) && !isComplete && questionsAnswered > 0;
        if (inProgress) {
          router.replace('/daily');
          return;
        }
        setRoundComplete(isComplete);

        const body = (await preferencesResponse.json()) as PreferencesResponse;
        if (cancelled) return;

        const requestedDomain = searchParams.get('domain')?.trim();
        const requestedCustom = searchParams.get('domainMode') === 'custom' && requestedDomain;
        const availableDomains = body.domains ?? [];
        if (
          requestedCustom &&
          !availableDomains.some((domain) => domain.domain.toLocaleLowerCase('en-US') === requestedDomain.toLocaleLowerCase('en-US'))
        ) {
          router.replace(`/knowledge?emptyDomain=${encodeURIComponent(requestedDomain)}`);
          return;
        }

        setHasUnstartedQueue(Boolean(status.queue_id));
        setDomains(availableDomains);
        setDifficulty(body.preferences?.difficulty ?? 'adaptive');
        setDomainMode(requestedCustom ? 'custom' : body.preferences?.domainMode ?? 'random');
        setSelectedDomains(new Set(requestedCustom ? [requestedDomain] : body.preferences?.selectedDomains ?? []));

        if (adaptiveResponse.ok) {
          const adaptiveBody = (await adaptiveResponse.json()) as AdaptiveLevelResponse;
          setAdaptiveLabel(adaptiveBody.label ?? null);
        }
      } catch (caught) {
        if (!cancelled) setError(caught instanceof Error ? caught.message : 'Could not load setup.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [router, searchParams]);

  const categoryGroups = useMemo(() => groupByCategory(domains), [domains]);
  const masteryDomains = useMemo(
    () => [...domains].sort((a, b) => masteryDistance(a) - masteryDistance(b) || a.domain.localeCompare(b.domain)),
    [domains],
  );
  const selectedCount = selectedDomains.size;
  const canStart = !submitting && domains.length > 0 && (domainMode === 'random' || selectedCount > 0);

  const toggleDomain = useCallback((domain: string) => {
    setSelectedDomains((existing) => {
      const next = new Set(existing);
      if (next.has(domain)) next.delete(domain);
      else next.add(domain);
      return next;
    });
  }, []);

  const startRound = useCallback(async () => {
    if (!canStart) return;
    setSubmitting(true);
    setError(null);

    try {
      const preferenceResponse = await fetch('/api/daily/preferences', {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          difficulty,
          domainMode,
          selectedDomains: domainMode === 'custom' ? Array.from(selectedDomains) : [],
        }),
      });
      if (!preferenceResponse.ok) {
        const body = await preferenceResponse.json().catch(() => null);
        throw new Error(body?.message ?? 'Could not save your setup.');
      }

      if (roundComplete) {
        router.push('/');
        return;
      }

      if (hasUnstartedQueue) {
        const resetResponse = await fetch('/api/daily/reset', {
          method: 'POST',
          credentials: 'include',
          cache: 'no-store',
        });
        if (!resetResponse.ok) {
          const body = await resetResponse.json().catch(() => null);
          throw new Error(body?.message ?? 'Could not refresh your setup.');
        }
      }

      const queueResponse = await fetch('/api/daily/queue', {
        method: 'POST',
        credentials: 'include',
        cache: 'no-store',
      });
      const queueBody = await queueResponse.json().catch(() => null);
      if (!queueResponse.ok) {
        // Only the "no knowledge base for this domain" failure should send the
        // user to the empty-state knowledge page. Transient generation
        // failures (503 `generation_failed`, e.g. LLM outage or exhausted
        // credits) should surface the server's banner so we don't lie that
        // the topic itself is missing.
        if (
          queueBody?.error === 'no_knowledge_base' &&
          domainMode === 'custom' &&
          selectedDomains.size > 0
        ) {
          const [domain] = Array.from(selectedDomains);
          router.push(`/knowledge?emptyDomain=${encodeURIComponent(domain)}`);
          return;
        }
        throw new Error(queueBody?.message ?? 'Could not build your round.');
      }

      router.push('/daily');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not start your round.');
      setSubmitting(false);
    }
  }, [canStart, difficulty, domainMode, hasUnstartedQueue, roundComplete, router, selectedDomains]);

  if (loading) {
    return (
      <main className="mx-auto max-w-xl px-4 py-8">
        <p className="text-sm uppercase tracking-[0.12em] text-muted-foreground">Loading...</p>
      </main>
    );
  }

  return (
    <main className="mx-auto min-h-dvh max-w-xl px-4 py-8 pb-32">
      <header className="mb-8">
        <p className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
          Today&apos;s Five
        </p>
        <h1 className="mt-3 font-serif text-4xl font-semibold leading-tight text-foreground">
          Set up your round
        </h1>
      </header>

      {roundComplete ? (
        <p className="mb-6 rounded-lg border bg-card p-3 text-sm text-muted-foreground">
          Today&apos;s round is done. Changes save for your next round.
        </p>
      ) : null}

      <section className="border-b pb-7">
        <p className="mb-3 text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
          Difficulty
        </p>
        <div className="flex flex-wrap gap-3">
          {DIFFICULTIES.map((item) => {
            const active = difficulty === item.value;
            return (
              <button
                key={item.value}
                type="button"
                onClick={() => setDifficulty(item.value)}
                className={`min-h-11 whitespace-nowrap rounded-full border px-5 text-xs font-medium uppercase tracking-[0.08em] transition ${
                  active ? 'bg-primary text-primary-foreground' : 'bg-card text-muted-foreground'
                }`}
                aria-pressed={active}
              >
                {item.label}
              </button>
            );
          })}
        </div>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          {difficulty === 'adaptive' && adaptiveLabel
            ? `Calibrated to your recent performance: ${adaptiveLabel}`
            : selectedCopy(difficulty)}
        </p>
      </section>

      <section className="py-7">
        <div className="mb-3 flex items-center justify-between gap-3">
          <p className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
            Domains
          </p>
          {domainMode === 'custom' ? (
            <p className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
              {selectedCount} selected
            </p>
          ) : null}
        </div>

        <div className="mb-4 grid rounded-full border bg-card p-1 text-sm font-medium">
          <div className="grid grid-cols-2">
            {(['random', 'custom'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setDomainMode(mode)}
                className={`min-h-10 rounded-full px-4 capitalize transition ${
                  domainMode === mode ? 'bg-foreground text-background' : 'text-muted-foreground'
                }`}
                aria-pressed={domainMode === mode}
              >
                {mode}
              </button>
            ))}
          </div>
        </div>

        {domainMode === 'random' ? (
          <p className="text-sm leading-6 text-muted-foreground">
            We&apos;ll pull from across your full knowledge base.
          </p>
        ) : (
          <div>
            <div className="mb-4 inline-grid grid-cols-2 rounded-full border bg-card p-1 text-xs font-medium uppercase tracking-[0.08em]">
              {[
                { value: 'category', label: 'By Category' },
                { value: 'mastery', label: 'By Mastery' },
              ].map((item) => (
                <button
                  key={item.value}
                  type="button"
                  onClick={() => setSortMode(item.value as DomainSortMode)}
                  className={`min-h-9 rounded-full px-3 ${
                    sortMode === item.value ? 'bg-foreground text-background' : 'text-muted-foreground'
                  }`}
                  aria-pressed={sortMode === item.value}
                >
                  {item.label}
                </button>
              ))}
            </div>

            {domains.length === 0 ? (
              <p className="rounded-lg border bg-card p-4 text-sm text-muted-foreground">
                Add interests before starting a Daily Five.
              </p>
            ) : sortMode === 'category' ? (
              <div className="space-y-5">
                {categoryGroups.map((group) => (
                  <div key={group.category}>
                    <p className="mb-2 border-b pb-2 text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
                      {group.category}
                    </p>
                    <div className="grid gap-2">
                      {group.domains.map((domain) => (
                        <DomainOption
                          key={domain.domain}
                          domain={domain}
                          selected={selectedDomains.has(domain.domain)}
                          onToggle={toggleDomain}
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="grid gap-2">
                {masteryDomains.map((domain) => (
                  <DomainOption
                    key={domain.domain}
                    domain={domain}
                    selected={selectedDomains.has(domain.domain)}
                    onToggle={toggleDomain}
                  />
                ))}
              </div>
            )}

            {selectedCount === 0 ? (
              <p className="mt-3 text-sm text-destructive">Choose at least one domain to start.</p>
            ) : null}
          </div>
        )}
      </section>

      {error ? (
        <p className="rounded-lg border border-destructive/40 bg-card p-3 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <div className="fixed inset-x-0 bottom-16 z-50 border-t bg-background/95 px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] backdrop-blur md:bottom-0 md:pb-3">
        <div className="mx-auto flex max-w-xl items-center gap-3">
          <Link href="/" className="btn-ghost min-h-11 px-4">
            Home
          </Link>
          <button
            type="button"
            className="btn-primary min-h-11 flex-1 justify-center"
            disabled={!canStart}
            onClick={() => void startRound()}
          >
            {roundComplete
              ? submitting
                ? 'Saving...'
                : 'Save for next round'
              : submitting
                ? 'Starting...'
                : 'Start round'}
          </button>
        </div>
      </div>
    </main>
  );
}

function DomainOption({
  domain,
  selected,
  onToggle,
}: {
  domain: DomainRow;
  selected: boolean;
  onToggle: (domain: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onToggle(domain.domain)}
      className="flex min-h-14 items-center gap-3 rounded-lg border bg-card px-3 py-2 text-left transition hover:border-foreground/25"
      aria-pressed={selected}
    >
      <span
        className={`grid size-5 shrink-0 place-items-center rounded border ${
          selected ? 'border-primary bg-primary text-primary-foreground' : 'border-muted-foreground/40'
        }`}
        aria-hidden="true"
      >
        {selected ? <Check className="size-3.5" /> : null}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-foreground">{domain.domain}</span>
        <span className="mt-0.5 block text-xs text-muted-foreground">
          {KNOWLEDGE_TIER_LABEL[domain.tier]} {Number.isFinite(masteryDistance(domain)) ? `, ${Math.ceil(masteryDistance(domain))} pts to next tier` : ''}
        </span>
      </span>
    </button>
  );
}
