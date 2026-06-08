'use client';

import { Check, Loader2 } from 'lucide-react';
import { useState } from 'react';

// Handle editing has its own endpoint (PATCH /api/account/handle owns the
// 30-day rate limit) and a two-step confirm because handle changes are
// throttled.

type Props = {
  initialValue: string | null;
  initialLastChangedAt: string | null;
  cooldownDays: number;
  // Compact mode renders inline (used in the profile header next to the
  // displayName). Card mode renders a labeled rounded card.
  variant?: 'plain' | 'card';
};

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export function InlineHandleField({
  initialValue,
  initialLastChangedAt,
  cooldownDays,
  variant = 'plain',
}: Props) {
  const [value, setValue] = useState(initialValue ?? '');
  const [lastChangedAt, setLastChangedAt] = useState(initialLastChangedAt);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(initialValue ?? '');
  const [confirming, setConfirming] = useState(false);
  const [status, setStatus] = useState<SaveStatus>('idle');
  const [error, setError] = useState<string | null>(null);

  const cooldownInfo = computeHandleCooldown(lastChangedAt, cooldownDays);

  const beginEdit = () => {
    setError(null);
    setDraft(value);
    setEditing(true);
    setConfirming(false);
  };

  const cancel = () => {
    setEditing(false);
    setConfirming(false);
    setDraft(value);
    setError(null);
  };

  const requestSave = () => {
    const trimmed = draft.trim().toLowerCase();
    if (trimmed === value.trim().toLowerCase()) {
      setEditing(false);
      return;
    }
    if (cooldownInfo.locked) {
      setError(
        `You can change your handle again on ${cooldownInfo.unlockDate.toLocaleDateString()}.`,
      );
      return;
    }
    setError(null);
    setConfirming(true);
  };

  const confirmSave = async () => {
    setStatus('saving');
    setError(null);
    try {
      const response = await fetch('/api/account/handle', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ handle: draft.trim().toLowerCase() }),
      });
      const body = (await response.json().catch(() => null)) as
        | { ok?: boolean; handle?: string; message?: string }
        | null;
      if (!response.ok || !body?.ok || !body.handle) {
        throw new Error(body?.message ?? 'Could not save.');
      }
      setValue(body.handle);
      setLastChangedAt(new Date().toISOString());
      setStatus('saved');
      setEditing(false);
      setConfirming(false);
      window.setTimeout(() => setStatus('idle'), 1500);
    } catch (caught) {
      setStatus('error');
      setError(caught instanceof Error ? caught.message : 'Could not save.');
      setConfirming(false);
    }
  };

  const editor = (
    <div className="mt-2">
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground">@</span>
        <input
          autoFocus
          className="flex-1 rounded-md border bg-background px-3 py-2 text-base outline-none focus:border-foreground"
          value={draft}
          maxLength={20}
          placeholder="handle"
          onChange={(e) => setDraft(e.target.value.toLowerCase())}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              requestSave();
            } else if (e.key === 'Escape') {
              cancel();
            }
          }}
          disabled={status === 'saving'}
        />
      </div>
      {confirming ? (
        <div className="mt-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <p>You can change your handle once every {cooldownDays} days. Continue?</p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              className="rounded-md bg-amber-600 px-3 py-1 text-xs font-medium text-white hover:bg-amber-700 disabled:opacity-60"
              onClick={() => void confirmSave()}
              disabled={status === 'saving'}
            >
              Yes, change it
            </button>
            <button
              type="button"
              className="rounded-md border border-amber-300 px-3 py-1 text-xs"
              onClick={cancel}
              disabled={status === 'saving'}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
          <span>Enter to save, Esc to cancel</span>
          <span>{draft.length} / 20</span>
        </div>
      )}
    </div>
  );

  if (editing) {
    return (
      <div className={variant === 'card' ? 'rounded-xl border bg-card p-4' : ''}>
        {variant === 'card' ? (
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">
              Handle
            </p>
            <SaveStatusIndicator status={status} />
          </div>
        ) : null}
        {editor}
        {error ? <p className="mt-2 text-xs text-destructive">{error}</p> : null}
      </div>
    );
  }

  const trimmed = value.trim();
  return (
    <div className={variant === 'card' ? 'rounded-xl border bg-card p-4' : ''}>
      {variant === 'card' ? (
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">
            Handle
          </p>
          <SaveStatusIndicator status={status} />
        </div>
      ) : null}
      <button
        type="button"
        aria-label="Edit handle"
        className="block w-full rounded-md px-1 py-0.5 text-left text-sm text-muted-foreground hover:bg-muted/40"
        onClick={beginEdit}
      >
        {trimmed.length > 0 ? `@${trimmed}` : <span>Pick a handle</span>}
      </button>
      {variant === 'plain' && status !== 'idle' ? (
        <div className="mt-1">
          <SaveStatusIndicator status={status} />
        </div>
      ) : null}
      {variant === 'card' ? (
        cooldownInfo.locked ? (
          <p className="mt-2 text-xs text-muted-foreground">
            Next change available {cooldownInfo.unlockDate.toLocaleDateString()}.
          </p>
        ) : (
          <p className="mt-2 text-xs text-muted-foreground">
            You can change your handle once every {cooldownDays} days.
          </p>
        )
      ) : null}
      {error ? <p className="mt-2 text-xs text-destructive">{error}</p> : null}
    </div>
  );
}

function computeHandleCooldown(lastChangedAtIso: string | null, cooldownDays: number) {
  if (!lastChangedAtIso) return { locked: false, unlockDate: new Date(0) };
  const lastChanged = new Date(lastChangedAtIso);
  const unlockDate = new Date(lastChanged.getTime() + cooldownDays * 24 * 60 * 60 * 1000);
  return { locked: unlockDate.getTime() > Date.now(), unlockDate };
}

function SaveStatusIndicator({ status }: { status: SaveStatus }) {
  if (status === 'saving') {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
        <Loader2 className="size-3 animate-spin" />
        Saving…
      </span>
    );
  }
  if (status === 'saved') {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-[var(--success)]">
        <Check className="size-3" />
        Saved
      </span>
    );
  }
  return null;
}
