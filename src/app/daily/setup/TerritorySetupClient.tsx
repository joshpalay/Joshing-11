'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import Link from 'next/link';
import { Plus, Trash2, X } from 'lucide-react';

import { FrequencyMark } from '@/components/knowledge/FrequencyMark';
import { KnowledgeBubble } from '@/components/knowledge/KnowledgeBubble';
import { AddTopicField } from '@/components/interests/AddTopicField';
import { getPortraitDomainColor } from '@/components/knowledge/PortraitCircles';
import { GhostTerritoryCircle } from '@/components/knowledge/GhostTerritoryCircle';
import { normalizeBroadCategory } from '@/lib/knowledge/broad-category';
import { getPortraitCircleSize, type CircleSizingTier } from '@/lib/knowledge/circle-sizing';
import {
  buildSavePayload,
  getNearbyTerritories,
  TERRITORY_FREQUENCIES,
  TERRITORY_FREQUENCY_COPY,
  TERRITORY_FREQUENCY_LABEL,
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

// Derived from the shared frequency label/copy maps so this surface and the
// knowledge peaks detail sheet never drift. Order follows TERRITORY_FREQUENCIES
// (often → sometimes → blue_moon → resting), which is the zone stack order.
const ZONES: Array<{ value: TerritoryFrequency; title: string; copy: string }> =
  TERRITORY_FREQUENCIES.map((value) => ({
    value,
    title: TERRITORY_FREQUENCY_LABEL[value],
    copy: TERRITORY_FREQUENCY_COPY[value],
  }));

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
}: {
  initialDomains: TerritoryDomain[];
  initialDifficulty: Difficulty;
  initialFrequencyByDomain: DomainPreferenceFrequency;
}) {
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
  const [error, setError] = useState<string | null>(null);
  const [domains, setDomains] = useState<TerritoryDomain[]>(initialDomains);
  const [frequencyByDomain, setFrequencyByDomain] =
    useState<DomainPreferenceFrequency>(initialFrequencyByDomain);
  const [addingTopic, setAddingTopic] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [addLimitReached, setAddLimitReached] = useState(false);
  // "Create your own" lives at the top of the Add-a-Territory box and toggles
  // open into an inline topic field on tap.
  const [creating, setCreating] = useState(false);
  // Lightweight confirmation toast shown when a territory is added, with an
  // optional one-tap undo that removes the territory it just announced.
  const [toast, setToast] = useState<{ message: string; undoDomain?: string } | null>(null);
  // Suggestions rotate so the box doesn't feel stale on repeat visits — see
  // visibleNearbyTerritories below.
  const [suggestionOffset, setSuggestionOffset] = useState(0);
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

  // Pick a random starting point for the suggestion rotation on each visit so
  // the same few territories don't sit there stale. Deferred a frame so it runs
  // client-side only (no hydration mismatch) and outside the synchronous effect body.
  useEffect(() => {
    const frame = window.requestAnimationFrame(() =>
      setSuggestionOffset(Math.floor(Math.random() * 1000)),
    );
    return () => window.cancelAnimationFrame(frame);
  }, []);

  // Auto-dismiss the confirmation toast. Linger a little longer so the undo
  // affordance is reachable.
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 4500);
    return () => window.clearTimeout(timer);
  }, [toast]);

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

  // Show a rotating window of suggestions rather than always the same top few,
  // so the box stays fresh between visits. With three or fewer we just show them.
  const visibleNearbyTerritories = useMemo(() => {
    const SHOWN = 3;
    if (nearbyTerritories.length <= SHOWN) return nearbyTerritories;
    const start = suggestionOffset % nearbyTerritories.length;
    const rotated = [...nearbyTerritories.slice(start), ...nearbyTerritories.slice(0, start)];
    return rotated.slice(0, SHOWN);
  }, [nearbyTerritories, suggestionOffset]);

  const draggingDomain = useMemo(
    () => domains.find((domain) => domain.domain === dragState?.domain) ?? null,
    [domains, dragState?.domain],
  );

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

  const handleRemoveRequest = useCallback((domain: string) => {
    // Tapping the throw-out target opens the same confirm dialog as dragging
    // onto it, so deletion always goes through one explicit confirmation.
    setPendingRemoval(domain);
    setActiveTerritory(null);
    setHoveredRemoveTarget(false);
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
        const error = new Error(body?.message ?? 'Could not add that topic.') as Error & {
          code?: 'limit_reached' | 'too_broad';
        };
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

  const openCreateTopic = useCallback(() => {
    setCreating(true);
    setAddError(null);
    setAddLimitReached(false);
    // The field mounts on the next paint, so focus after it exists.
    window.requestAnimationFrame(() => {
      newTopicInputRef.current?.focus({ preventScroll: true });
    });
  }, []);

  const addNearbyTerritory = useCallback(
    async (territory: NearbyTerritory) => {
      if (addingTopic) return;
      setAddingTopic(true);
      setAddError(null);
      setAddLimitReached(false);
      try {
        const row = await adoptTopic(territory.domain, territory.broadCategory);
        setToast({ message: `Added “${row.domain}”`, undoDomain: row.domain });
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

  return (
    <main className="min-h-dvh bg-[var(--cream)] px-4 py-8 pb-16 text-[var(--ink)]">
      <div className="mx-auto max-w-3xl">
        <header className="mb-8 flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold tracking-[0.2em] text-[var(--text-muted-warm)] uppercase">
              TODAY’S FIVE
            </p>
            <h1 className="mt-3 font-serif text-5xl leading-[0.95] font-semibold text-[var(--ink)]">
              Shape your next round
            </h1>
            <p className="mt-4 max-w-lg text-base leading-7 text-[var(--text-muted-warm)]">
              Move territories around to decide what Joshing should ask you about next.
            </p>
          </div>
          <Link
            href="/"
            aria-label="Done — changes are saved automatically"
            className="grid size-10 shrink-0 place-items-center rounded-full border border-[var(--border-warm)] bg-white/40 text-[var(--ink)] transition hover:bg-white/70"
          >
            <X className="size-5" aria-hidden="true" />
          </Link>
        </header>

        {domains.length === 0 ? (
          <section className="mb-6 rounded-[var(--radius-4xl)] border border-dashed border-[var(--border-warm)] bg-white/35 p-6 text-center">
            <h2 className="font-serif text-2xl font-semibold text-[var(--ink)]">
              Your map is ready for its first territory.
            </h2>
            <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-[var(--text-muted-warm)]">
              Add something you’d be delighted to be asked about, and Joshing will start shaping
              around it.
            </p>
          </section>
        ) : null}

        <section className="mb-10">
          <div className="mb-4 border-b border-[var(--border-light)] pb-3">
            <h2 className="font-serif text-2xl font-semibold text-[var(--ink)]">Add a Territory</h2>
            <p className="mt-1 text-sm leading-6 text-[var(--text-muted-warm)]">
              {nearbyTerritories.length > 0
                ? 'Suggestions based on the shape of your map — or create your own.'
                : 'Create your own, and more suggestions will appear as your map grows.'}
            </p>
          </div>
          {creating ? (
            <div className="mb-5 rounded-[var(--radius-3xl)] border border-[var(--border-warm)] bg-[var(--cream-warm)] p-4">
              <AddTopicField
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
                  const row = await adoptTopic(topic.label, topic.broadCategory ?? null);
                  setToast({ message: `Added “${row.domain}”`, undoDomain: row.domain });
                }}
              />
              <button
                type="button"
                className="mt-3 text-sm text-[var(--text-muted-warm)] underline-offset-2 hover:underline"
                onClick={() => setCreating(false)}
              >
                Done
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="btn-primary mb-5 flex w-full items-center justify-center gap-2"
              disabled={addingTopic}
              onClick={openCreateTopic}
            >
              <Plus className="size-5" aria-hidden="true" />
              Create your own
            </button>
          )}
          {visibleNearbyTerritories.length > 0 ? (
            <div className="grid grid-cols-3 gap-3">
              {visibleNearbyTerritories.map((territory) => (
                <GhostTerritoryCircle
                  key={territory.domain}
                  territory={territory}
                  disabled={addingTopic}
                  onAdd={() => void addNearbyTerritory(territory)}
                />
              ))}
            </div>
          ) : null}
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
              onRemove={handleRemoveRequest}
              setQuickTargetRef={setQuickTargetRef}
              setRemoveTargetRef={setRemoveTargetRef}
              setRef={(element) => {
                zoneRefs.current[zone.value] = element;
              }}
              settling={settling}
            />
          ))}
        </section>

        {error ? (
          <p className="border-destructive/40 text-destructive mt-6 rounded-2xl border bg-white/50 p-4 text-sm">
            {error}
          </p>
        ) : null}
      </div>

      {dragState && draggingDomain ? (
        <div
          className="pointer-events-none fixed z-[var(--z-modal)] -translate-x-1/2 -translate-y-1/2"
          style={{ left: dragState.x, top: dragState.y }}
        >
          <DragPreview domain={draggingDomain} />
        </div>
      ) : null}

      {toast ? (
        <div className="fixed bottom-24 left-1/2 z-[var(--z-toast)] -translate-x-1/2">
          <div
            role="status"
            aria-live="polite"
            className="flex items-center gap-3 rounded-full bg-[var(--ink)] py-2.5 pr-2.5 pl-5 text-sm font-medium text-[var(--cream)] shadow-[0_12px_28px_rgba(26,18,8,0.28)] motion-safe:animate-[territory-settle_300ms_ease-out]"
          >
            <span>{toast.message}</span>
            {toast.undoDomain ? (
              <button
                type="button"
                className="rounded-full bg-[var(--cream)]/15 px-3 py-1 text-xs font-semibold tracking-[0.08em] text-[var(--cream)] uppercase transition hover:bg-[var(--cream)]/25"
                onClick={() => {
                  if (toast.undoDomain) removeDomain(toast.undoDomain);
                  setToast(null);
                }}
              >
                Undo
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {pendingRemoval ? (
        <div
          className="fixed inset-0 z-[var(--z-modal)] grid place-items-center bg-[var(--scrim)] px-6"
          role="dialog"
          aria-modal="true"
          aria-labelledby="throw-out-title"
          onClick={() => setPendingRemoval(null)}
        >
          <div
            className="w-full max-w-sm rounded-[var(--radius-4xl)] border border-[var(--border-warm)] bg-[var(--cream)] p-6 shadow-[0_24px_60px_rgba(26,18,8,0.28)]"
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
                className="btn-ghost"
                onClick={() => setPendingRemoval(null)}
              >
                Keep it
              </button>
              <button type="button" className="btn-danger" onClick={confirmRemoval}>
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
        tint={color.primary}
        border={`1px solid color-mix(in srgb, ${color.primary} 33%, transparent)`}
        style={{ boxShadow: 'var(--shadow-overlay)' }}
      >
        {domain.correctAnswerCount > 0 ? (
          <span
            style={{
              color: color.primary,
              fontFamily: 'var(--font-serif)',
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
  onRemove,
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
  onRemove: (domain: string) => void;
  setQuickTargetRef: (frequency: TerritoryFrequency, element: HTMLButtonElement | null) => void;
  setRemoveTargetRef: (element: HTMLButtonElement | null) => void;
  setRef: (element: HTMLElement | null) => void;
  settling: boolean;
}) {
  const categoryGroups = useMemo(() => groupByCategory(domains), [domains]);

  return (
    <section ref={setRef} className="transition">
      <div className="mb-4 border-b border-[var(--border-light)] pb-3">
        <h2 className="flex items-center gap-2 font-serif text-2xl font-semibold text-[var(--ink)]">
          {zone.title}
          <FrequencyMark frequency={zone.value} color="var(--brand-ink-400)" size={18} decorative />
        </h2>
        <p className="mt-1 text-sm leading-6 text-[var(--text-muted-warm)]">{zone.copy}</p>
      </div>
      <div
        className={`min-h-28 space-y-4 rounded-[var(--radius-3xl)] border border-dashed p-3 transition ${highlighted ? 'border-[var(--ink)] bg-[var(--cream)]/70 shadow-[var(--shadow-overlay)]' : 'border-[var(--border-light)] bg-[var(--cream)]/50'}`}
      >
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
                    onRemove={onRemove}
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
  onRemove,
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
  onRemove: (domain: string) => void;
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
      className={`group relative flex w-full touch-none flex-col items-center gap-2 rounded-[var(--radius-3xl)] p-1 text-center transition duration-300 select-none ${dragging ? 'scale-95' : 'opacity-100'} ${settling ? 'motion-safe:animate-[territory-settle_850ms_ease-out]' : ''}`}
      onPointerDown={(event) => onDragStart(event, domain.domain, currentFrequency)}
      onPointerMove={onDragMove}
      onPointerUp={onDragEnd}
      onPointerCancel={onDragEnd}
    >
      <KnowledgeBubble
        diameter={size}
        tint={color.primary}
        border={`1px solid color-mix(in srgb, ${color.primary} 27%, transparent)`}
        style={{ boxShadow: 'var(--shadow-card-strong)' }}
      >
        {correctCount > 0 ? (
          <span
            style={{
              fontSize: countFontSize,
              color: color.primary,
              fontFamily: 'var(--font-serif)',
              fontWeight: 700,
              lineHeight: 1,
            }}
          >
            {correctCount}
          </span>
        ) : null}
      </KnowledgeBubble>
      <span
        className="max-w-full px-1 font-serif text-quiet leading-tight break-words"
        style={{ color: color.text }}
      >
        {domain.domain}
      </span>
      {quickTargetsVisible ? (
        <QuickMoveTargets
          domain={domain.domain}
          currentFrequency={currentFrequency}
          hoveredTarget={hoveredQuickTarget}
          hoveredRemoveTarget={hoveredRemoveTarget}
          onQuickMove={onQuickMove}
          onRemove={onRemove}
          setQuickTargetRef={setQuickTargetRef}
          setRemoveTargetRef={setRemoveTargetRef}
        />
      ) : null}
    </div>
  );
}

function QuickMoveTargets({
  domain,
  currentFrequency,
  hoveredTarget,
  hoveredRemoveTarget,
  onQuickMove,
  onRemove,
  setQuickTargetRef,
  setRemoveTargetRef,
}: {
  domain: string;
  currentFrequency: TerritoryFrequency;
  hoveredTarget: TerritoryFrequency | null;
  hoveredRemoveTarget: boolean;
  onQuickMove: (domain: string, frequency: TerritoryFrequency) => void;
  onRemove: (domain: string) => void;
  setQuickTargetRef: (frequency: TerritoryFrequency, element: HTMLButtonElement | null) => void;
  setRemoveTargetRef: (element: HTMLButtonElement | null) => void;
}) {
  const targets = ZONES.filter((zone) => zone.value !== currentFrequency);

  return (
    <div
      className="mt-1 flex max-w-[calc(100vw-3rem)] flex-wrap justify-center gap-2"
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
          className={`grid size-14 place-items-center rounded-full border px-0.5 text-center text-[0.62rem] leading-[0.72rem] font-semibold break-words hyphens-auto shadow-sm transition ${
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
      {/* Throw-out sits at the end of the quick-move row so deleting reads as
          a sibling action of the frequency moves, kept clear of the bubble. */}
      <button
        ref={setRemoveTargetRef}
        type="button"
        aria-label={`Throw out ${domain}`}
        title="Throw out"
        className={`grid size-14 place-items-center rounded-full border shadow-sm transition ${
          hoveredRemoveTarget
            ? 'scale-110 border-[var(--destructive)] bg-[var(--destructive)] text-white shadow-[0_10px_24px_rgba(180,35,24,0.32)]'
            : 'border-[var(--border-warm)] bg-[var(--cream)] text-[var(--text-muted-warm)]'
        }`}
        onClick={() => onRemove(domain)}
      >
        <Trash2 className="size-5" aria-hidden="true" />
      </button>
    </div>
  );
}
