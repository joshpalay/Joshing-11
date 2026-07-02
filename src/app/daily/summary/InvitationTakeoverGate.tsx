'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';

// B-CRAFTER-LIFECYCLE-01 Phase 3 — the post-daily takeover trigger. Mounted on
// the daily summary: if the player has an UNSEEN author invitation, replace
// into the full-screen /invited experience (decision 2026-07-01: full-screen,
// after the daily). Once-then-quiet is server-enforced — /invited stamps
// seenAt on first render, so this gate fires at most once per invitation and
// a summary reload after that shows the normal recap. Best-effort: any failure
// here just means the player sees the recap as before.
export function InvitationTakeoverGate() {
  const router = useRouter();
  const checked = useRef(false);

  useEffect(() => {
    if (checked.current) return;
    checked.current = true;
    void (async () => {
      try {
        const res = await fetch('/api/invitations', { credentials: 'include', cache: 'no-store' });
        if (!res.ok) return;
        const body = (await res.json().catch(() => null)) as { unseen?: { id: string } | null } | null;
        if (body?.unseen) router.replace('/invited');
      } catch {
        // Best-effort — the recap renders as usual.
      }
    })();
  }, [router]);

  return null;
}
