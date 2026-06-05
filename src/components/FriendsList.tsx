'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { formatRelativeTime } from '@/components/feed/visual';

type Person = {
  id: string;
  displayName: string;
  declaredInterests: string[];
  sharedInterests: string[];
  lastActiveAt: string | null;
  youFollow: boolean;
  followsYou: boolean;
};

type IncomingRequest = {
  id: string;
  requesterId: string;
  requesterName: string;
  suggestedInterests: string[];
  personalNote: string | null;
  createdAt: string;
};

type OutboundRequest = {
  id: string;
  recipientId: string;
  recipientName: string;
  personalNote: string | null;
  createdAt: string;
};

type FriendsHubResponse = {
  ok: boolean;
  following: Person[];
  followers: Person[];
  incomingRequests: IncomingRequest[];
  outboundRequests: OutboundRequest[];
  followPrivacy: 'public' | 'approval_required';
};

type InviteStatus = 'pending' | 'accepted' | 'expired' | 'cancelled';

type OutgoingInvite = {
  id: string;
  inviteeDisplayName: string;
  inviteeUserId: string | null;
  inviteePhoneMasked: string;
  inviteePhoneForActions: string | null;
  suggestedInterests: string[];
  status: InviteStatus;
  sentAt: string;
  acceptedAt: string | null;
  cancelledAt: string | null;
  expiresAt: string;
  message: string | null;
};

type InvitationsResponse = {
  ok: boolean;
  invitations: OutgoingInvite[];
};

function previewInterests(interests: string[]) {
  if (interests.length === 0) return null;
  return interests.slice(0, 3).join(', ');
}

function buildSmsHref(phone: string, message: string) {
  return `sms:${encodeURIComponent(phone)}?body=${encodeURIComponent(message)}`;
}

function invitationName(invite: OutgoingInvite) {
  return invite.inviteeDisplayName.trim() || invite.inviteePhoneMasked || 'Invited friend';
}

function invitationTiming(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Invited recently';

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const invitedDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const daysAgo = Math.max(0, Math.round((today.getTime() - invitedDay.getTime()) / 86_400_000));

  if (daysAgo === 0) return 'Invited today';
  if (daysAgo === 1) return 'Invited yesterday';
  return `Invited ${daysAgo} days ago`;
}

function friendSecondary(person: Person) {
  const sharedInterest = person.sharedInterests[0];
  if (sharedInterest) return `Shared interest: ${sharedInterest}`;

  const interests = previewInterests(person.declaredInterests);
  if (interests) return `Into ${interests}`;

  if (person.lastActiveAt) return `Active ${formatRelativeTime(person.lastActiveAt)}`;

  return 'Friend on Joshing';
}

function FriendCard({ person }: { person: Person }) {
  return (
    <Link
      href={`/users/${person.id}`}
      className="group bg-card text-card-foreground hover:border-foreground/25 focus-visible:ring-ring block rounded-2xl border p-4 shadow-sm transition hover:shadow-md focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
    >
      <h3 className="text-foreground font-medium group-hover:underline group-hover:underline-offset-4">
        {person.displayName}
      </h3>
      <p className="text-muted-foreground mt-1 text-sm leading-6">{friendSecondary(person)}</p>
    </Link>
  );
}

function PendingInviteCard({
  invite,
  copyingId,
  cancellingId,
  onCopy,
  onCancel,
}: {
  invite: OutgoingInvite;
  copyingId: string | null;
  cancellingId: string | null;
  onCopy: (invite: OutgoingInvite) => void;
  onCancel: (invite: OutgoingInvite) => void;
}) {
  const canMessage = invite.message && invite.inviteePhoneForActions;

  return (
    <article className="bg-card text-card-foreground rounded-2xl border p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-foreground font-medium">{invitationName(invite)}</h3>
          <p className="text-muted-foreground mt-1 text-sm">{invitationTiming(invite.sentAt)}</p>
        </div>
        <span className="bg-muted text-foreground rounded-full px-3 py-1 text-xs font-medium">
          Waiting
        </span>
      </div>

      {invite.suggestedInterests.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {invite.suggestedInterests.map((interest) => (
            <span
              key={interest}
              className="border-primary/10 bg-primary/5 text-foreground rounded-full border px-3 py-1 text-sm"
            >
              {interest}
            </span>
          ))}
        </div>
      ) : null}

      {canMessage ? (
        <div className="mt-4 space-y-2">
          <a
            className="btn-primary flex min-h-11 w-full items-center justify-center rounded-full"
            href={buildSmsHref(invite.inviteePhoneForActions!, invite.message!)}
          >
            Send message
          </a>
          <div className="flex justify-center gap-6">
            <button
              type="button"
              className="text-muted-foreground text-sm"
              onClick={() => onCopy(invite)}
            >
              {copyingId === invite.id ? 'Copied ✓' : 'Copy instead'}
            </button>
            <button
              type="button"
              className="text-muted-foreground text-sm"
              onClick={() => onCancel(invite)}
              disabled={cancellingId === invite.id}
            >
              {cancellingId === invite.id ? 'Setting aside…' : 'Set aside'}
            </button>
          </div>
        </div>
      ) : null}
    </article>
  );
}

export default function FriendsList() {
  const [following, setFollowing] = useState<Person[]>([]);
  const [followers, setFollowers] = useState<Person[]>([]);
  const [invites, setInvites] = useState<OutgoingInvite[]>([]);
  const [friendsLoading, setFriendsLoading] = useState(true);
  const [invitesLoading, setInvitesLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copyingId, setCopyingId] = useState<string | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  const loadFriends = useCallback(async () => {
    setError(null);

    try {
      const response = await fetch('/api/friends', {
        cache: 'no-store',
        credentials: 'include',
      });
      const body = (await response.json().catch(() => null)) as
        | FriendsHubResponse
        | { message?: string }
        | null;

      if (!response.ok || !body || !('following' in body)) {
        throw new Error(
          body && 'message' in body && body.message ? body.message : 'Could not load friends.',
        );
      }

      setFollowing(body.following);
      setFollowers(body.followers);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not load friends.');
    } finally {
      setFriendsLoading(false);
    }
  }, []);

  const loadInvites = useCallback(async () => {
    setError(null);

    try {
      const response = await fetch('/api/friend-invitations', {
        cache: 'no-store',
        credentials: 'include',
      });
      const body = (await response.json().catch(() => null)) as
        | InvitationsResponse
        | { message?: string }
        | null;

      if (!response.ok || !body || !('invitations' in body)) {
        throw new Error(
          body && 'message' in body && body.message ? body.message : 'Could not load invitations.',
        );
      }

      setInvites(body.invitations);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not load invitations.');
    } finally {
      setInvitesLoading(false);
    }
  }, []);

  useEffect(() => {
    queueMicrotask(() => {
      void loadFriends();
      void loadInvites();
    });

    function refresh() {
      void loadFriends();
      void loadInvites();
    }

    window.addEventListener('friend-invitations:refresh', refresh);
    return () => window.removeEventListener('friend-invitations:refresh', refresh);
  }, [loadFriends, loadInvites]);

  const friends = useMemo(() => {
    const peopleById = new Map<string, Person>();
    for (const person of [...following, ...followers]) {
      if (!person.youFollow || !person.followsYou) continue;
      peopleById.set(person.id, person);
    }
    return Array.from(peopleById.values()).sort((a, b) =>
      a.displayName.localeCompare(b.displayName),
    );
  }, [followers, following]);

  const pendingInvites = useMemo(
    () => invites.filter((invite) => invite.status === 'pending'),
    [invites],
  );

  async function copyInvite(invite: OutgoingInvite) {
    if (!invite.message) return;

    try {
      await navigator.clipboard.writeText(invite.message);
      setCopyingId(invite.id);
      window.setTimeout(() => setCopyingId(null), 2000);
    } catch {
      if (navigator.share) await navigator.share({ text: invite.message });
    }
  }

  async function cancelInvite(invite: OutgoingInvite) {
    setCancellingId(invite.id);
    setError(null);

    try {
      const response = await fetch('/api/friend-invitations', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ invitationId: invite.id }),
      });
      const body = (await response.json().catch(() => null)) as {
        message?: string;
      } | null;

      if (!response.ok) {
        throw new Error(body?.message ?? 'Could not set this aside.');
      }

      await loadInvites();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not set this aside.');
    } finally {
      setCancellingId(null);
    }
  }

  const loading = friendsLoading || invitesLoading;

  return (
    <div className="space-y-8">
      {error ? <p className="text-destructive text-sm font-medium">{error}</p> : null}

      {loading ? <p className="text-muted-foreground text-sm">Loading friends…</p> : null}

      {!loading && pendingInvites.length > 0 ? (
        <section aria-labelledby="waiting-for-response" className="space-y-3">
          <h2
            id="waiting-for-response"
            className="text-muted-foreground text-xs font-medium tracking-[0.1em] uppercase"
          >
            Waiting for Response
          </h2>
          <div className="space-y-3">
            {pendingInvites.map((invite) => (
              <PendingInviteCard
                key={invite.id}
                invite={invite}
                copyingId={copyingId}
                cancellingId={cancellingId}
                onCopy={copyInvite}
                onCancel={cancelInvite}
              />
            ))}
          </div>
        </section>
      ) : null}

      {!loading ? (
        <section aria-labelledby="friends-section" className="space-y-3">
          <h2
            id="friends-section"
            className="text-muted-foreground text-xs font-medium tracking-[0.1em] uppercase"
          >
            Friends
          </h2>
          {friends.length > 0 ? (
            <div className="space-y-3">
              {friends.map((person) => (
                <FriendCard key={person.id} person={person} />
              ))}
            </div>
          ) : pendingInvites.length > 0 ? (
            <p className="bg-card text-muted-foreground rounded-2xl border p-4 text-sm shadow-sm">
              Accepted invitations will appear here.
            </p>
          ) : (
            <div className="bg-card text-card-foreground rounded-2xl border p-5 shadow-sm">
              <h3 className="font-serif text-xl font-semibold">You haven’t invited anyone yet.</h3>
              <p className="text-muted-foreground mt-2 text-sm leading-6">
                Start with someone who shares part of your world.
              </p>
            </div>
          )}
        </section>
      ) : null}
    </div>
  );
}
