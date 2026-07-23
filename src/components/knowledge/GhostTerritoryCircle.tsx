'use client';

import type { CSSProperties } from 'react';
import { Check, Plus } from 'lucide-react';

import { getPortraitDomainColor } from '@/components/knowledge/PortraitCircles';
import type { NearbyTerritory } from '@/lib/daily/territory-model';

// The small "Added" caption shown once a circle is settled — the plus icon
// and dashed circle already read as "tap to add" on their own, so there's no
// caption for the resting state.
const CAPTION_CLASS = 'type-eyebrow tracking-eyebrow uppercase';

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
  // The "not added" state now borrows the same visual weight as "added"
  // (solid territory-text caption, near-full opacity) rather than a separate,
  // washed-out treatment — only the border stays dashed vs. solid, since
  // that's the one distinction that actually needs to read at a glance.
  // Bumped from a 40% color mix to 65% so the dashed border itself doesn't
  // disappear against the card.
  const style = {
    '--territory-border': `color-mix(in srgb, ${color.primary} 65%, transparent)`,
    '--territory-text': color.text,
  } as CSSProperties;
  const busy = disabled && !added;

  return (
    <button
      type="button"
      aria-label={added ? `${territory.domain} — added` : `Add ${territory.domain}`}
      aria-pressed={added}
      className={`flex w-full flex-col items-center gap-2 rounded-[var(--radius-3xl)] p-1 text-center transition ${
        busy ? 'opacity-40' : 'opacity-100'
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
        {added ? (
          <Check className="size-7" aria-hidden="true" />
        ) : (
          // Forest green (--game-correct) — the same "Play Missed Questions"
          // accent, not the category tint, so the tap target itself pops
          // rather than blending into the dashed outline.
          <Plus className="size-7 text-[var(--game-correct)]" aria-hidden="true" />
        )}
      </div>
      <span className="max-w-full px-1 font-serif text-quiet leading-tight break-words text-[var(--territory-text)]">
        {territory.domain}
      </span>
      {added ? <span className={`${CAPTION_CLASS} text-[var(--territory-text)]`}>Added</span> : null}
    </button>
  );
}
