'use client';

import { ChevronDown, Search } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { formatRelativeTime } from '@/components/feed/visual';
import { buildAddSomeoneHandoff } from '@/components/friends/add-someone';
import { saveInviteEdit } from '@/components/friends/invite-edit';
import { formatUsPhoneInput } from '@/lib/phone-e164';

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

function PendingInviteCard({
  invite,
  copyingId,
  cancellingId,
  onCopy,
  onCancel,
  onSaved,
}: {
  invite: OutgoingInvite;
  copyingId: string | null;
  cancellingId: string | null;
  onCopy: (invite: OutgoingInvite) => void;
  onCancel: (invite: OutgoingInvite) => void;
  onSaved: () => Promise<void> | void;
}) {
  const canMessage = invite.message && invite.inviteePhoneForActions;

  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editInterests, setEditInterests] = useState<string[]>(['', '', '']);
  const [savingEdit, setSavingEdit] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  function startEdit() {
    setEditName(invite.inviteeDisplayName);
    setEditPhone(formatUsPhoneInput(invite.inviteePhoneForActions ?? ''));
    setEditInterests([
      invite.suggestedInterests[0] ?? '',
      invite.suggestedInterests[1] ?? '',
      invite.suggestedInterests[2] ?? '',
    ]);
    setEditError(null);
    setEditing(true);
  }

  async function saveEdit() {
    const trimmedName = editName.trim();
    if (!trimmedName) {
      setEditError('Add their name first.');
      return;
    }

    setSavingEdit(true);
    setEditError(null);

    const result = await saveInviteEdit({
      invitationId: invite.id,
      inviteeDisplayName: trimmedName,
      phone: editPhone,
      suggestedInterests: editInterests.map((interest) => interest.trim()).filter(Boolean),
    });

    setSavingEdit(false);

    if (!result.ok) {
      setEditError(result.message);
      return;
    }

    setEditing(false);
    await onSaved();
  }

  return (
    <article className="bg-card text-card-foreground rounded-[var(--radius-card)] border p-4 shadow-[var(--shadow-card)]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-foreground font-serif text-lg font-semibold leading-tight">{invitationName(invite)}</h3>
          <p className="text-muted-foreground mt-1 text-sm">{invitationTiming(invite.sentAt)}</p>
        </div>
        <span className="bg-muted text-foreground rounded-full px-3 py-1 text-xs font-medium">
          Waiting
        </span>
      </div>

      {editing ? (
        <form
          className="mt-4 space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            void saveEdit();
          }}
        >
          <label className="text-foreground block text-sm font-medium">
            Name
            <input
              className="bg-[var(--brand-field)] focus:border-[var(--brand-navy)] mt-1 h-11 w-full rounded-xl border border-[var(--accent-gold)] px-3 text-base transition outline-none"
              value={editName}
              onChange={(event) => {
                setEditName(event.target.value);
                setEditError(null);
              }}
              autoComplete="name"
              maxLength={60}
              placeholder="Their name"
            />
          </label>
          <label className="text-foreground block text-sm font-medium">
            Phone number
            <input
              className="bg-[var(--brand-field)] focus:border-[var(--brand-navy)] mt-1 h-11 w-full rounded-xl border border-[var(--accent-gold)] px-3 text-base transition outline-none"
              value={editPhone}
              onChange={(event) => {
                setEditPhone(formatUsPhoneInput(event.target.value));
                setEditError(null);
              }}
              autoComplete="tel"
              inputMode="tel"
              maxLength={14}
              placeholder="(555) 123-4567"
            />
          </label>
          <div className="space-y-2">
            <span className="text-foreground block text-sm font-medium">Ideas (up to three)</span>
            {editInterests.map((interest, index) => (
              <input
                key={index}
                className="bg-[var(--brand-field)] focus:border-[var(--brand-navy)] h-11 w-full rounded-full border border-[var(--accent-gold)] px-4 text-base transition outline-none"
                value={interest}
                onChange={(event) => {
                  const next = event.target.value;
                  setEditInterests((current) => current.map((value, i) => (i === index ? next : value)));
                  setEditError(null);
                }}
                maxLength={60}
                placeholder={`Idea ${index + 1}`}
              />
            ))}
          </div>

          {editError ? <p className="text-destructive text-sm font-medium">{editError}</p> : null}

          <div className="flex gap-3">
            <button type="submit" className="btn-primary flex-1" disabled={savingEdit}>
              {savingEdit ? 'Saving…' : 'Save changes'}
            </button>
            <button
              type="button"
              className="btn-ghost flex-1"
              onClick={() => setEditing(false)}
              disabled={savingEdit}
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <>
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
                className="btn-primary flex w-full items-center justify-center"
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
                <button type="button" className="text-muted-foreground text-sm" onClick={startEdit}>
                  Edit
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
        </>
      )}
    </article>
  );
}

function requestTiming(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Recently';
  return formatRelativeTime(value);
}

function IncomingRequestCard({
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
          <h3 className="text-foreground font-medium">{request.requesterName}</h3>
          <p className="text-muted-foreground mt-1 text-sm">
            Wants to follow you · {requestTiming(request.createdAt)}
          </p>
        </div>
      </div>

      {request.personalNote ? (
        <p className="text-muted-foreground mt-3 text-sm leading-6">“{request.personalNote}”</p>
      ) : null}

      {request.suggestedInterests.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {request.suggestedInterests.map((interest) => (
            <span
              key={interest}
              className="border-primary/10 bg-primary/5 text-foreground rounded-full border px-3 py-1 text-sm"
            >
              {interest}
            </span>
          ))}
        </div>
      ) : null}

      <div className="mt-4 flex items-center gap-3">
        <button
          type="button"
          className="btn-primary flex flex-1 items-center justify-center"
          onClick={() => onApprove(request)}
          disabled={busy}
        >
          {busy ? 'Working…' : 'Approve'}
        </button>
        <button
          type="button"
          className="text-muted-foreground min-h-11 px-4 text-sm"
          onClick={() => onIgnore(request)}
          disabled={busy}
        >
          Ignore
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
        <span className="bg-muted text-foreground rounded-full px-3 py-1 text-xs font-medium">
          Waiting
        </span>
      </div>

      {request.personalNote ? (
        <p className="text-muted-foreground mt-3 text-sm leading-6">“{request.personalNote}”</p>
      ) : null}

      <div className="mt-4 flex justify-center">
        <button
          type="button"
          className="text-muted-foreground text-sm"
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
  const [copyingId, setCopyingId] = useState<string | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
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

  function approveRequest(request: IncomingRequest) {
    void actOnRequest(request.id, 'accept', 'Could not approve this request.');
  }

  function ignoreRequest(request: IncomingRequest) {
    void actOnRequest(request.id, 'ignore', 'Could not ignore this request.');
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
            className="text-muted-foreground text-xs font-medium tracking-eyebrow uppercase"
          >
            Follow Requests
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
            className="text-muted-foreground text-xs font-medium tracking-eyebrow uppercase"
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

      {!loading && pendingInvites.length > 0 ? (
        <section aria-labelledby="waiting-for-response" className="space-y-3">
          <h2
            id="waiting-for-response"
            className="text-muted-foreground text-xs font-medium tracking-eyebrow uppercase"
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
                onSaved={loadInvites}
              />
            ))}
          </div>
        </section>
      ) : null}

      {!loading ? (
        <section aria-labelledby="friends-section" className="space-y-3">
          <h2
            id="friends-section"
            className="text-muted-foreground text-xs font-medium tracking-eyebrow uppercase"
          >
            Friends
          </h2>
          {friends.length > 0 ? (
            <>
              <div
                className="grid grid-cols-1 gap-2 rounded-md border bg-muted/30 p-2 sm:grid-cols-[1fr_2fr]"
                aria-label="Friend filters"
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
                    placeholder="Search friends..."
                    className="focus:border-[var(--brand-navy)] h-10 w-full rounded-md border border-[var(--accent-gold)] bg-[var(--brand-field)] pr-3 pl-10 text-sm outline-none"
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
                        className="text-primary underline"
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
                    className="text-primary underline"
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
