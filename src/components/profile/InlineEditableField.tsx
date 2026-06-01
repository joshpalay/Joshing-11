'use client';

import { Check, Loader2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

// Generic in-place text editor for the unified profile header card.
// Migration 0054 narrowed the surface to just displayName — bio, tagline,
// and location were removed. The component keeps its general shape so
// future single-field editors can plug in by extending the Field union.
//
// Behavior:
//   - Click the rendered value to start editing.
//   - Single-line fields commit on blur OR Enter.
//   - Multi-line fields commit on Cmd/Ctrl+Enter (Enter alone inserts a
//     newline as expected); blur also commits.
//   - Escape cancels and restores the previous value.
//   - PATCH goes to a single endpoint; the field key is sent as the body
//     key. Required fields can't be saved empty.

type Field = 'displayName';

type Props = {
  field: Field;
  label: string;
  placeholder: string;
  initialValue: string;
  maxLength: number;
  required?: boolean;
  multiline?: boolean;
  endpoint?: string;
  // What surrounds the saved value when not editing. Default is plain
  // text inside the click-target. Use this to add a "@" prefix for the
  // handle, italics for the tagline, etc.
  renderDisplay?: (value: string) => React.ReactNode;
  // Visual variant — 'plain' renders an unstyled tap target that blends
  // with the surrounding card (used in the profile header). 'card'
  // renders a bordered card with a label header (used in dedicated
  // edit pages).
  variant?: 'plain' | 'card';
  onSaved?: (next: string | null) => void;
};

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export function InlineEditableField({
  field,
  label,
  placeholder,
  initialValue,
  maxLength,
  required = false,
  multiline = false,
  endpoint = '/api/account/profile',
  renderDisplay,
  variant = 'plain',
  onSaved,
}: Props) {
  const [value, setValue] = useState(initialValue);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(initialValue);
  const [status, setStatus] = useState<SaveStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const savedFlashTimer = useRef<number | null>(null);
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      if ('setSelectionRange' in inputRef.current) {
        const length = inputRef.current.value.length;
        inputRef.current.setSelectionRange(length, length);
      }
    }
  }, [editing]);

  useEffect(
    () => () => {
      if (savedFlashTimer.current) window.clearTimeout(savedFlashTimer.current);
    },
    [],
  );

  const beginEdit = () => {
    setError(null);
    setDraft(value);
    setEditing(true);
  };

  const commit = useCallback(async () => {
    const trimmed = draft.trim();
    if (trimmed === value.trim()) {
      setEditing(false);
      return;
    }
    if (required && trimmed.length === 0) {
      setError(`${label} can’t be empty.`);
      return;
    }
    if (trimmed.length > maxLength) {
      setError(`Maximum ${maxLength} characters.`);
      return;
    }

    setStatus('saving');
    setError(null);
    try {
      const payload: Record<string, string | null> = {};
      payload[field] = trimmed.length === 0 ? null : trimmed;

      const response = await fetch(endpoint, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload),
      });
      const body = (await response.json().catch(() => null)) as {
        ok?: boolean;
        message?: string;
      } | null;
      if (!response.ok || !body?.ok) {
        throw new Error(body?.message ?? 'Could not save.');
      }
      const next = trimmed.length === 0 ? '' : trimmed;
      setValue(next);
      onSaved?.(trimmed.length === 0 ? null : trimmed);
      setStatus('saved');
      setEditing(false);
      if (savedFlashTimer.current) window.clearTimeout(savedFlashTimer.current);
      savedFlashTimer.current = window.setTimeout(() => setStatus('idle'), 1500);
    } catch (caught) {
      setStatus('error');
      setError(caught instanceof Error ? caught.message : 'Could not save.');
    }
  }, [draft, value, field, label, maxLength, required, endpoint, onSaved]);

  const cancel = () => {
    setDraft(value);
    setEditing(false);
    setError(null);
    setStatus('idle');
  };

  const display = renderDisplay ?? ((v) => v);

  const InputEl = multiline ? (
    <textarea
      ref={(el) => {
        inputRef.current = el;
      }}
      className="bg-background focus:border-foreground min-h-20 w-full resize-y rounded-md border px-3 py-2 text-base outline-none"
      value={draft}
      maxLength={maxLength}
      placeholder={placeholder}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => void commit()}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          void commit();
        } else if (e.key === 'Escape') {
          cancel();
        }
      }}
      disabled={status === 'saving'}
    />
  ) : (
    <input
      ref={(el) => {
        inputRef.current = el;
      }}
      className="bg-background focus:border-foreground w-full rounded-md border px-3 py-2 text-base outline-none"
      value={draft}
      maxLength={maxLength}
      placeholder={placeholder}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => void commit()}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          void commit();
        } else if (e.key === 'Escape') {
          cancel();
        }
      }}
      disabled={status === 'saving'}
    />
  );

  if (editing) {
    return (
      <div className={variant === 'card' ? 'bg-card rounded-xl border p-4' : ''}>
        {variant === 'card' ? (
          <div className="mb-2 flex items-baseline justify-between gap-3">
            <p className="text-muted-foreground text-xs font-medium tracking-[0.08em] uppercase">
              {label}
            </p>
            <SaveStatusIndicator status={status} />
          </div>
        ) : null}
        {InputEl}
        <div className="text-muted-foreground mt-1 flex items-center justify-between text-xs">
          <span>
            {multiline ? '⌘+Enter to save, Esc to cancel' : 'Enter to save, Esc to cancel'}
          </span>
          <span className={draft.length > maxLength ? 'text-destructive' : ''}>
            {draft.length} / {maxLength}
          </span>
        </div>
        {error ? <p className="text-destructive mt-1 text-xs">{error}</p> : null}
      </div>
    );
  }

  const trimmed = value.trim();
  return (
    <div className={variant === 'card' ? 'bg-card rounded-xl border p-4' : ''}>
      {variant === 'card' ? (
        <div className="mb-2 flex items-baseline justify-between gap-3">
          <p className="text-muted-foreground text-xs font-medium tracking-[0.08em] uppercase">
            {label}
          </p>
          <SaveStatusIndicator status={status} />
        </div>
      ) : null}
      <button
        type="button"
        aria-label={`Edit ${label.toLowerCase()}`}
        className="hover:bg-muted/40 block w-full rounded-md px-1 py-0.5 text-left"
        onClick={beginEdit}
      >
        {trimmed.length > 0 ? (
          <span className="whitespace-pre-wrap">{display(value)}</span>
        ) : (
          <span className="text-muted-foreground">{placeholder}</span>
        )}
      </button>
      {variant === 'plain' && status !== 'idle' ? (
        <div className="mt-1">
          <SaveStatusIndicator status={status} />
        </div>
      ) : null}
      {error ? <p className="text-destructive mt-1 text-xs">{error}</p> : null}
    </div>
  );
}

function SaveStatusIndicator({ status }: { status: SaveStatus }) {
  if (status === 'saving') {
    return (
      <span className="text-muted-foreground inline-flex items-center gap-1 text-xs">
        <Loader2 className="size-3 animate-spin" />
        Saving…
      </span>
    );
  }
  if (status === 'saved') {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-emerald-600">
        <Check className="size-3" />
        Saved
      </span>
    );
  }
  return null;
}
