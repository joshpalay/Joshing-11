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
import { useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';

import { KnowledgeBubble } from '@/components/knowledge/KnowledgeBubble';
import { getPortraitDomainColor } from '@/components/knowledge/PortraitCircles';
import { normalizeBroadCategory } from '@/lib/knowledge/broad-category';
import { getPortraitCircleSize, type CircleSizingTier } from '@/lib/knowledge/circle-sizing';
import {
  buildSavePayload,
  getNearbyTerritories,
  type DomainPreferenceFrequency,
  type NearbyTerritory,
  type TerritoryDomain,
  type TerritoryFrequency,
} from '@/lib/daily/territory-model';

type Difficulty = 'normal' | 'moderate' | 'challenging' | 'ridiculous' | 'adaptive';

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

// "General Knowledge" is the categorizer's catch-all bucket; show it under a
// softer label, matching the Knowledge portrait sections.
const CATEGORY_LABEL_OVERRIDES: Record<string, string> = {
  'General Knowledge': 'Other interests',
};

function categorySectionLabel(category: string): string {
  return CATEGORY_LABEL_OVERRIDES[category] ?? category;
}

const GENERAL_KNOWLEDGE = 'General Knowledge';

type CategoryGroup = { category: string; domains: TerritoryDomain[] };

function groupByCategory(domains: TerritoryDomain[]): CategoryGroup[] {
  const byCategory = new Map<string, TerritoryDomain[]>();
  for (const domain of domains) {
    const category = normalizeBroadCategory(domain.broadCategory) ?? GENERAL_KNOWLEDGE;
    const list = byCategory.get(category) ?? [];
    list.push(domain);
    byCategory.set(category, list);
  }
  return [...byCategory.entries()]
    .map(([category, items]) => ({
      category,
      domains: items,
      totalPoints: items.reduce((sum, item) => sum + item.totalPoints, 0),
    }))
    .sort((a, b) => {
      // Keep the catch-all bucket last; otherwise heaviest category first.
      if (a.category === GENERAL_KNOWLEDGE) return 1;
      if (b.category === GENERAL_KNOWLEDGE) return -1;
      return b.totalPoints - a.totalPoints || a.category.localeCompare(b.category);
    })
    .map(({ category, domains: items }) => ({ category, domains: items }));
}

export function TerritorySetupClient({
  initialDomains,
  initialDifficulty,
  initialFrequencyByDomain,
  hasUnstartedQueue,
  roundComplete,
}: {
  initialDomains: TerritoryDomain[];
  initialDifficulty: Difficulty;
  initialFrequencyByDomain: DomainPreferenceFrequency;
  hasUnstartedQueue: boolean;
  roundComplete: boolean;
}) {
  const router = useRouter();
  const zoneRefs = useRef<Record<TerritoryFrequency, HTMLElement | null>>({
    often: null,
    sometimes: null,
    resting: null,
  });
  const newTopicInputRef = useRef<HTMLInputElement | null>(null);
  const dragPointerRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const difficulty = initialDifficulty;
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [domains, setDomains] = useState<TerritoryDomain[]>(initialDomains);
  const [frequencyByDomain, setFrequencyByDomain] =
    useState<DomainPreferenceFrequency>(initialFrequencyByDomain);
  const [newTopic, setNewTopic] = useState('');
  const [addingTopic, setAddingTopic] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [addLimitReached, setAddLimitReached] = useState(false);
  const [dragState, setDragState] = useState<DragState>(null);
  const [hoveredZone, setHoveredZone] = useState<TerritoryFrequency | null>(null);
  const [settling, setSettling] = useState(true);

  // Data arrives from the server, so the territories render on first paint —
  // run the settle-in animation immediately on mount.
  useEffect(() => {
    const timer = window.setTimeout(() => setSettling(false), 900);
    return () => window.clearTimeout(timer);
  }, []);

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

  const focusCreateTopic = useCallback(() => {
    const input = newTopicInputRef.current;
    if (!input) return;
    input.scrollIntoView({ behavior: 'smooth', block: 'center' });
    input.focus({ preventScroll: true });
  }, []);

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
      dragPointerRef.current = { x: event.clientX, y: event.clientY };
      setDragState({ domain, x: event.clientX, y: event.clientY });
      setHoveredZone(zoneAtPoint(event.clientX, event.clientY));
    },
    [zoneAtPoint],
  );

  const handleDragMove = useCallback(
    (event: ReactPointerEvent) => {
      if (!dragState) return;
      dragPointerRef.current = { x: event.clientX, y: event.clientY };
      setDragState({ domain: dragState.domain, x: event.clientX, y: event.clientY });
      setHoveredZone(zoneAtPoint(event.clientX, event.clientY));
    },
    [dragState, zoneAtPoint],
  );

  // While a territory is held near the top/bottom edge, scroll the page so the
  // user can reach zones that are off-screen. A rAF loop (not pointermove)
  // keeps scrolling even when the finger is held still at the edge.
  const isDragging = dragState !== null;
  useEffect(() => {
    if (!isDragging) return;
    const EDGE = 96; // px from each edge that triggers auto-scroll
    const MAX_SPEED = 20; // px per frame at the very edge
    let frame = 0;
    const step = () => {
      const { x, y } = dragPointerRef.current;
      const viewportHeight = window.innerHeight;
      let delta = 0;
      if (y < EDGE) {
        delta = -Math.ceil(((EDGE - y) / EDGE) * MAX_SPEED);
      } else if (y > viewportHeight - EDGE) {
        delta = Math.ceil(((y - (viewportHeight - EDGE)) / EDGE) * MAX_SPEED);
      }
      if (delta !== 0) {
        window.scrollBy(0, delta);
        // Content shifted under a stationary pointer — re-resolve the hovered zone.
        setHoveredZone(zoneAtPoint(x, y));
      }
      frame = window.requestAnimationFrame(step);
    };
    frame = window.requestAnimationFrame(step);
    return () => window.cancelAnimationFrame(frame);
  }, [isDragging, zoneAtPoint]);

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

        <section className="mb-8 rounded-[2rem] border border-[var(--border-light)] bg-white/35 p-5">
          <div className="mb-4">
            <h2 className="font-serif text-2xl font-semibold text-[var(--ink)]">Add a Territory</h2>
            <p className="mt-1 text-sm leading-6 text-[var(--text-muted-warm)]">
              {nearbyTerritories.length > 0
                ? 'Suggestions based on the shape of your map — or create your own.'
                : 'Create your own, and more suggestions will appear as your map grows.'}
            </p>
          </div>
          <div className="grid grid-cols-3 gap-3">
            {nearbyTerritories.map((territory) => (
              <GhostTerritoryCircle
                key={territory.domain}
                territory={territory}
                disabled={addingTopic}
                onAdd={() => void addNearbyTerritory(territory)}
              />
            ))}
            <CreateYourOwnCircle disabled={addingTopic} onClick={focusCreateTopic} />
          </div>
        </section>

        <section className="space-y-5" aria-label="Round territory frequency zones">
          {ZONES.map((zone) => (
            <TerritoryZone
              key={zone.value}
              zone={zone}
              domains={domainsByZone[zone.value]}
              maxPointsByTier={maxPointsByTier}
              highlighted={hoveredZone === zone.value}
              dragState={dragState}
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
                ref={newTopicInputRef}
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

      <div className="fixed inset-x-0 bottom-0 z-50 border-t border-[var(--border-warm)] bg-[var(--cream)]/95 px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] backdrop-blur">
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
  onDragStart: (event: ReactPointerEvent, domain: string) => void;
  onDragMove: (event: ReactPointerEvent) => void;
  onDragEnd: (event: ReactPointerEvent) => void;
  setRef: (element: HTMLElement | null) => void;
  settling: boolean;
}) {
  const categoryGroups = useMemo(() => groupByCategory(domains), [domains]);

  return (
    <section
      ref={setRef}
      className={`rounded-[2rem] border bg-white/40 p-4 transition ${highlighted ? 'border-[var(--ink)] shadow-[0_10px_30px_rgba(26,18,8,0.12)]' : 'border-[var(--border-warm)]'}`}
    >
      <div className="mb-4">
        <h2 className="font-serif text-2xl font-semibold text-[var(--ink)]">{zone.title}</h2>
        <p className="mt-1 text-sm leading-6 text-[var(--text-muted-warm)]">{zone.copy}</p>
      </div>
      <div className="min-h-28 space-y-4 rounded-[1.5rem] border border-dashed border-[var(--border-light)] bg-[var(--cream)]/50 p-3">
        {categoryGroups.length > 0 ? (
          categoryGroups.map(({ category, domains: groupDomains }) => (
            <div key={category}>
              {categoryGroups.length > 1 ? (
                <p
                  className="mb-2 px-1 text-[0.7rem] font-semibold tracking-[0.14em] uppercase"
                  style={{ color: getPortraitDomainColor(category).text }}
                >
                  {categorySectionLabel(category)}
                </p>
              ) : null}
              <div className="grid grid-cols-3 items-start gap-3">
                {groupDomains.map((domain) => (
                  <TerritoryCircle
                    key={domain.domain}
                    domain={domain}
                    maxPointsForTier={maxPointsByTier[domain.tier] ?? 1}
                    dragging={dragState?.domain === domain.domain}
                    onDragStart={onDragStart}
                    onDragMove={onDragMove}
                    onDragEnd={onDragEnd}
                    settling={settling}
                  />
                ))}
              </div>
            </div>
          ))
        ) : (
          <p className="px-2 text-sm text-[var(--text-muted-warm)] italic">
            Drop a territory here.
          </p>
        )}
      </div>
    </section>
  );
}

function TerritoryCircle({
  domain,
  maxPointsForTier,
  dragging,
  onDragStart,
  onDragMove,
  onDragEnd,
  settling,
}: {
  domain: TerritoryDomain;
  maxPointsForTier: number;
  dragging: boolean;
  onDragStart: (event: ReactPointerEvent, domain: string) => void;
  onDragMove: (event: ReactPointerEvent) => void;
  onDragEnd: (event: ReactPointerEvent) => void;
  settling: boolean;
}) {
  const broadCategory = domain.broadCategory ?? 'General Knowledge';
  const color = getPortraitDomainColor(broadCategory);
  const size = Math.min(
    84,
    Math.max(
      48,
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
      className={`group relative flex w-full touch-none flex-col items-center gap-2 rounded-[1.5rem] p-1 text-center transition duration-300 select-none ${dragging ? 'scale-95 opacity-40' : 'opacity-100'} ${settling ? 'motion-safe:animate-[territory-settle_850ms_ease-out]' : ''}`}
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
        {correctCount > 0 ? (
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
        ) : null}
      </KnowledgeBubble>
      <span
        className="max-w-full px-1 font-serif text-[13px] leading-tight break-words"
        style={{ color: color.text }}
      >
        {domain.domain}
      </span>
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
      className="flex w-full flex-col items-center gap-2 rounded-[1.5rem] p-1 text-center opacity-70 transition hover:opacity-100 disabled:opacity-40"
      style={style}
      disabled={disabled}
      onClick={onAdd}
    >
      <div className="grid size-16 place-items-center rounded-full border border-dashed border-[var(--territory-border)] bg-white/35 text-[var(--territory-text)]">
        <Plus className="size-5" aria-hidden="true" />
      </div>
      <span className="max-w-full px-1 font-serif text-[13px] leading-tight break-words text-[var(--territory-text)]">
        {territory.domain}
      </span>
      <span className="text-[10px] tracking-[0.14em] text-[var(--text-muted-warm)] uppercase">
        Add
      </span>
    </button>
  );
}

function CreateYourOwnCircle({
  disabled,
  onClick,
}: {
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="flex w-full flex-col items-center gap-2 rounded-[1.5rem] p-1 text-center opacity-80 transition hover:opacity-100 disabled:opacity-40"
      disabled={disabled}
      onClick={onClick}
    >
      <div className="grid size-16 place-items-center rounded-full border border-dashed border-[var(--border-warm)] bg-[var(--cream-warm)] text-[var(--ink)]">
        <Plus className="size-5" aria-hidden="true" />
      </div>
      <span className="max-w-full px-1 font-serif text-[13px] leading-tight break-words text-[var(--ink)]">
        Create your own
      </span>
    </button>
  );
}
