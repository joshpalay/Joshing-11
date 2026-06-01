'use client';

import { useCallback, useEffect, useState } from 'react';

export type TopUpInterest = {
  label: string;
  broadCategory: string | null;
};

type Suggestion = {
  domain: string;
  broadCategory: string;
  rationale: string;
};

type SuggestionsResponse = {
  suggestions?: Suggestion[];
};

type CanonicalizeResponse = {
  suggested?: string;
  broadCategory?: string;
};

// One-time prompt offering invite-seeded users (who sit at exactly three
// declared interests) the chance to top up to five. Reuses the onboarding
// suggestion + canonicalize endpoints; saves via PATCH /api/declared-interests
// with the union of existing + newly chosen areas, then records the dismissal
// so the prompt never reappears.
//
// onDismiss fires when the user skips; onSaved fires after a successful save.
// Both should clear the prompt from the parent (the dismissal is persisted
// server-side either way).
export function TopUpAreasModal({
  existing,
  maxNew,
  onDismiss,
  onSaved,
}: {
  existing: TopUpInterest[];
  maxNew: number;
  onDismiss: () => void;
  onSaved: () => void;
}) {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [loadingSuggestions, setLoadingSuggestions] = useState(true);
  const [selected, setSelected] = useState<TopUpInterest[]>([]);
  const [customInput, setCustomInput] = useState('');
  const [addingCustom, setAddingCustom] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dismissing, setDismissing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const remaining = Math.max(0, maxNew - selected.length);
  const isSelected = useCallback(
    (label: string) => selected.some((item) => item.label.toLowerCase() === label.toLowerCase()),
    [selected],
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch('/api/declared-interests/top-up/suggestions', {
          cache: 'no-store',
          credentials: 'include',
        });
        const body = (await response.json().catch(() => null)) as SuggestionsResponse | null;
        if (!cancelled) setSuggestions(Array.isArray(body?.suggestions) ? body.suggestions : []);
      } catch {
        if (!cancelled) setSuggestions([]);
      } finally {
        if (!cancelled) setLoadingSuggestions(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const toggle = useCallback(
    (interest: TopUpInterest) => {
      setError(null);
      setSelected((current) => {
        const already = current.findIndex(
          (item) => item.label.toLowerCase() === interest.label.toLowerCase(),
        );
        if (already !== -1) {
          return current.filter((_, i) => i !== already);
        }
        if (current.length >= maxNew) return current;
        return [...current, interest];
      });
    },
    [maxNew],
  );

  const addCustom = useCallback(async () => {
    const raw = customInput.trim();
    if (raw.length < 2) return;
    if (selected.length >= maxNew) {
      setError(`You can add ${maxNew} more.`);
      return;
    }
    if (isSelected(raw)) {
      setCustomInput('');
      return;
    }
    setAddingCustom(true);
    setError(null);
    try {
      const response = await fetch('/api/onboarding/canonicalize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ rawInput: raw }),
      });
      const body = (await response.json().catch(() => null)) as CanonicalizeResponse | null;
      const label = body?.suggested?.trim() || raw;
      const broadCategory = body?.broadCategory?.trim() || 'General Knowledge';
      if (!isSelected(label)) {
        setSelected((current) =>
          current.length >= maxNew ? current : [...current, { label, broadCategory }],
        );
      }
      setCustomInput('');
    } catch {
      // Fall back to the raw input if canonicalization fails.
      setSelected((current) =>
        current.length >= maxNew
          ? current
          : [...current, { label: raw, broadCategory: 'General Knowledge' }],
      );
      setCustomInput('');
    } finally {
      setAddingCustom(false);
    }
  }, [customInput, isSelected, maxNew, selected.length]);

  const dismissPrompt = useCallback(async () => {
    try {
      await fetch('/api/declared-interests/top-up/dismiss', {
        method: 'POST',
        credentials: 'include',
      });
    } catch {
      // Non-fatal: the eligibility check will simply offer once more next time.
    }
  }, []);

  const skip = useCallback(async () => {
    if (dismissing || saving) return;
    setDismissing(true);
    await dismissPrompt();
    onDismiss();
  }, [dismissPrompt, dismissing, onDismiss, saving]);

  const save = useCallback(async () => {
    if (selected.length === 0) {
      await skip();
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const interests = [
        ...existing.map((item) => ({ label: item.label, broadCategory: item.broadCategory })),
        ...selected.map((item) => ({ label: item.label, broadCategory: item.broadCategory })),
      ];
      const response = await fetch('/api/declared-interests', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ interests }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { message?: string } | null;
        throw new Error(body?.message ?? 'Could not save your areas.');
      }
      await dismissPrompt();
      onSaved();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save your areas.');
      setSaving(false);
    }
  }, [dismissPrompt, existing, onSaved, selected, skip]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') void skip();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [skip]);

  const busy = saving || dismissing;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="top-up-areas-title"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 60,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '1rem',
        background: 'rgba(0,0,0,0.45)',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) void skip();
      }}
    >
      <div
        style={{
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-lg)',
          padding: '1.5rem',
          maxWidth: '26rem',
          width: '100%',
          maxHeight: '85dvh',
          overflowY: 'auto',
        }}
      >
        <p id="top-up-areas-title" className="font-serif text-lg font-semibold text-[var(--text)]">
          Add two more areas?
        </p>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          You started with three. Pick up to {maxNew} more and we&rsquo;ll weave them into your
          daily questions.
        </p>

        <div className="mt-4">
          {loadingSuggestions ? (
            <p className="text-sm text-[var(--text-muted)]">Finding ideas for you&hellip;</p>
          ) : suggestions.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">
              No suggestions right now — add your own below.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {suggestions.map((suggestion) => {
                const active = isSelected(suggestion.domain);
                const atCap = !active && selected.length >= maxNew;
                return (
                  <li key={suggestion.domain}>
                    <button
                      type="button"
                      disabled={busy || atCap}
                      onClick={() =>
                        toggle({
                          label: suggestion.domain,
                          broadCategory: suggestion.broadCategory,
                        })
                      }
                      className="w-full rounded-[var(--radius-md)] border px-3 py-2 text-left transition-colors disabled:opacity-50"
                      style={{
                        borderColor: active ? 'var(--accent)' : 'var(--border)',
                        background: active
                          ? 'color-mix(in srgb, var(--accent) 12%, transparent)'
                          : 'transparent',
                      }}
                    >
                      <span className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium text-[var(--text)]">
                          {suggestion.domain}
                        </span>
                        <span className="text-[0.65rem] tracking-[0.06em] text-[var(--text-muted)] uppercase">
                          {suggestion.broadCategory}
                        </span>
                      </span>
                      {suggestion.rationale ? (
                        <span className="mt-1 block text-xs text-[var(--text-muted)]">
                          {suggestion.rationale}
                        </span>
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="mt-3 flex gap-2">
          <input
            value={customInput}
            onChange={(event) => setCustomInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                void addCustom();
              }
            }}
            maxLength={100}
            disabled={busy || selected.length >= maxNew}
            placeholder="Or write your own…"
            className="min-h-10 min-w-0 flex-1 rounded-[var(--radius-md)] border bg-[var(--bg)] px-3 text-sm text-[var(--text)] outline-none"
            style={{ borderColor: 'var(--border)' }}
          />
          <button
            type="button"
            className="shrink-0 rounded-[var(--radius-md)] border px-3 py-2 text-sm font-medium text-[var(--text)] transition-colors hover:bg-[var(--surface-raised)] disabled:opacity-50"
            style={{ borderColor: 'var(--border)' }}
            disabled={
              busy || addingCustom || selected.length >= maxNew || customInput.trim().length < 2
            }
            onClick={() => void addCustom()}
          >
            {addingCustom ? '…' : 'Add'}
          </button>
        </div>

        {selected.length > 0 ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {selected.map((item) => (
              <button
                key={item.label}
                type="button"
                disabled={busy}
                onClick={() => toggle(item)}
                className="rounded-full border px-3 py-1 text-xs font-medium text-[var(--text)] transition-colors hover:bg-[var(--surface-raised)]"
                style={{
                  borderColor: 'var(--accent)',
                  background: 'color-mix(in srgb, var(--accent) 12%, transparent)',
                }}
              >
                {item.label} ✕
              </button>
            ))}
          </div>
        ) : null}

        <p className="mt-3 text-xs text-[var(--text-muted)]">
          {remaining > 0 ? `You can add ${remaining} more.` : "That's the max — nicely done."}
        </p>

        {error ? <p className="mt-2 text-sm text-[var(--danger)]">{error}</p> : null}

        <div className="mt-4 flex flex-col gap-2">
          <button
            type="button"
            className="btn-primary w-full"
            disabled={busy || selected.length === 0}
            onClick={() => void save()}
          >
            {saving
              ? '…'
              : `Add ${selected.length || ''} ${selected.length === 1 ? 'area' : 'areas'}`.trim()}
          </button>
          <button
            type="button"
            className="text-sm text-[var(--text-muted)] transition-colors hover:text-[var(--text)]"
            disabled={busy}
            onClick={() => void skip()}
          >
            Maybe later
          </button>
        </div>
      </div>
    </div>
  );
}
