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
      ? 'px-2 py-1 text-xs'
      : 'min-h-10 px-3 text-sm';

  return (
    <div>
      <div
        className="inline-grid grid-cols-3 rounded-full border bg-card p-1 font-medium"
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
      {error ? <p className="mt-1 text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
