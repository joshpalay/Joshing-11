'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { inviteAcceptanceLabel, safeInviteName } from '@/lib/invite-links';

const JOINED_PAUSE_MS = 1200;

export function AcceptInviteLinkButton({
  handle,
  token,
  inviterName,
}: {
  handle: string;
  token: string;
  inviterName?: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Accepting used to jump straight to the next screen, so nothing ever said
  // the friendship formed (QA 2026-09-26, N11). Say it for a beat first.
  const [joined, setJoined] = useState(false);
  // Re-opening a friend's link: say "already friends", not "now friends"
  // (QA 2026-09-27, N8).
  const [alreadyFriends, setAlreadyFriends] = useState(false);
  const actionLabel = inviteAcceptanceLabel(inviterName);

  async function continueInvite() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/invite-links/accept', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ handle, token }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok || typeof body?.nextHref !== 'string') {
        setError(
          body?.message ??
            'This invitation could not be continued. Ask your friend for a fresh link.',
        );
        return;
      }
      setAlreadyFriends(body.alreadyFriends === true);
      setJoined(true);
      await new Promise((resolve) => setTimeout(resolve, JOINED_PAUSE_MS));
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
        disabled={busy || joined}
        className="btn-primary w-full"
      >
        {busy ? 'Continuing…' : actionLabel}
      </button>
      {joined ? (
        <p className="text-sm leading-5 text-[var(--brand-ink-700)]" role="status">
          {alreadyFriends
            ? safeInviteName(inviterName)
              ? `You and ${safeInviteName(inviterName)} are already friends.`
              : 'You’re already friends.'
            : safeInviteName(inviterName)
              ? `You and ${safeInviteName(inviterName)} are now friends.`
              : 'You’re now friends.'}
        </p>
      ) : null}
      {error ? (
        <>
          <p className="text-destructive text-sm leading-5" role="alert">
            {error}
          </p>
          {/* The invite page has no app chrome, so a failed accept was a dead
              end (QA 2026-09-27, N9). */}
          <Link href="/" className="btn-ghost w-full">
            Back to Joshing
          </Link>
        </>
      ) : null}
    </div>
  );
}
