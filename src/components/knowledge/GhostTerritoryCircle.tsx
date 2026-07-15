'use client';

import type { CSSProperties } from 'react';
import { Plus } from 'lucide-react';

import { getPortraitDomainColor } from '@/components/knowledge/PortraitCircles';
import type { NearbyTerritory } from '@/lib/daily/territory-model';

// A suggested ("nearby") territory the player hasn't adopted yet: a dashed
// category-tinted circle with an Add affordance. Originally the Configure
// page's suggestion cell; shared here so the Knowledge page's "Add a
// territory" block (which replaced Configure) draws the identical invitation.
export function GhostTerritoryCircle({
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
    '--territory-border': `color-mix(in srgb, ${color.primary} 40%, transparent)`,
    '--territory-text': color.text,
  } as CSSProperties;

  return (
    <button
      type="button"
      className="flex w-full flex-col items-center gap-2 rounded-[var(--radius-3xl)] p-1 text-center opacity-70 transition hover:opacity-100 disabled:opacity-40"
      style={style}
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
      <span className="text-[10px] tracking-[0.14em] text-[var(--text-muted-warm)] uppercase">
        Add
      </span>
    </button>
  );
}
