'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Plus } from 'lucide-react';

import LoadingScreen from '@/components/LoadingScreen';
import { KnowledgeBubble } from '@/components/knowledge/KnowledgeBubble';
import { getPortraitDomainColor } from '@/components/knowledge/PortraitCircles';
import { getPortraitCircleSize, type CircleSizingTier } from '@/lib/knowledge/circle-sizing';
import {
  buildInitialFrequencyMap,
  buildSavePayload,
  getNearbyTerritories,
  type DomainPreferenceFrequency,
  type NearbyTerritory,
  type TerritoryDomain,
  type TerritoryFrequency,
} from '@/lib/daily/territory-model';

type Difficulty = 'normal' | 'moderate' | 'challenging' | 'ridiculous' | 'adaptive';
type DomainMode = 'random' | 'custom';

type PreferencesResponse = {
  preferences: {
    difficulty: Difficulty;
    domainMode: DomainMode;
    selectedDomains: string[];
    domainPreferenceFrequency?: DomainPreferenceFrequency;
    domain_preference_frequency?: DomainPreferenceFrequency;
  };
  domains: Array<
    TerritoryDomain & { canonical_subcategory?: string; correct_answer_count?: number }
  >;
};

type DragState = {
  domain: string;
  x: number;
  y: number;
} | null;

const ZONES: Array<{ value: TerritoryFrequency; title: string; copy: string }> = [
  { value: 'often', title: 'Asked Often', copy: 'These show up most in your rounds.' },
  { value: 'sometimes', title: 'Asked Sometimes', copy: 'These stay in rotation, but less often.' },
  {
    value: 'resting',
    title: 'Resting',
    copy: 'These are part of your map, but won’t be asked for now.',
  },
];

const ZONE_TITLES: Record<TerritoryFrequency, string> = {
  often: 'Often',
  sometimes: 'Sometimes',
  resting: 'Resting',
};

export function TerritorySetupClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const zoneRefs = useRef<Record<TerritoryFrequency, HTMLElement | null>>({
    often: null,
    sometimes: null,
    resting: null,
  });
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [domains, setDomains] = useState<TerritoryDomain[]>([]);
  const [difficulty, setDifficulty] = useState<Difficulty>('adaptive');
  const [frequencyByDomain, setFrequencyByDomain] = useState<DomainPreferenceFrequency>({});
  const [hasUnstartedQueue, setHasUnstartedQueue] = useState(false);
  const [roundComplete, setRoundComplete] = useState(false);
  const [newTopic, setNewTopic] = useState('');
  const [addingTopic, setAddingTopic] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [addLimitReached, setAddLimitReached] = useState(false);
  const [dragState, setDragState] = useState<DragState>(null);
  const [hoveredZone, setHoveredZone] = useState<TerritoryFrequency | null>(null);
  const [settling, setSettling] = useState(true);

  useEffect(() => {
    const timer = window.setTimeout(() => setSettling(false), 900);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const [statusResponse, preferencesResponse] = await Promise.all([
          fetch('/api/daily/status', { credentials: 'include', cache: 'no-store' }),
          fetch('/api/daily/preferences', { credentials: 'include', cache: 'no-store' }),
        ]);

        if (statusResponse.status === 401 || preferencesResponse.status === 401) {
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

        const availableDomains = (body.domains ?? []).map((domain) => ({
          domain: domain.domain,
          broadCategory: domain.broadCategory ?? null,
          totalPoints: domain.totalPoints,
          tier: domain.tier,
          correctAnswerCount:
            typeof domain.correctAnswerCount === 'number'
              ? domain.correctAnswerCount
              : typeof domain.correct_answer_count === 'number'
                ? domain.correct_answer_count
                : 0,
        }));
        const requestedDomain = searchParams.get('domain')?.trim();
        const requestedCustom = searchParams.get('domainMode') === 'custom' && requestedDomain;
        if (
          requestedCustom &&
          !availableDomains.some(
            (domain) =>
              domain.domain.toLocaleLowerCase('en-US') ===
              requestedDomain.toLocaleLowerCase('en-US'),
          )
        ) {
          router.replace(`/knowledge?emptyDomain=${encodeURIComponent(requestedDomain)}`);
          return;
        }

        const selectedDomains = requestedCustom
          ? [requestedDomain]
          : (body.preferences?.selectedDomains ?? []);
        setHasUnstartedQueue(Boolean(status.queue_id));
        setDomains(availableDomains);
        setDifficulty(body.preferences?.difficulty ?? 'adaptive');
        setFrequencyByDomain(
          buildInitialFrequencyMap({
            domains: availableDomains,
            savedFrequency: requestedCustom
              ? null
              : (body.preferences?.domainPreferenceFrequency ??
                body.preferences?.domain_preference_frequency ??
                null),
            selectedDomains,
            domainMode: requestedCustom ? 'custom' : (body.preferences?.domainMode ?? 'random'),
          }),
        );
      } catch (caught) {
        if (!cancelled)
          setError(caught instanceof Error ? caught.message : 'Could not load setup.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [router, searchParams]);

  const maxPointsByTier = useMemo(() => {
    const result: Record<TerritoryDomain['tier'], number> = {
      establishing: 1,
      familiar: 1,
      solid: 1,
      mastery: 1,
    };
    for (const domain of domains) {
      if (domain.totalPoints > result[domain.tier]) result[domain.tier] = domain.totalPoints;
    }
    return result;
  }, [domains]);

  const domainsByZone = useMemo(() => {
    const result: Record<TerritoryFrequency, TerritoryDomain[]> = {
      often: [],
      sometimes: [],
      resting: [],
    };
    for (const domain of domains) {
      result[frequencyByDomain[domain.domain] ?? 'sometimes'].push(domain);
    }
    for (const zone of ZONES) {
      result[zone.value].sort(
        (a, b) => b.totalPoints - a.totalPoints || a.domain.localeCompare(b.domain),
      );
    }
    return result;
  }, [domains, frequencyByDomain]);

  const nearbyTerritories = useMemo(
    () => getNearbyTerritories(domains.map((domain) => domain.domain)),
    [domains],
  );

  const canSave = !submitting && domains.length > 0;

  const moveDomain = useCallback((domain: string, frequency: TerritoryFrequency) => {
    setFrequencyByDomain((existing) => ({ ...existing, [domain]: frequency }));
  }, []);

  const addDomainRow = useCallback((row: TerritoryDomain) => {
    const key = row.domain.toLocaleLowerCase('en-US');
    setDomains((existing) =>
      existing.some((entry) => entry.domain.toLocaleLowerCase('en-US') === key)
        ? existing
        : [...existing, row],
    );
    setFrequencyByDomain((existing) => ({ ...existing, [row.domain]: 'sometimes' }));
  }, []);

  const adoptTopic = useCallback(
    async (label: string, broadCategory?: string | null) => {
      const response = await fetch('/api/declared-interests', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ label, ...(broadCategory ? { broadCategory } : {}) }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        setAddLimitReached(body?.error === 'interest_limit_reached');
        throw new Error(body?.message ?? 'Could not add that topic.');
      }
      const row: TerritoryDomain = {
        domain: body.domain,
        broadCategory: body.broadCategory ?? broadCategory ?? null,
        totalPoints: typeof body.totalPoints === 'number' ? body.totalPoints : 0,
        tier: body.tier ?? 'establishing',
        correctAnswerCount:
          typeof body.correctAnswerCount === 'number' ? body.correctAnswerCount : 0,
      };
      addDomainRow(row);
      return row;
    },
    [addDomainRow],
  );

  const addTopic = useCallback(async () => {
    const label = newTopic.trim();
    if (!label || addingTopic) return;
    setAddingTopic(true);
    setAddError(null);
    setAddLimitReached(false);

    try {
      await adoptTopic(label);
      setNewTopic('');
    } catch (caught) {
      setAddError(caught instanceof Error ? caught.message : 'Could not add that topic.');
    } finally {
      setAddingTopic(false);
    }
  }, [addingTopic, adoptTopic, newTopic]);

  const addNearbyTerritory = useCallback(
    async (territory: NearbyTerritory) => {
      if (addingTopic) return;
      setAddingTopic(true);
      setAddError(null);
      setAddLimitReached(false);
      try {
        await adoptTopic(territory.domain, territory.broadCategory);
      } catch (caught) {
        setAddError(caught instanceof Error ? caught.message : 'Could not add that territory.');
      } finally {
        setAddingTopic(false);
      }
    },
    [addingTopic, adoptTopic],
  );

  const zoneAtPoint = useCallback((x: number, y: number): TerritoryFrequency | null => {
    for (const zone of ZONES) {
      const element = zoneRefs.current[zone.value];
      if (!element) continue;
      const rect = element.getBoundingClientRect();
      if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) return zone.value;
    }
    return null;
  }, []);

  const handleDragStart = useCallback(
    (event: ReactPointerEvent, domain: string) => {
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      setDragState({ domain, x: event.clientX, y: event.clientY });
      setHoveredZone(zoneAtPoint(event.clientX, event.clientY));
    },
    [zoneAtPoint],
  );

  const handleDragMove = useCallback(
    (event: ReactPointerEvent) => {
      if (!dragState) return;
      setDragState({ domain: dragState.domain, x: event.clientX, y: event.clientY });
      setHoveredZone(zoneAtPoint(event.clientX, event.clientY));
    },
    [dragState, zoneAtPoint],
  );

  const handleDragEnd = useCallback(
    (event: ReactPointerEvent) => {
      if (!dragState) return;
      const nextZone = zoneAtPoint(event.clientX, event.clientY);
      if (nextZone) moveDomain(dragState.domain, nextZone);
      setDragState(null);
      setHoveredZone(null);
    },
    [dragState, moveDomain, zoneAtPoint],
  );

  const saveForNextRound = useCallback(async () => {
    if (!canSave) return;
    setSubmitting(true);
    setError(null);

    try {
      const preferenceResponse = await fetch('/api/daily/preferences', {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(buildSavePayload({ difficulty, frequencyByDomain })),
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
        throw new Error(queueBody?.message ?? 'Could not build your round.');
      }

      router.push('/daily');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save your setup.');
      setSubmitting(false);
    }
  }, [canSave, difficulty, frequencyByDomain, hasUnstartedQueue, roundComplete, router]);

  if (loading) {
    return <LoadingScreen fullScreen />;
  }

  return (
    <main className="min-h-dvh bg-[var(--cream)] px-4 py-8 pb-36 text-[var(--ink)]">
      <div className="mx-auto max-w-3xl">
        <header className="mb-8">
          <p className="text-xs font-semibold tracking-[0.2em] text-[var(--text-muted-warm)] uppercase">
            TODAY’S FIVE
          </p>
          <h1 className="mt-3 font-serif text-5xl leading-[0.95] font-semibold text-[var(--ink)]">
            Shape your next round
          </h1>
          <p className="mt-4 max-w-lg text-base leading-7 text-[var(--text-muted-warm)]">
            Move territories around to decide what Joshing should ask you about next.
          </p>
        </header>

        {roundComplete ? (
          <p className="mb-6 rounded-2xl border border-[var(--border-warm)] bg-[var(--cream-warm)] p-4 text-sm text-[var(--text-muted-warm)]">
            Today’s round is done. Changes save for your next round.
          </p>
        ) : null}

        {domains.length === 0 ? (
          <section className="mb-6 rounded-[2rem] border border-dashed border-[var(--border-warm)] bg-white/35 p-6 text-center">
            <h2 className="font-serif text-2xl font-semibold text-[var(--ink)]">
              Your map is ready for its first territory.
            </h2>
            <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-[var(--text-muted-warm)]">
              Add something you’d be delighted to be asked about, and Joshing will start shaping
              around it.
            </p>
          </section>
        ) : null}

        <section className="space-y-5" aria-label="Round territory frequency zones">
          {ZONES.map((zone) => (
            <TerritoryZone
              key={zone.value}
              zone={zone}
              domains={domainsByZone[zone.value]}
              maxPointsByTier={maxPointsByTier}
              highlighted={hoveredZone === zone.value}
              dragState={dragState}
              onMove={moveDomain}
              onDragStart={handleDragStart}
              onDragMove={handleDragMove}
              onDragEnd={handleDragEnd}
              setRef={(element) => {
                zoneRefs.current[zone.value] = element;
              }}
              settling={settling}
            />
          ))}
        </section>

        {nearbyTerritories.length > 0 ? (
          <section className="mt-8 rounded-[2rem] border border-[var(--border-light)] bg-white/35 p-5">
            <div className="mb-4">
              <h2 className="font-serif text-2xl font-semibold text-[var(--ink)]">
                Nearby Territory
              </h2>
              <p className="mt-1 text-sm leading-6 text-[var(--text-muted-warm)]">
                Suggestions based on the shape of your map.
              </p>
            </div>
            <div className="flex flex-wrap gap-4">
              {nearbyTerritories.map((territory) => (
                <GhostTerritoryCircle
                  key={territory.domain}
                  territory={territory}
                  disabled={addingTopic}
                  onAdd={() => void addNearbyTerritory(territory)}
                />
              ))}
            </div>
          </section>
        ) : domains.length > 0 ? (
          <p className="mt-8 rounded-2xl border border-[var(--border-light)] bg-white/30 p-4 text-sm text-[var(--text-muted-warm)]">
            More suggestions will appear as your map grows.
          </p>
        ) : null}

        <section className="mt-8 rounded-[2rem] border border-[var(--border-warm)] bg-[var(--cream-warm)] p-5">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void addTopic();
            }}
          >
            <label
              htmlFor="add-topic"
              className="block font-serif text-2xl font-semibold text-[var(--ink)]"
            >
              Explore something new
            </label>
            <div className="mt-4 flex gap-2">
              <input
                id="add-topic"
                type="text"
                value={newTopic}
                onChange={(event) => setNewTopic(event.target.value)}
                placeholder="e.g. Byzantine Coinage"
                maxLength={80}
                autoComplete="off"
                className="min-h-12 flex-1 rounded-full border border-[var(--border-warm)] bg-[var(--cream)] px-4 text-sm text-[var(--ink)] placeholder:text-[var(--text-muted-warm)]/60 focus-visible:ring-2 focus-visible:ring-[var(--ink)] focus-visible:ring-offset-2 focus-visible:outline-none"
              />
              <button
                type="submit"
                className="btn-ghost min-h-12 px-5"
                disabled={addingTopic || !newTopic.trim()}
              >
                {addingTopic ? 'Adding…' : 'Add'}
              </button>
            </div>
            {addError ? (
              <p className="text-destructive mt-3 text-sm">
                {addError}
                {addLimitReached ? (
                  <>
                    {' '}
                    <Link href="/knowledge" className="underline">
                      Manage interests
                    </Link>
                  </>
                ) : null}
              </p>
            ) : null}
          </form>
        </section>

        {error ? (
          <p className="border-destructive/40 text-destructive mt-6 rounded-2xl border bg-white/50 p-4 text-sm">
            {error}
          </p>
        ) : null}
      </div>

      <div className="fixed inset-x-0 bottom-16 z-50 border-t border-[var(--border-warm)] bg-[var(--cream)]/95 px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] backdrop-blur md:bottom-0 md:pb-3">
        <div className="mx-auto flex max-w-3xl items-center gap-3">
          <Link href="/" className="btn-ghost min-h-11 px-5">
            Home
          </Link>
          <button
            type="button"
            className="btn-primary min-h-11 flex-1 justify-center"
            disabled={!canSave}
            onClick={() => void saveForNextRound()}
          >
            {submitting ? 'Saving…' : 'Save for next round'}
          </button>
        </div>
      </div>

      {dragState ? (
        <div
          className="pointer-events-none fixed z-[60] -translate-x-1/2 -translate-y-1/2"
          style={{ left: dragState.x, top: dragState.y }}
        >
          <span className="rounded-full bg-[var(--ink)] px-3 py-1 text-xs text-[var(--cream)] shadow-lg">
            Moving territory
          </span>
        </div>
      ) : null}
    </main>
  );
}

function TerritoryZone({
  zone,
  domains,
  maxPointsByTier,
  highlighted,
  dragState,
  onMove,
  onDragStart,
  onDragMove,
  onDragEnd,
  setRef,
  settling,
}: {
  zone: { value: TerritoryFrequency; title: string; copy: string };
  domains: TerritoryDomain[];
  maxPointsByTier: Record<TerritoryDomain['tier'], number>;
  highlighted: boolean;
  dragState: DragState;
  onMove: (domain: string, frequency: TerritoryFrequency) => void;
  onDragStart: (event: ReactPointerEvent, domain: string) => void;
  onDragMove: (event: ReactPointerEvent) => void;
  onDragEnd: (event: ReactPointerEvent) => void;
  setRef: (element: HTMLElement | null) => void;
  settling: boolean;
}) {
  return (
    <section
      ref={setRef}
      className={`rounded-[2rem] border bg-white/40 p-4 transition ${highlighted ? 'border-[var(--ink)] shadow-[0_10px_30px_rgba(26,18,8,0.12)]' : 'border-[var(--border-warm)]'}`}
    >
      <div className="mb-4">
        <h2 className="font-serif text-2xl font-semibold text-[var(--ink)]">{zone.title}</h2>
        <p className="mt-1 text-sm leading-6 text-[var(--text-muted-warm)]">{zone.copy}</p>
      </div>
      <div className="flex min-h-28 flex-wrap items-start gap-4 rounded-[1.5rem] border border-dashed border-[var(--border-light)] bg-[var(--cream)]/50 p-3">
        {domains.length > 0 ? (
          domains.map((domain) => (
            <TerritoryCircle
              key={domain.domain}
              domain={domain}
              currentZone={zone.value}
              maxPointsForTier={maxPointsByTier[domain.tier] ?? 1}
              onMove={onMove}
              dragging={dragState?.domain === domain.domain}
              onDragStart={onDragStart}
              onDragMove={onDragMove}
              onDragEnd={onDragEnd}
              settling={settling}
            />
          ))
        ) : (
          <p className="self-center px-2 text-sm text-[var(--text-muted-warm)] italic">
            Drop a territory here.
          </p>
        )}
      </div>
    </section>
  );
}

function TerritoryCircle({
  domain,
  currentZone,
  maxPointsForTier,
  onMove,
  dragging,
  onDragStart,
  onDragMove,
  onDragEnd,
  settling,
}: {
  domain: TerritoryDomain;
  currentZone: TerritoryFrequency;
  maxPointsForTier: number;
  onMove: (domain: string, frequency: TerritoryFrequency) => void;
  dragging: boolean;
  onDragStart: (event: ReactPointerEvent, domain: string) => void;
  onDragMove: (event: ReactPointerEvent) => void;
  onDragEnd: (event: ReactPointerEvent) => void;
  settling: boolean;
}) {
  const broadCategory = domain.broadCategory ?? 'General Knowledge';
  const color = getPortraitDomainColor(broadCategory);
  const size = Math.min(
    112,
    Math.max(
      54,
      Math.round(
        getPortraitCircleSize(
          domain.tier as CircleSizingTier,
          domain.totalPoints,
          maxPointsForTier,
        ) * 0.42,
      ),
    ),
  );
  const countFontSize = Math.min(28, Math.max(14, Math.round(size * 0.28)));
  // correctAnswerCount is supplied by the preferences API when answer history exists;
  // new declared/suggested territories intentionally show 0 until play history opens them.
  const correctCount = domain.correctAnswerCount;

  return (
    <div
      className={`group relative flex w-[104px] touch-none flex-col items-center gap-2 rounded-[1.5rem] p-2 text-center transition duration-300 select-none ${dragging ? 'scale-95 opacity-40' : 'opacity-100'} ${settling ? 'motion-safe:animate-[territory-settle_850ms_ease-out]' : ''}`}
      onPointerDown={(event) => onDragStart(event, domain.domain)}
      onPointerMove={onDragMove}
      onPointerUp={onDragEnd}
      onPointerCancel={onDragEnd}
    >
      <KnowledgeBubble
        diameter={size}
        light={color.light}
        border={`1px solid ${color.primary}44`}
        style={{ boxShadow: '0 8px 22px rgba(26,18,8,0.08)' }}
      >
        <span
          style={{
            fontSize: countFontSize,
            color: color.primary,
            fontFamily: 'var(--font-cormorant, Georgia), "Times New Roman", serif',
            fontWeight: 700,
            lineHeight: 1,
          }}
        >
          {correctCount}
        </span>
      </KnowledgeBubble>
      <span
        className="max-w-[96px] font-serif text-[13px] leading-tight break-words"
        style={{ color: color.text }}
      >
        {domain.domain}
      </span>
      <div className="flex flex-col gap-1 opacity-100 sm:absolute sm:top-full sm:left-1/2 sm:z-20 sm:w-36 sm:-translate-x-1/2 sm:rounded-2xl sm:border sm:border-[var(--border-warm)] sm:bg-[var(--cream)] sm:p-2 sm:opacity-0 sm:shadow-lg sm:transition sm:group-focus-within:opacity-100 sm:group-hover:opacity-100">
        {ZONES.map((zone) => (
          <button
            key={zone.value}
            type="button"
            className="rounded-full px-2 py-1 text-xs text-[var(--ink)] transition hover:bg-[var(--cream-accent)] disabled:opacity-40"
            disabled={currentZone === zone.value}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => onMove(domain.domain, zone.value)}
          >
            Move to {ZONE_TITLES[zone.value]}
          </button>
        ))}
      </div>
    </div>
  );
}

function GhostTerritoryCircle({
  territory,
  disabled,
  onAdd,
}: {
  territory: NearbyTerritory;
  disabled: boolean;
  onAdd: () => void;
}) {
  const color = getPortraitDomainColor(territory.broadCategory ?? 'General Knowledge');
  const style = {
    '--territory-border': `${color.primary}66`,
    '--territory-text': color.text,
  } as CSSProperties;

  return (
    <button
      type="button"
      className="flex w-[104px] flex-col items-center gap-2 rounded-[1.5rem] p-2 text-center opacity-70 transition hover:opacity-100 disabled:opacity-40"
      style={style}
      disabled={disabled}
      onClick={onAdd}
    >
      <div className="grid size-16 place-items-center rounded-full border border-dashed border-[var(--territory-border)] bg-white/35 text-[var(--territory-text)]">
        <Plus className="size-5" aria-hidden="true" />
      </div>
      <span className="max-w-[96px] font-serif text-[13px] leading-tight break-words text-[var(--territory-text)]">
        {territory.domain}
      </span>
      <span className="text-[10px] tracking-[0.14em] text-[var(--text-muted-warm)] uppercase">
        Add
      </span>
    </button>
  );
}
