'use client';

import type { CSSProperties } from 'react';
import { Plus, X } from 'lucide-react';

import { getPortraitDomainColor } from '@/components/knowledge/PortraitCircles';
import type { NearbyTerritory } from '@/lib/daily/territory-model';

// The small caption under the circle — "Add" (static) or "Not for me"
// (interactive dismiss). One definition so the tiny type size lives in a single
// literal.
const CAPTION_CLASS = 'text-[10px] tracking-[0.14em] text-[var(--text-muted-warm)] uppercase';

// A suggested ("nearby") territory the player hasn't adopted yet: a dashed
// category-tinted circle with an Add affordance. Originally the Configure
// page's suggestion cell; shared here so the Knowledge page's "Add a topic"
// block draws the identical invitation. When `onDismiss` is supplied, the line
// under the circle becomes a "Not for me" control (in place of the "Add"
// label) that waves this suggestion away so another takes its place — the
// circle itself stays the Add target, so nothing floats over the circle.
export function GhostTerritoryCircle({
  territory,
  disabled,
  onAdd,
  onDismiss,
}: {
  territory: NearbyTerritory;
  disabled: boolean;
  onAdd: () => void;
  onDismiss?: () => void;
}) {
  const color = getPortraitDomainColor(territory.broadCategory ?? 'General Knowledge');
  const style = {
    '--territory-border': `color-mix(in srgb, ${color.primary} 40%, transparent)`,
    '--territory-text': color.text,
  } as CSSProperties;

  return (
    <div className="flex w-full flex-col items-center gap-2 text-center" style={style}>
      <button
        type="button"
        aria-label={`Add ${territory.domain}`}
        className="flex w-full flex-col items-center gap-2 rounded-[var(--radius-3xl)] p-1 opacity-70 transition hover:opacity-100 disabled:opacity-40"
        disabled={disabled}
        onClick={onAdd}
      >
        <div
          className="grid size-16 place-items-center rounded-full border border-dashed border-[var(--territory-border)] text-[var(--territory-text)]"
          style={{ background: 'color-mix(in srgb, var(--brand-card) 55%, transparent)' }}
        >
          <Plus className="size-5" aria-hidden="true" />
        </div>
        <span className="max-w-full px-1 font-serif text-quiet leading-tight break-words text-[var(--territory-text)]">
          {territory.domain}
        </span>
      </button>
      {onDismiss ? (
        <button
          type="button"
          aria-label={`Not interested in ${territory.domain} — show another`}
          title="Not for me — show another"
          className="grid size-7 place-items-center rounded-full text-[var(--text-muted-warm)] transition hover:bg-[var(--cream-warm)] hover:text-[var(--ink)] disabled:opacity-40"
          disabled={disabled}
          onClick={onDismiss}
        >
          <X className="size-4" aria-hidden="true" />
        </button>
      ) : (
        <span className={CAPTION_CLASS}>Add</span>
      )}
    </div>
  );
}
