'use client';

import { ArrowDownToLine, Undo2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

/**
 * D-REVIEW-RECOVERED-01 — the only client JS on the recovered surface: a small
 * action that sets a question aside (demote to the bottom) or restores it. It
 * POSTs/DELETEs to /api/recovered/set-aside and refreshes the server component
 * so the new ordering and dimming render from the source of truth. The button
 * holds a pending state across both the request and the refresh.
 */
export function SetAsideButton({
  questionId,
  setAside,
}: {
  questionId: string;
  setAside: boolean;
}) {
  const router = useRouter();
  const [sending, setSending] = useState(false);
  const [isRefreshing, startTransition] = useTransition();
  const busy = sending || isRefreshing;

  async function toggle() {
    if (busy) return;
    setSending(true);
    try {
      const res = await fetch('/api/recovered/set-aside', {
        method: setAside ? 'DELETE' : 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ questionId }),
      });
      if (res.ok) {
        startTransition(() => router.refresh());
      }
    } finally {
      setSending(false);
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={busy}
      className="inline-flex items-center gap-1.5 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline disabled:opacity-50"
    >
      {setAside ? (
        <>
          <Undo2 className="size-3.5" aria-hidden="true" />
          Restore
        </>
      ) : (
        <>
          <ArrowDownToLine className="size-3.5" aria-hidden="true" />
          Set aside
        </>
      )}
    </button>
  );
}
