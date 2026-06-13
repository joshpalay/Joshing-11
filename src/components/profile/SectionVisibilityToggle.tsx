'use client';

import { useState } from 'react';

import type {
  ProfileSection,
  SectionVisibility,
} from '@/server/profile/visibility';

const OPTIONS: SectionVisibility[] = ['private', 'friends', 'public'];

type Props = {
  section: ProfileSection;
  // Human-readable label used for the aria-label so screen readers know
  // which section's visibility is being changed.
  label: string;
  initialVisibility: SectionVisibility;
  // Optional hook for parents that want to react to the saved value
  // (e.g. re-render the section as gated by the new tier).
  onSaved?: (next: SectionVisibility) => void;
  // Compact mode renders as a tight pill row; default is a full-width
  // 3-column grid. Use compact when the toggle sits next to a section
  // header or inline with a field.
  size?: 'default' | 'compact';
  // Stretches the pill to fill its container with three equal columns
  // instead of sizing to content. Useful when the toggle is stacked
  // below a label rather than placed inline beside it.
  fullWidth?: boolean;
  // Optional per-scope helper micro-copy. When provided, the line for the
  // currently-selected scope renders under the pill row so the player can see
  // what each choice exposes. Tracks the optimistic local state, so it updates
  // the instant a scope is tapped.
  help?: Record<SectionVisibility, string>;
};

// Generalization of DomainVisibilityToggle (which is per-knowledge-domain).
// This one writes to PATCH /api/account/visibility, which upserts a row in
// PROFILE_SECTION_VISIBILITY for the given section. Optimistic — we flip
// the local state first, then revert on failure so the toggle doesn't
// feel laggy.
export function SectionVisibilityToggle({
  section,
  label,
  initialVisibility,
  onSaved,
  size = 'default',
  fullWidth = false,
  help,
}: Props) {
  const [visibility, setVisibility] = useState<SectionVisibility>(initialVisibility);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setNext = async (next: SectionVisibility) => {
    if (isSaving || next === visibility) return;
    const previous = visibility;
    setVisibility(next);
    setError(null);
    setIsSaving(true);
    try {
      const res = await fetch('/api/account/visibility', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ section, visibility: next }),
      });
      if (!res.ok) throw new Error('Could not update visibility');
      onSaved?.(next);
    } catch {
      setVisibility(previous);
      setError('Could not save that visibility.');
    } finally {
      setIsSaving(false);
    }
  };

  const baseBtn =
    size === 'compact'
      ? 'min-h-9 px-3 py-1.5 text-xs'
      : 'min-h-10 px-3 text-sm';

  const wrapperLayout = fullWidth
    ? 'grid w-full grid-cols-3'
    : 'inline-grid grid-cols-3';

  return (
    <div>
      <div
        className={`${wrapperLayout} rounded-full border bg-card p-1 font-medium`}
        aria-label={`Visibility for ${label}`}
      >
        {OPTIONS.map((option) => (
          <button
            key={option}
            type="button"
            className={`${baseBtn} rounded-full capitalize transition ${
              visibility === option
                ? 'bg-foreground text-background'
                : 'text-muted-foreground hover:text-foreground'
            }`}
            onClick={() => void setNext(option)}
            disabled={isSaving}
            aria-pressed={visibility === option}
          >
            {option}
          </button>
        ))}
      </div>
      {help ? <p className="mt-1.5 text-xs text-muted-foreground">{help[visibility]}</p> : null}
      {error ? <p className="mt-1 text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
