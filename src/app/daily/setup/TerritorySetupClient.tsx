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
import { Plus, Trash2 } from 'lucide-react';

import { KnowledgeBubble } from '@/components/knowledge/KnowledgeBubble';
import { AddTopicField } from '@/components/interests/AddTopicField';
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

type ActiveTerritory = {
  domain: string;
  frequency: TerritoryFrequency;
} | null;

const ZONES: Array<{ value: TerritoryFrequency; title: string; copy: string }> = [
  { value: 'often', title: 'Asked Often', copy: 'These show up most in your rounds.' },
  { value: 'sometimes', title: 'Asked Sometimes', copy: 'These stay in rotation, but less often.' },
  {
    value: 'blue_moon',
    title: 'Once in a Blue Moon',
    copy: 'Still on your map, but only surface every so often.',
  },
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
    blue_moon: null,
    resting: null,
  });
  const quickTargetRefs = useRef<Record<TerritoryFrequency, HTMLButtonElement | null>>({
    often: null,
    sometimes: null,
    blue_moon: null,
    resting: null,
  });
  const newTopicInputRef = useRef<HTMLInputElement | null>(null);
  // Only one territory is active (held) at a time, so a single ref tracks the
  // trash drop-target rendered beside that active circle.
  const removeTargetRef = useRef<HTMLButtonElement | null>(null);
  const dragPointerRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const difficulty = initialDifficulty;
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [domains, setDomains] = useState<TerritoryDomain[]>(initialDomains);
  const [frequencyByDomain, setFrequencyByDomain] =
    useState<DomainPreferenceFrequency>(initialFrequencyByDomain);
  const [addingTopic, setAddingTopic] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [addLimitReached, setAddLimitReached] = useState(false);
  const [dragState, setDragState] = useState<DragState>(null);
  const [activeTerritory, setActiveTerritory] = useState<ActiveTerritory>(null);
  const [hoveredZone, setHoveredZone] = useState<TerritoryFrequency | null>(null);
  const [hoveredQuickTarget, setHoveredQuickTarget] = useState<TerritoryFrequency | null>(null);
  const [hoveredRemoveTarget, setHoveredRemoveTarget] = useState(false);
  // Throwing a territory out is destructive, so it routes through a confirm
  // step: dropping on the trash sets this, and the dialog completes the removal.
  const [pendingRemoval, setPendingRemoval] = useState<string | null>(null);
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
      blue_moon: [],
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

  const draggingDomain = useMemo(
    () => domains.find((domain) => domain.domain === dragState?.domain) ?? null,
    [domains, dragState?.domain],
  );

  const canSave = !submitting && domains.length > 0;

  const persistFrequencyByDomain = useCallback(
    async (nextFrequencyByDomain: DomainPreferenceFrequency) => {
      const preferenceResponse = await fetch('/api/daily/preferences', {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(
          buildSavePayload({ difficulty, frequencyByDomain: nextFrequencyByDomain }),
        ),
      });
      if (!preferenceResponse.ok) {
        const body = await preferenceResponse.json().catch(() => null);
        throw new Error(body?.message ?? 'Could not save your setup.');
      }
    },
    [difficulty],
  );

  const moveDomain = useCallback(
    (domain: string, frequency: TerritoryFrequency) => {
      if ((frequencyByDomain[domain] ?? 'sometimes') === frequency) return;
      const nextFrequencyByDomain = { ...frequencyByDomain, [domain]: frequency };
      setFrequencyByDomain(nextFrequencyByDomain);
      setError(null);
      void persistFrequencyByDomain(nextFrequencyByDomain).catch((caught) => {
        setError(caught instanceof Error ? caught.message : 'Could not save your setup.');
      });
    },
    [frequencyByDomain, persistFrequencyByDomain],
  );

  const handleQuickMove = useCallback(
    (domain: string, frequency: TerritoryFrequency) => {
      moveDomain(domain, frequency);
      setActiveTerritory(null);
      setHoveredQuickTarget(null);
    },
    [moveDomain],
  );

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
        const error = new Error(
          body?.message ?? 'Could not add that topic.',
        ) as Error & { code?: 'limit_reached' | 'too_broad' };
        if (body?.error === 'interest_limit_reached') error.code = 'limit_reached';
        else if (body?.error === 'too_broad') error.code = 'too_broad';
        throw error;
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

  const addNearbyTerritory = useCallback(
    async (territory: NearbyTerritory) => {
      if (addingTopic) return;
      setAddingTopic(true);
      setAddError(null);
      setAddLimitReached(false);
      try {
        await adoptTopic(territory.domain, territory.broadCategory);
      } catch (caught) {
        const coded = caught as Error & { code?: string };
        setAddLimitReached(coded?.code === 'limit_reached');
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

  const quickTargetAtPoint = useCallback((x: number, y: number): TerritoryFrequency | null => {
    for (const zone of ZONES) {
      const element = quickTargetRefs.current[zone.value];
      if (!element) continue;
      const rect = element.getBoundingClientRect();
      if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) return zone.value;
    }
    return null;
  }, []);

  const removeTargetAtPoint = useCallback((x: number, y: number): boolean => {
    const element = removeTargetRef.current;
    if (!element) return false;
    const rect = element.getBoundingClientRect();
    return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
  }, []);

  const removeDomain = useCallback(
    (domain: string) => {
      // Optimistically drop the territory; restore both maps if the exclusion fails.
      const previousDomains = domains;
      const previousFrequency = frequencyByDomain;
      setDomains((existing) => existing.filter((entry) => entry.domain !== domain));
      setFrequencyByDomain((existing) => {
        const { [domain]: _removed, ...rest } = existing;
        return rest;
      });
      setError(null);
      void (async () => {
        try {
          const response = await fetch('/api/users/domain-exclusions', {
            method: 'POST',
            credentials: 'include',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ canonical_subcategory: domain, scope: 'subcategory' }),
          });
          if (!response.ok) {
            const body = await response.json().catch(() => null);
            throw new Error(body?.message ?? 'Could not throw out that territory.');
          }
        } catch (caught) {
          setDomains(previousDomains);
          setFrequencyByDomain(previousFrequency);
          setError(
            caught instanceof Error ? caught.message : 'Could not throw out that territory.',
          );
        }
      })();
    },
    [domains, frequencyByDomain],
  );

  const confirmRemoval = useCallback(() => {
    if (pendingRemoval) removeDomain(pendingRemoval);
    setPendingRemoval(null);
  }, [pendingRemoval, removeDomain]);

  const handleDragStart = useCallback(
    (event: ReactPointerEvent, domain: string, frequency: TerritoryFrequency) => {
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      dragPointerRef.current = { x: event.clientX, y: event.clientY };
      setActiveTerritory({ domain, frequency });
      setDragState({ domain, x: event.clientX, y: event.clientY });
      setHoveredQuickTarget(quickTargetAtPoint(event.clientX, event.clientY));
      setHoveredRemoveTarget(removeTargetAtPoint(event.clientX, event.clientY));
      setHoveredZone(zoneAtPoint(event.clientX, event.clientY));
    },
    [quickTargetAtPoint, removeTargetAtPoint, zoneAtPoint],
  );

  const handleDragMove = useCallback(
    (event: ReactPointerEvent) => {
      if (!dragState) return;
      dragPointerRef.current = { x: event.clientX, y: event.clientY };
      setDragState({ domain: dragState.domain, x: event.clientX, y: event.clientY });
      setHoveredQuickTarget(quickTargetAtPoint(event.clientX, event.clientY));
      setHoveredRemoveTarget(removeTargetAtPoint(event.clientX, event.clientY));
      setHoveredZone(zoneAtPoint(event.clientX, event.clientY));
    },
    [dragState, quickTargetAtPoint, removeTargetAtPoint, zoneAtPoint],
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
      if (removeTargetAtPoint(event.clientX, event.clientY)) {
        // Don't delete inline — open the confirm dialog first.
        setPendingRemoval(dragState.domain);
      } else {
        const nextZone =
          quickTargetAtPoint(event.clientX, event.clientY) ??
          zoneAtPoint(event.clientX, event.clientY);
        if (nextZone) moveDomain(dragState.domain, nextZone);
      }
      setDragState(null);
      setActiveTerritory(null);
      setHoveredZone(null);
      setHoveredQuickTarget(null);
      setHoveredRemoveTarget(false);
    },
    [dragState, moveDomain, quickTargetAtPoint, removeTargetAtPoint, zoneAtPoint],
  );

  const setQuickTargetRef = useCallback(
    (frequency: TerritoryFrequency, element: HTMLButtonElement | null) => {
      quickTargetRefs.current[frequency] = element;
    },
    [],
  );

  const setRemoveTargetRef = useCallback((element: HTMLButtonElement | null) => {
    removeTargetRef.current = element;
  }, []);

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
              activeTerritory={activeTerritory}
              hoveredQuickTarget={hoveredQuickTarget}
              hoveredRemoveTarget={hoveredRemoveTarget}
              onDragStart={handleDragStart}
              onDragMove={handleDragMove}
              onDragEnd={handleDragEnd}
              onQuickMove={handleQuickMove}
              setQuickTargetRef={setQuickTargetRef}
              setRemoveTargetRef={setRemoveTargetRef}
              setRef={(element) => {
                zoneRefs.current[zone.value] = element;
              }}
              settling={settling}
            />
          ))}
        </section>

        <section className="mt-8 rounded-[2rem] border border-[var(--border-warm)] bg-[var(--cream-warm)] p-5">
          <AddTopicField
            heading="Explore something new"
            inputRef={newTopicInputRef}
            existingLabels={domains.map((domain) => domain.domain)}
            convergeBeforeAdd
            disabled={addingTopic}
            limitReachedNode={
              <Link href="/knowledge" className="underline">
                Manage interests
              </Link>
            }
            onAdd={async (topic) => {
              await adoptTopic(topic.label, topic.broadCategory ?? null);
            }}
          />
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

      {dragState && draggingDomain ? (
        <div
          className="pointer-events-none fixed z-[60] -translate-x-1/2 -translate-y-1/2"
          style={{ left: dragState.x, top: dragState.y }}
        >
          <DragPreview domain={draggingDomain} />
        </div>
      ) : null}

      {pendingRemoval ? (
        <div
          className="fixed inset-0 z-[70] grid place-items-center bg-[rgba(26,18,8,0.32)] px-6"
          role="dialog"
          aria-modal="true"
          aria-labelledby="throw-out-title"
          onClick={() => setPendingRemoval(null)}
        >
          <div
            className="w-full max-w-sm rounded-[1.75rem] border border-[var(--border-warm)] bg-[var(--cream)] p-6 shadow-[0_24px_60px_rgba(26,18,8,0.28)]"
            onClick={(event) => event.stopPropagation()}
          >
            <h2
              id="throw-out-title"
              className="font-serif text-2xl font-semibold text-[var(--ink)]"
            >
              Throw out “{pendingRemoval}”?
            </h2>
            <p className="mt-2 text-sm leading-6 text-[var(--text-muted-warm)]">
              This removes the territory from your map, so Joshing won’t ask about it. You can add
              it back later.
            </p>
            <div className="mt-6 flex items-center justify-end gap-3">
              <button
                type="button"
                className="btn-ghost min-h-11 px-5"
                onClick={() => setPendingRemoval(null)}
              >
                Keep it
              </button>
              <button type="button" className="btn-danger px-5" onClick={confirmRemoval}>
                Throw out
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}

function DragPreview({ domain }: { domain: TerritoryDomain }) {
  const broadCategory = domain.broadCategory ?? 'General Knowledge';
  const color = getPortraitDomainColor(broadCategory);

  return (
    <div className="flex max-w-24 flex-col items-center gap-1 text-center drop-shadow-lg">
      <KnowledgeBubble
        diameter={58}
        light={color.light}
        border={`1px solid ${color.primary}55`}
        style={{ boxShadow: '0 12px 28px rgba(26,18,8,0.16)' }}
      >
        {domain.correctAnswerCount > 0 ? (
          <span
            style={{
              color: color.primary,
              fontFamily: 'var(--font-cormorant, Georgia), "Times New Roman", serif',
              fontSize: 18,
              fontWeight: 700,
              lineHeight: 1,
            }}
          >
            {domain.correctAnswerCount}
          </span>
        ) : null}
      </KnowledgeBubble>
      <span
        className="rounded-full bg-[var(--cream)]/95 px-2 py-0.5 font-serif text-[11px] leading-tight shadow-sm"
        style={{ color: color.text }}
      >
        {domain.domain}
      </span>
    </div>
  );
}

function TerritoryZone({
  zone,
  domains,
  maxPointsByTier,
  highlighted,
  dragState,
  activeTerritory,
  hoveredQuickTarget,
  hoveredRemoveTarget,
  onDragStart,
  onDragMove,
  onDragEnd,
  onQuickMove,
  setQuickTargetRef,
  setRemoveTargetRef,
  setRef,
  settling,
}: {
  zone: { value: TerritoryFrequency; title: string; copy: string };
  domains: TerritoryDomain[];
  maxPointsByTier: Record<TerritoryDomain['tier'], number>;
  highlighted: boolean;
  dragState: DragState;
  activeTerritory: ActiveTerritory;
  hoveredQuickTarget: TerritoryFrequency | null;
  hoveredRemoveTarget: boolean;
  onDragStart: (event: ReactPointerEvent, domain: string, frequency: TerritoryFrequency) => void;
  onDragMove: (event: ReactPointerEvent) => void;
  onDragEnd: (event: ReactPointerEvent) => void;
  onQuickMove: (domain: string, frequency: TerritoryFrequency) => void;
  setQuickTargetRef: (frequency: TerritoryFrequency, element: HTMLButtonElement | null) => void;
  setRemoveTargetRef: (element: HTMLButtonElement | null) => void;
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
                    currentFrequency={zone.value}
                    maxPointsForTier={maxPointsByTier[domain.tier] ?? 1}
                    dragging={dragState?.domain === domain.domain}
                    quickTargetsVisible={activeTerritory?.domain === domain.domain}
                    hoveredQuickTarget={hoveredQuickTarget}
                    hoveredRemoveTarget={hoveredRemoveTarget}
                    onDragStart={onDragStart}
                    onDragMove={onDragMove}
                    onDragEnd={onDragEnd}
                    onQuickMove={onQuickMove}
                    setQuickTargetRef={setQuickTargetRef}
                    setRemoveTargetRef={setRemoveTargetRef}
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
  currentFrequency,
  maxPointsForTier,
  dragging,
  quickTargetsVisible,
  hoveredQuickTarget,
  hoveredRemoveTarget,
  onDragStart,
  onDragMove,
  onDragEnd,
  onQuickMove,
  setQuickTargetRef,
  setRemoveTargetRef,
  settling,
}: {
  domain: TerritoryDomain;
  currentFrequency: TerritoryFrequency;
  maxPointsForTier: number;
  dragging: boolean;
  quickTargetsVisible: boolean;
  hoveredQuickTarget: TerritoryFrequency | null;
  hoveredRemoveTarget: boolean;
  onDragStart: (event: ReactPointerEvent, domain: string, frequency: TerritoryFrequency) => void;
  onDragMove: (event: ReactPointerEvent) => void;
  onDragEnd: (event: ReactPointerEvent) => void;
  onQuickMove: (domain: string, frequency: TerritoryFrequency) => void;
  setQuickTargetRef: (frequency: TerritoryFrequency, element: HTMLButtonElement | null) => void;
  setRemoveTargetRef: (element: HTMLButtonElement | null) => void;
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
      className={`group relative flex w-full touch-none flex-col items-center gap-2 rounded-[1.5rem] p-1 text-center transition duration-300 select-none ${dragging ? 'scale-95' : 'opacity-100'} ${settling ? 'motion-safe:animate-[territory-settle_850ms_ease-out]' : ''}`}
      onPointerDown={(event) => onDragStart(event, domain.domain, currentFrequency)}
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
      {quickTargetsVisible ? (
        <button
          ref={setRemoveTargetRef}
          type="button"
          aria-label={`Throw out ${domain.domain}`}
          title="Throw out"
          // Sits beside the bubble (vertically centred on it), not under the
          // quick-move row, so deleting reads as a distinct action.
          className={`absolute right-0 grid size-9 -translate-y-1/2 place-items-center rounded-full border shadow-sm transition ${
            hoveredRemoveTarget
              ? 'scale-110 border-[var(--destructive)] bg-[var(--destructive)] text-white shadow-[0_10px_24px_rgba(180,35,24,0.32)]'
              : 'border-[var(--border-warm)] bg-[var(--cream)] text-[var(--text-muted-warm)]'
          }`}
          style={{ top: size / 2 }}
          onPointerDown={(event) => event.stopPropagation()}
          onPointerMove={(event) => event.stopPropagation()}
          onPointerUp={(event) => event.stopPropagation()}
          onPointerCancel={(event) => event.stopPropagation()}
        >
          <Trash2 className="size-4" aria-hidden="true" />
        </button>
      ) : null}
      {quickTargetsVisible ? (
        <QuickMoveTargets
          domain={domain.domain}
          currentFrequency={currentFrequency}
          hoveredTarget={hoveredQuickTarget}
          onQuickMove={onQuickMove}
          setQuickTargetRef={setQuickTargetRef}
        />
      ) : null}
    </div>
  );
}

function QuickMoveTargets({
  domain,
  currentFrequency,
  hoveredTarget,
  onQuickMove,
  setQuickTargetRef,
}: {
  domain: string;
  currentFrequency: TerritoryFrequency;
  hoveredTarget: TerritoryFrequency | null;
  onQuickMove: (domain: string, frequency: TerritoryFrequency) => void;
  setQuickTargetRef: (frequency: TerritoryFrequency, element: HTMLButtonElement | null) => void;
}) {
  const targets = ZONES.filter((zone) => zone.value !== currentFrequency);

  return (
    <div
      className="mt-1 flex w-[12rem] max-w-[calc(100vw-3rem)] justify-center gap-2"
      onPointerDown={(event) => event.stopPropagation()}
      onPointerMove={(event) => event.stopPropagation()}
      onPointerUp={(event) => event.stopPropagation()}
      onPointerCancel={(event) => event.stopPropagation()}
    >
      {targets.map((target) => (
        <button
          key={target.value}
          ref={(element) => setQuickTargetRef(target.value, element)}
          type="button"
          className={`grid size-14 place-items-center rounded-full border px-1 text-center text-[0.62rem] leading-[0.72rem] font-semibold shadow-sm transition ${
            hoveredTarget === target.value
              ? 'scale-110 border-[var(--ink)] bg-[var(--ink)] text-[var(--cream)] shadow-[0_10px_24px_rgba(26,18,8,0.24)]'
              : 'border-[var(--border-warm)] bg-[var(--cream)] text-[var(--ink)]'
          }`}
          onClick={() => onQuickMove(domain, target.value)}
          title={`Move to ${target.title}`}
        >
          {target.title.replace('Asked ', '').replace('Once in a ', '')}
        </button>
      ))}
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

function CreateYourOwnCircle({ disabled, onClick }: { disabled: boolean; onClick: () => void }) {
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
