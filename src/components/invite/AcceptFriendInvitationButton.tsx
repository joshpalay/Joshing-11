'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import { safeInviteName } from '@/lib/invite-links';

export function AcceptFriendInvitationButton({
  token,
  inviterName,
}: {
  token: string;
  inviterName?: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const name = safeInviteName(inviterName);

  async function continueInvite() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/friend-invitations/accept-token', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok || typeof body?.nextHref !== 'string') {
        setError(body?.message ?? 'This invitation could not be continued.');
        return;
      }
      router.push(body.nextHref);
      router.refresh();
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={() => void continueInvite()}
        disabled={busy}
        className="btn-primary min-h-11 w-full"
      >
        {busy ? 'Continuing…' : name ? `Continue with ${name}` : 'Continue'}
      </button>
      {error ? (
        <p className="text-destructive text-sm leading-5" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
