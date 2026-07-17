'use client';

import { useMemo, useState, type ReactNode } from 'react';

import { EditorialCarousel } from '@/components/feed/EditorialCarousel';
import { GhostTerritoryCircle } from '@/components/knowledge/GhostTerritoryCircle';
import { domainKey } from '@/lib/knowledge/domain-key';
import type { NearbyTerritory } from '@/lib/daily/territory-model';

const PAGE_SIZE = 3;
// Defensive cap so a very large tree doesn't turn this into an endless swipe.
const MAX_SUGGESTIONS = 15;

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
 */
export function TopicSuggestionCarousel({
  suggestions,
  onAdd,
  trailingSlide,
}: {
  suggestions: NearbyTerritory[];
  /** Persist the add; resolve true on success so the circle can flip to added. */
  onAdd: (territory: NearbyTerritory) => Promise<boolean>;
  /**
   * An extra page appended after the suggestion pages — e.g. an "Add your
   * own" CTA on a surface with no other create-your-own affordance visible.
   * Rendered centered in the same three-column footprint as a suggestion
   * page so the carousel doesn't jump in height on the last swipe.
   */
  trailingSlide?: ReactNode;
}) {
  const [addedKeys, setAddedKeys] = useState<ReadonlySet<string>>(new Set());
  const [addingKey, setAddingKey] = useState<string | null>(null);

  const pages = useMemo(
    () => chunk(suggestions.slice(0, MAX_SUGGESTIONS), PAGE_SIZE),
    [suggestions],
  );

  const handleAdd = async (territory: NearbyTerritory) => {
    if (addingKey) return;
    const key = domainKey(territory.domain);
    setAddingKey(key);
    try {
      const ok = await onAdd(territory);
      if (ok) setAddedKeys((prev) => new Set(prev).add(key));
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
