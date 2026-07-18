'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';

import { EditorialCarousel } from '@/components/feed/EditorialCarousel';
import { GhostTerritoryCircle } from '@/components/knowledge/GhostTerritoryCircle';
import { domainKey } from '@/lib/knowledge/domain-key';
import {
  pickRotatedSuggestions,
  readRecentlyShownSuggestions,
  rememberShownSuggestions,
} from '@/lib/knowledge/suggestion-rotation';
import type { NearbyTerritory } from '@/lib/daily/territory-model';

const PAGE_SIZE = 3;
// Visible cap per visit. Lower than the full candidate pool for most maps
// (the pool is direct unheld siblings of what you own, plus a handful of
// adjacency rules — often modest), so there's usually room for
// pickRotatedSuggestions to swap in genuinely different topics each visit
// instead of just reordering the same ones.
const MAX_SUGGESTIONS = 9;

function chunk<T>(items: readonly T[], size: number): T[][] {
  const pages: T[][] = [];
  for (let i = 0; i < items.length; i += size) pages.push(items.slice(i, i + size));
  return pages;
}

/**
 * The "Add a topic" suggestions, paginated three-at-a-time behind a swipeable
 * carousel — built on the shared EditorialCarousel scroll-snap primitive
 * (same one the feed's artwork slides use), so paging shares its dot
 * indicator, reduced-motion handling, and touch/scroll behavior. Swiping to
 * another page IS the "not interested" gesture, replacing a per-circle
 * dismiss control. Adding a topic flips its circle in place to a checkmark +
 * "Added" state (GhostTerritoryCircle's `added`) rather than removing it, so
 * a page never reflows mid-swipe.
 *
 * `addedKeys` is caller-owned (not internal state): the parent also needs it
 * to flip a circle back when the player taps "Undo" on the confirmation
 * banner, so the single source of truth for "is this domain added" lives
 * wherever the undo/remove call does.
 *
 * The caller re-shuffles `suggestions` once per visit, but for a modest map
 * that alone doesn't help — if the whole candidate pool fits under
 * MAX_SUGGESTIONS, a reshuffle just reorders the exact same set. Genuine
 * per-visit variety comes from pickRotatedSuggestions (see
 * suggestion-rotation.ts), which remembers what was shown last time and
 * prefers fresh candidates.
 */
export function TopicSuggestionCarousel({
  suggestions,
  addedKeys,
  onAdd,
  trailingSlide,
}: {
  suggestions: NearbyTerritory[];
  /** Domain keys (domainKey-normalized) already added — rendered as the checked "Added" state. */
  addedKeys: ReadonlySet<string>;
  /** Persist the add; resolve true on success so the caller can add the key to `addedKeys`. */
  onAdd: (territory: NearbyTerritory) => Promise<boolean>;
  /**
   * An extra page appended after the suggestion pages — e.g. an "Add your
   * own" CTA on a surface with no other create-your-own affordance visible.
   * Rendered centered in the same three-column footprint as a suggestion
   * page so the carousel doesn't jump in height on the last swipe.
   */
  trailingSlide?: ReactNode;
}) {
  // Purely transient UI state — which circle is mid-request. Not part of the
  // caller's `addedKeys` truth.
  const [addingKey, setAddingKey] = useState<string | null>(null);

  // The rotated, capped subset actually shown this visit. The pick itself is
  // pure (a plain useMemo, reading the previous "recently shown" snapshot);
  // persisting the new snapshot is the actual side effect, fired from an
  // effect that only writes — never calls setState — so it can't cascade
  // renders. Runs once per fresh `suggestions` array (i.e. once per pool
  // fetch/shuffle), not on every re-render.
  const visible = useMemo(
    () =>
      suggestions.length > 0
        ? pickRotatedSuggestions(suggestions, MAX_SUGGESTIONS, readRecentlyShownSuggestions())
        : [],
    [suggestions],
  );
  useEffect(() => {
    if (visible.length > 0) rememberShownSuggestions(visible.map((territory) => domainKey(territory.domain)));
  }, [visible]);

  const pages = useMemo(() => chunk(visible, PAGE_SIZE), [visible]);

  const handleAdd = async (territory: NearbyTerritory) => {
    if (addingKey) return;
    const key = domainKey(territory.domain);
    setAddingKey(key);
    try {
      await onAdd(territory);
    } finally {
      setAddingKey(null);
    }
  };

  const slides: ReactNode[] = pages.map((page, pageIndex) => (
    <div key={`page-${pageIndex}`} className="grid w-full grid-cols-3 gap-3">
      {page.map((territory) => {
        const key = domainKey(territory.domain);
        return (
          <GhostTerritoryCircle
            key={territory.domain}
            territory={territory}
            added={addedKeys.has(key)}
            disabled={addingKey === key}
            onAdd={() => void handleAdd(territory)}
          />
        );
      })}
    </div>
  ));
  if (trailingSlide) {
    slides.push(
      <div key="trailing" className="grid w-full grid-cols-3 gap-3">
        <div className="col-start-2">{trailingSlide}</div>
      </div>,
    );
  }

  if (slides.length === 0) return null;

  return <EditorialCarousel ariaLabel="Suggested topics" slides={slides} />;
}
