'use client';

import { useState } from 'react';

export type DomainVisibility = 'private' | 'friends' | 'public';

type Props = {
  domainName: string;
  initialVisibility: DomainVisibility;
  onChange?: (visibility: DomainVisibility) => Promise<void> | void;
};

const OPTIONS: DomainVisibility[] = ['private', 'friends', 'public'];

export function DomainVisibilityToggle({ domainName, initialVisibility, onChange }: Props) {
  const [visibility, setVisibility] = useState<DomainVisibility>(initialVisibility);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setNextVisibility = async (next: DomainVisibility) => {
    if (isSaving || next === visibility) return;
    const previous = visibility;
    setVisibility(next);
    setError(null);
    setIsSaving(true);

    try {
      if (onChange) {
        await onChange(next);
      } else {
        const res = await fetch(`/api/knowledge/${encodeURIComponent(domainName)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ visibility: next }),
        });

        if (!res.ok) throw new Error('Could not update visibility');
      }
    } catch {
      setVisibility(previous);
      setError('Could not save that visibility setting.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div>
      <div
        className="bg-card grid grid-cols-3 rounded-full border p-1 text-sm font-medium"
        aria-label={`Visibility for ${domainName}`}
      >
        {OPTIONS.map((option) => (
          <button
            key={option}
            type="button"
            className={`min-h-10 rounded-full px-3 capitalize transition ${
              visibility === option
                ? 'bg-foreground text-background'
                : 'text-muted-foreground hover:text-foreground'
            }`}
            onClick={() => void setNextVisibility(option)}
            disabled={isSaving}
            aria-pressed={visibility === option}
          >
            {option}
          </button>
        ))}
      </div>
      {error ? <p className="text-destructive mt-2 text-sm">{error}</p> : null}
    </div>
  );
}
