'use client';

import Link from 'next/link';
import { useState } from 'react';
import type { CSSProperties } from 'react';

import type { RefineItem } from '@/server/refine/types';

// Standard success green (--success) for the single affirmative action verb.
// Same tint proportions the orange accent used, just re-hued to green.
const actionStyle: CSSProperties = {
  color: 'var(--success)',
  borderColor: 'color-mix(in srgb, var(--success) 38%, var(--brand-border))',
  background: 'color-mix(in srgb, var(--success) 8%, transparent)',
};

const ACTION_CLASS =
  'inline-flex min-h-11 cursor-pointer items-center justify-center self-start rounded-[var(--radius-xs)] border px-4 text-sm font-semibold transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60 sm:self-auto';

// Action verb sits on the right on the sm+ row (the trailing button keeps its
// natural end position), while mobile keeps the natural text-then-action stack.
const ROW_CLASS =
  'flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between sm:gap-4';

export function RefineItemCard({ item, queueId }: { item: RefineItem; queueId: string }) {
  // Navigational nudge (add_territories): links out instead of staging a
  // decision, so it skips the resolve/undo round-trip entirely.
  if (item.href) {
    return (
      <div className={ROW_CLASS}>
        <p className="text-foreground flex-1 text-sm leading-6">{item.openText}</p>
        <Link href={item.href} style={actionStyle} className={ACTION_CLASS}>
          {item.actionVerb}
        </Link>
      </div>
    );
  }

  return <RefineDecisionCard item={item} queueId={queueId} />;
}

function RefineDecisionCard({ item, queueId }: { item: RefineItem; queueId: string }) {
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
    <div className={ROW_CLASS}>
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
            className="text-muted-foreground min-h-11 self-start px-2 text-xs font-medium tracking-eyebrow uppercase underline underline-offset-4 transition disabled:opacity-60 sm:self-auto"
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
            className={ACTION_CLASS}
          >
            {item.actionVerb}
          </button>
        </>
      )}
    </div>
  );
}
