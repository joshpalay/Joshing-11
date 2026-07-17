'use client';

import type { CSSProperties } from 'react';
import { Check, Plus } from 'lucide-react';

import { getPortraitDomainColor } from '@/components/knowledge/PortraitCircles';
import type { NearbyTerritory } from '@/lib/daily/territory-model';

// The small caption under the circle — "Add" or "Added". One definition so
// the tiny type size lives in a single literal.
const CAPTION_CLASS = 'text-[10px] tracking-[0.14em] uppercase';

// A suggested ("nearby") territory the player hasn't adopted yet: a dashed
// category-tinted circle with an Add affordance. Originally the Configure
// page's suggestion cell; shared by every "Add a topic" surface, each of
// which pages sets of these through TopicSuggestionCarousel — swiping to
// another page IS the "not interested" gesture, so there's no per-circle
// dismiss here. Once added, the circle flips in place to a solid, checked
// "Added" state rather than being removed, so a page never reflows mid-swipe.
export function GhostTerritoryCircle({
  territory,
  disabled,
  added = false,
  onAdd,
}: {
  territory: NearbyTerritory;
  /** In flight — this add is being persisted. */
  disabled: boolean;
  /** Settled — already added; the circle shows the confirmed state and stops responding to taps. */
  added?: boolean;
  onAdd: () => void;
}) {
  const color = getPortraitDomainColor(territory.broadCategory ?? 'General Knowledge');
  const style = {
    '--territory-border': `color-mix(in srgb, ${color.primary} 40%, transparent)`,
    '--territory-text': color.text,
  } as CSSProperties;
  const busy = disabled && !added;

  return (
    <button
      type="button"
      aria-label={added ? `${territory.domain} — added` : `Add ${territory.domain}`}
      aria-pressed={added}
      className={`flex w-full flex-col items-center gap-2 rounded-[var(--radius-3xl)] p-1 text-center transition ${
        added ? 'opacity-100' : busy ? 'opacity-40' : 'opacity-70 hover:opacity-100'
      }`}
      style={style}
      disabled={disabled || added}
      onClick={onAdd}
    >
      <div
        className={`grid size-16 place-items-center rounded-full border text-[var(--territory-text)] ${
          added ? 'border-solid border-[var(--territory-text)]' : 'border-dashed border-[var(--territory-border)]'
        }`}
        style={{ background: 'color-mix(in srgb, var(--brand-card) 55%, transparent)' }}
      >
        {added ? <Check className="size-5" aria-hidden="true" /> : <Plus className="size-5" aria-hidden="true" />}
      </div>
      <span className="max-w-full px-1 font-serif text-quiet leading-tight break-words text-[var(--territory-text)]">
        {territory.domain}
      </span>
      <span className={`${CAPTION_CLASS} ${added ? 'text-[var(--territory-text)]' : 'text-[var(--text-muted-warm)]'}`}>
        {added ? 'Added' : 'Add'}
      </span>
    </button>
  );
}
