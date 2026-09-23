'use client';

import { ChevronDown, Search } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { formatRelativeTime } from '@/components/feed/visual';
import { buildAddSomeoneHandoff } from '@/components/friends/add-someone';
import { Chip } from '@/components/ui/Chip';

type FriendSort = 'name_asc' | 'name_desc' | 'recent';

type Person = {
  id: string;
  displayName: string;
  declaredInterests: string[];
  sharedInterests: string[];
  lastActiveAt: string | null;
  youFollow: boolean;
  followsYou: boolean;
  authoredCount: number;
  answeredByViewerCount: number;
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
  inviteUrl: string | null;
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
      className="group focus-visible:ring-ring block py-4 transition focus-visible:rounded-md focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
    >
      {/* Name-as-headline is the Editorial voice (STYLE-GUIDE-TYPE §5):
          heavier serif, full ink. */}
      <h3 className="text-foreground font-serif text-lg font-semibold leading-tight group-hover:underline group-hover:underline-offset-4">
        {person.displayName}
      </h3>
      <p className="text-muted-foreground mt-1 text-sm leading-6">{friendSecondary(person)}</p>
      {/* Two warm activity facts (PLR-14): what they've contributed and what
          you've engaged with — kept on one line as a quiet shared ledger,
          never a ranking. Friends are not sorted or compared by these.
          Suppressed entirely when the friend hasn't authored anything yet —
          a zero count reads as a scoreboard, which this line is not. */}
      {person.authoredCount > 0 && (
        <p className="text-muted-foreground mt-2 text-xs">
          Questions created{" "}
          <span className="text-foreground font-medium tabular-nums">{person.authoredCount}</span> (you
          answered{" "}
          <span className="text-foreground font-medium tabular-nums">
            {person.answeredByViewerCount}
          </span>
          )
        </p>
      )}
    </Link>
  );
}

function requestTiming(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Recently';
  return formatRelativeTime(value);
}

export function IncomingRequestCard({
  request,
  pendingRequestId,
  onApprove,
  onIgnore,
}: {
  request: IncomingRequest;
  pendingRequestId: string | null;
  onApprove: (request: IncomingRequest) => void;
  onIgnore: (request: IncomingRequest) => void;
}) {
  const busy = pendingRequestId === request.id;

  return (
    <article className="bg-card text-card-foreground rounded-[var(--radius-card)] border p-4 shadow-[var(--shadow-card)]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-foreground font-medium break-words">{request.requesterName}</h3>
          <p className="text-muted-foreground mt-1 text-sm">
            Wants to be friends · {requestTiming(request.createdAt)}
          </p>
        </div>
      </div>

      <p className="text-muted-foreground mt-2 text-sm">
        Share questions and see what you’re each exploring. Declining won’t notify them.
      </p>

      {request.personalNote ? (
        <p className="text-muted-foreground mt-3 text-sm leading-6">“{request.personalNote}”</p>
      ) : null}

      {request.suggestedInterests.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {request.suggestedInterests.map((interest) => (
            <Chip key={interest} variant="outline" className="border-primary/10 bg-primary/5">
              {interest}
            </Chip>
          ))}
        </div>
      ) : null}

      <div className="mt-4 flex items-center gap-3">
        <button
          type="button"
          className="btn-primary flex flex-1 items-center justify-center"
          onClick={() => onApprove(request)}
          disabled={busy}
          aria-label={`Accept friend request from ${request.requesterName}`}
        >
          {busy ? 'Working…' : 'Accept'}
        </button>
        <button
          type="button"
          className="text-muted-foreground min-h-11 px-4 text-sm"
          onClick={() => onIgnore(request)}
          disabled={busy}
          aria-label={`Decline friend request from ${request.requesterName}`}
        >
          Decline
        </button>
      </div>
    </article>
  );
}

function OutboundRequestCard({
  request,
  pendingRequestId,
  onCancel,
}: {
  request: OutboundRequest;
  pendingRequestId: string | null;
  onCancel: (request: OutboundRequest) => void;
}) {
  const busy = pendingRequestId === request.id;

  return (
    <article className="bg-card text-card-foreground rounded-[var(--radius-card)] border p-4 shadow-[var(--shadow-card)]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-foreground font-medium">{request.recipientName}</h3>
          <p className="text-muted-foreground mt-1 text-sm">
            Request sent · {requestTiming(request.createdAt)}
          </p>
        </div>
        <Chip>Waiting</Chip>
      </div>

      {request.personalNote ? (
        <p className="text-muted-foreground mt-3 text-sm leading-6">“{request.personalNote}”</p>
      ) : null}

      <div className="mt-4 flex justify-center">
        <button
          type="button"
          className="text-muted-foreground inline-flex min-h-11 items-center text-sm"
          onClick={() => onCancel(request)}
          disabled={busy}
        >
          {busy ? 'Cancelling…' : 'Cancel request'}
        </button>
      </div>
    </article>
  );
}

export default function FriendsList() {
  const [following, setFollowing] = useState<Person[]>([]);
  const [followers, setFollowers] = useState<Person[]>([]);
  const [incomingRequests, setIncomingRequests] = useState<IncomingRequest[]>([]);
  const [outboundRequests, setOutboundRequests] = useState<OutboundRequest[]>([]);
  const [pendingRequestId, setPendingRequestId] = useState<string | null>(null);
  const [invites, setInvites] = useState<OutgoingInvite[]>([]);
  const [friendsLoading, setFriendsLoading] = useState(true);
  const [invitesLoading, setInvitesLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [friendSort, setFriendSort] = useState<FriendSort>('name_asc');
  const [friendSearch, setFriendSearch] = useState('');

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
      setIncomingRequests(body.incomingRequests);
      setOutboundRequests(body.outboundRequests);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not load friends.');
    } finally {
      setFriendsLoading(false);
    }
  }, []);

  const actOnRequest = useCallback(
    async (friendshipId: string, action: 'accept' | 'ignore' | 'cancel', failureMessage: string) => {
      setPendingRequestId(friendshipId);
      setError(null);

      try {
        const response = await fetch(`/api/friend-requests/${friendshipId}/${action}`, {
          method: 'POST',
          credentials: 'include',
        });
        const body = (await response.json().catch(() => null)) as { message?: string } | null;

        if (!response.ok) {
          throw new Error(body?.message ?? failureMessage);
        }

        await loadFriends();
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : failureMessage);
      } finally {
        setPendingRequestId(null);
      }
    },
    [loadFriends],
  );

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
    return Array.from(peopleById.values());
  }, [followers, following]);

  const visibleFriends = useMemo(() => {
    const query = friendSearch.trim().toLowerCase();
    return friends
      .filter((person) => {
        if (!query) return true;
        const haystack = [
          person.displayName,
          ...person.declaredInterests,
          ...person.sharedInterests,
        ]
          .join(' ')
          .toLowerCase();
        return haystack.includes(query);
      })
      .slice()
      .sort((a, b) => {
        if (friendSort === 'name_desc') return b.displayName.localeCompare(a.displayName);
        if (friendSort === 'recent') {
          const aTime = a.lastActiveAt ? Date.parse(a.lastActiveAt) : 0;
          const bTime = b.lastActiveAt ? Date.parse(b.lastActiveAt) : 0;
          return bTime - aTime || a.displayName.localeCompare(b.displayName);
        }
        return a.displayName.localeCompare(b.displayName);
      });
  }, [friends, friendSearch, friendSort]);

  function clearFriendFilters() {
    setFriendSort('name_asc');
    setFriendSearch('');
  }

  // The friends filter is an in-memory substring match over your *existing*
  // friends. When it finds no one, it's not an add-path — it's a labeled exit to
  // the "Add someone" block. We deliberately pass NO term: the filter fragment is
  // a name, and the lookup is exact handle-or-phone only, so carrying it across
  // would dead-end. Hand the user to the right tool with an empty, focused input.
  function goToAddSomeone() {
    const { type, detail } = buildAddSomeoneHandoff();
    window.dispatchEvent(new CustomEvent(type, { detail }));
  }

  const pendingInvites = useMemo(
    () => invites.filter((invite) => invite.status === 'pending'),
    [invites],
  );

  function approveRequest(request: IncomingRequest) {
    void actOnRequest(request.id, 'accept', 'Could not accept this request.');
  }

  function ignoreRequest(request: IncomingRequest) {
    void actOnRequest(request.id, 'ignore', 'Could not decline this request.');
  }

  function cancelRequest(request: OutboundRequest) {
    void actOnRequest(request.id, 'cancel', 'Could not cancel this request.');
  }

  const loading = friendsLoading || invitesLoading;

  return (
    <div className="space-y-8">
      {error ? <p className="text-destructive text-sm font-medium">{error}</p> : null}

      {loading ? <p className="text-muted-foreground text-sm">Loading friends…</p> : null}

      {!loading && incomingRequests.length > 0 ? (
        <section aria-labelledby="follow-requests" className="space-y-3">
          <h2
            id="follow-requests"
            className="text-muted-foreground text-xs font-medium tracking-[0.1em] uppercase"
          >
            Friend Requests
          </h2>
          <div className="space-y-3">
            {incomingRequests.map((request) => (
              <IncomingRequestCard
                key={request.id}
                request={request}
                pendingRequestId={pendingRequestId}
                onApprove={approveRequest}
                onIgnore={ignoreRequest}
              />
            ))}
          </div>
        </section>
      ) : null}

      {!loading && outboundRequests.length > 0 ? (
        <section aria-labelledby="requests-sent" className="space-y-3">
          <h2
            id="requests-sent"
            className="text-muted-foreground text-xs font-medium tracking-[0.1em] uppercase"
          >
            Requests Sent{' '}
            <span className="text-foreground tabular-nums">({outboundRequests.length})</span>
          </h2>
          <div className="space-y-3">
            {outboundRequests.map((request) => (
              <OutboundRequestCard
                key={request.id}
                request={request}
                pendingRequestId={pendingRequestId}
                onCancel={cancelRequest}
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
            <>
              {/* A FILTER on the roster below, not a second way to find people.
                  It used to sit in a bordered card with the same gold-bordered
                  input as the add-someone lookup at the top of the page --
                  identical treatment for two different jobs, which read as two
                  competing searches. Card chrome dropped and the field quieted
                  so it reads as subordinate to the list it filters. */}
              <div
                className="grid grid-cols-1 gap-2 pb-2 sm:grid-cols-[1fr_2fr]"
                aria-label="Filter your friends"
              >
                <label className="relative">
                  <select
                    value={friendSort}
                    onChange={(event) => setFriendSort(event.target.value as FriendSort)}
                    className="focus-visible:border-primary focus-visible:ring-primary h-10 w-full appearance-none rounded-md border bg-background px-3 pr-9 text-sm outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
                    aria-label="Sort by"
                  >
                    <option value="name_asc">Name (A–Z)</option>
                    <option value="name_desc">Name (Z–A)</option>
                    <option value="recent">Recently active</option>
                  </select>
                  <ChevronDown
                    className="text-muted-foreground pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2"
                    aria-hidden="true"
                  />
                </label>
                <label className="relative">
                  <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
                  <input
                    value={friendSearch}
                    onChange={(event) => setFriendSearch(event.target.value)}
                    placeholder="Filter by name or topic"
                    className="focus:border-[var(--brand-navy)] border-border bg-background h-10 w-full rounded-md border pr-3 pl-10 text-sm"
                  />
                </label>
              </div>
              {visibleFriends.length > 0 ? (
                <div className="divide-border border-border divide-y border-t">
                  {visibleFriends.map((person) => (
                    <FriendCard key={person.id} person={person} />
                  ))}
                </div>
              ) : (
                <p className="text-muted-foreground py-8 text-center text-sm">
                  {friendSearch.trim() ? (
                    <>
                      No one in your friends by that. Looking for someone new?{' '}
                      <button
                        type="button"
                        className="inline-flex items-center min-h-11 text-primary underline"
                        onClick={goToAddSomeone}
                      >
                        Add someone →
                      </button>{' '}
                      ·{' '}
                    </>
                  ) : (
                    <>No friends match your filter. </>
                  )}
                  <button
                    type="button"
                    className="inline-flex items-center min-h-11 text-primary underline"
                    onClick={clearFriendFilters}
                  >
                    Clear filters
                  </button>
                </p>
              )}
            </>
          ) : pendingInvites.length > 0 ? (
            <p className="bg-card text-muted-foreground rounded-[var(--radius-card)] border p-4 text-sm shadow-[var(--shadow-card)]">
              Accepted invitations will appear here.
            </p>
          ) : (
            <div className="bg-card text-card-foreground rounded-[var(--radius-card)] border p-5 shadow-[var(--shadow-card)]">
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
