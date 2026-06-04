'use client';

import { useState } from 'react';
import type { CSSProperties } from 'react';

import type { RefineItem } from '@/server/refine/types';

// Warm accent from the library (--brand-orange) for the single action verb.
const actionStyle: CSSProperties = {
  color: 'var(--brand-orange)',
  borderColor: 'color-mix(in srgb, var(--brand-orange) 38%, var(--brand-border))',
  background: 'color-mix(in srgb, var(--brand-orange) 8%, transparent)',
};

export function RefineItemCard({ item, queueId }: { item: RefineItem; queueId: string }) {
  const [resolved, setResolved] = useState(item.state === 'resolved');
  const [busy, setBusy] = useState(false);

  const requestBody = {
    queue_id: queueId,
    item_type: item.type,
    canonical_subcategory: item.subdomainId,
    friend_id: item.friendId,
  };

  async function send(method: 'POST' | 'DELETE'): Promise<boolean> {
    try {
      const response = await fetch('/api/daily/refine', {
        method,
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(requestBody),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  async function resolve() {
    if (busy || !queueId) return;
    setBusy(true);
    setResolved(true); // optimistic
    const ok = await send('POST');
    if (!ok) setResolved(false);
    setBusy(false);
  }

  async function undo() {
    if (busy) return;
    setBusy(true);
    setResolved(false); // optimistic
    const ok = await send('DELETE');
    // A 409 (already committed) or network error keeps the resolved fact.
    if (!ok) setResolved(true);
    setBusy(false);
  }

  return (
    <div className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      {resolved ? (
        <>
          <p className="text-muted-foreground flex-1 text-sm leading-6">
            <span aria-hidden className="mr-1">
              ✓
            </span>
            {item.resolvedText}
          </p>
          <button
            type="button"
            onClick={undo}
            disabled={busy}
            className="text-muted-foreground min-h-11 self-start px-2 text-xs font-medium tracking-[0.08em] uppercase underline underline-offset-4 transition disabled:opacity-60 sm:self-auto"
          >
            Undo
          </button>
        </>
      ) : (
        <>
          <p className="text-foreground flex-1 text-sm leading-6">{item.openText}</p>
          <button
            type="button"
            onClick={resolve}
            disabled={busy}
            style={actionStyle}
            className="inline-flex min-h-11 items-center justify-center self-start rounded-full border px-4 text-sm font-semibold transition hover:opacity-90 disabled:opacity-60 sm:self-auto"
          >
            {item.actionVerb}
          </button>
        </>
      )}
    </div>
  );
}
