'use client'

import Link from 'next/link'
import PeopleYouInvited from '@/components/PeopleYouInvited'
import { formatRelativeTime } from '@/components/feed/visual'
import { useCallback, useEffect, useState } from 'react'

type Tab = 'following' | 'followers' | 'pending'

type Person = {
  id: string
  displayName: string
  declaredInterests: string[]
  sharedInterests: string[]
  lastActiveAt: string | null
  youFollow: boolean
  followsYou: boolean
}

type IncomingRequest = {
  id: string
  requesterId: string
  requesterName: string
  suggestedInterests: string[]
  personalNote: string | null
  createdAt: string
}

type OutboundRequest = {
  id: string
  recipientId: string
  recipientName: string
  personalNote: string | null
  createdAt: string
}

type FollowPrivacy = 'public' | 'approval_required'

type FriendsHubResponse = {
  ok: boolean
  following: Person[]
  followers: Person[]
  incomingRequests: IncomingRequest[]
  outboundRequests: OutboundRequest[]
  followPrivacy: FollowPrivacy
}

type RequestAction = 'accept' | 'ignore'

function previewInterests(interests: string[]) {
  if (interests.length === 0) return null
  return interests.join(', ')
}

function PersonCard({
  person,
  action,
}: {
  person: Person
  action?: React.ReactNode
}) {
  const interests = previewInterests(person.declaredInterests)
  const sharedInterest = person.sharedInterests[0]
  const lastActiveLabel = person.lastActiveAt ? formatRelativeTime(person.lastActiveAt) : null

  return (
    <div className="bg-background hover:border-foreground/30 flex items-start justify-between gap-3 rounded-xl border p-3 transition hover:shadow-sm">
      <Link href={`/users/${person.id}`} className="min-w-0 flex-1">
        <h3 className="text-primary decoration-primary/40 hover:decoration-primary font-medium underline underline-offset-4">
          {person.displayName}
        </h3>
        {interests ? (
          <p className="text-muted-foreground mt-1 text-sm leading-6">A mind into {interests}</p>
        ) : (
          <p className="text-muted-foreground mt-1 text-sm leading-6">
            Interests will appear here as they declare them.
          </p>
        )}
        <div className="mt-1 flex flex-wrap items-center gap-2">
          {person.followsYou && person.youFollow ? (
            <span className="text-muted-foreground/70 text-xs">Mutual</span>
          ) : person.followsYou ? (
            <span className="text-muted-foreground/70 text-xs">Follows you</span>
          ) : null}
          {lastActiveLabel ? (
            <span className="text-muted-foreground/70 text-xs">Active {lastActiveLabel}</span>
          ) : null}
        </div>
      </Link>
      <div className="flex shrink-0 flex-col items-end gap-2">
        {sharedInterest ? (
          <span className="bg-muted text-foreground max-w-[12rem] rounded-full px-3 py-1 text-center text-xs font-medium break-words whitespace-normal">
            Shared: {sharedInterest}
          </span>
        ) : null}
        {action}
      </div>
    </div>
  )
}

export default function FriendsList() {
  const [following, setFollowing] = useState<Person[]>([])
  const [followers, setFollowers] = useState<Person[]>([])
  const [incomingRequests, setIncomingRequests] = useState<IncomingRequest[]>([])
  const [outboundRequests, setOutboundRequests] = useState<OutboundRequest[]>([])
  const [followPrivacy, setFollowPrivacy] = useState<FollowPrivacy>('approval_required')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [pendingRequest, setPendingRequest] = useState<string | null>(null)
  const [privacyUpdating, setPrivacyUpdating] = useState(false)
  const [activeTab, setActiveTab] = useState<Tab>('following')
  // Passive Pending-tab row count — null while loading, 0 when there's
  // nothing new. Cleared after the user visits /friends/find.
  const [newDiscoveryCount, setNewDiscoveryCount] = useState<number | null>(null)

  const loadFriends = useCallback(async () => {
    setError(null)

    try {
      const response = await fetch('/api/friends', {
        cache: 'no-store',
        credentials: 'include',
      })
      const body = (await response.json().catch(() => null)) as
        | FriendsHubResponse
        | { message?: string }
        | null

      if (!response.ok || !body || !('following' in body)) {
        throw new Error(
          body && 'message' in body && body.message ? body.message : 'Could not load follows.',
        )
      }

      setFollowing(body.following)
      setFollowers(body.followers)
      setIncomingRequests(body.incomingRequests)
      setOutboundRequests(body.outboundRequests ?? [])
      setFollowPrivacy(body.followPrivacy)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not load follows.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    queueMicrotask(() => void loadFriends())
  }, [loadFriends])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const response = await fetch('/api/friends/has-new-discovery', {
          credentials: 'include',
        })
        if (!response.ok) return
        const body = (await response.json().catch(() => null)) as
          | { hasNew: boolean; count: number }
          | null
        if (!cancelled && body) {
          setNewDiscoveryCount(body.hasNew ? body.count : 0)
        }
      } catch {
        // Swallow — passive signal, OK to skip.
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  async function updateRequest(requestId: string, action: RequestAction) {
    setPendingRequest(`${requestId}:${action}`)
    setError(null)

    try {
      const response = await fetch(`/api/friend-requests/${requestId}/${action}`, {
        method: 'POST',
        credentials: 'include',
      })
      const body = (await response.json().catch(() => null)) as { message?: string } | null

      if (!response.ok) {
        throw new Error(body?.message ?? 'Could not update this request.')
      }

      await loadFriends()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not update this request.')
    } finally {
      setPendingRequest(null)
    }
  }

  async function cancelOutbound(requestId: string) {
    setPendingRequest(`${requestId}:cancel`)
    setError(null)
    const previous = outboundRequests
    setOutboundRequests((current) => current.filter((row) => row.id !== requestId))

    try {
      const response = await fetch(`/api/friend-requests/${requestId}/cancel`, {
        method: 'POST',
        credentials: 'include',
      })
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { message?: string } | null
        setOutboundRequests(previous)
        throw new Error(body?.message ?? 'Could not cancel this request.')
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not cancel this request.')
    } finally {
      setPendingRequest(null)
    }
  }

  async function followBack(personId: string) {
    setPendingRequest(`${personId}:follow`)
    setError(null)
    try {
      const response = await fetch('/api/friend-requests', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inviteeUserId: personId }),
      })
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { message?: string } | null
        throw new Error(body?.message ?? 'Could not follow this person.')
      }
      await loadFriends()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not follow this person.')
    } finally {
      setPendingRequest(null)
    }
  }

  async function togglePrivacy(next: FollowPrivacy) {
    setPrivacyUpdating(true)
    setError(null)
    const previous = followPrivacy
    setFollowPrivacy(next)
    try {
      const response = await fetch('/api/users/me', {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ followPrivacy: next }),
      })
      if (!response.ok) {
        setFollowPrivacy(previous)
        const body = (await response.json().catch(() => null)) as { message?: string } | null
        throw new Error(body?.message ?? 'Could not update your privacy setting.')
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not update your privacy setting.')
    } finally {
      setPrivacyUpdating(false)
    }
  }

  return (
    <div className="space-y-5">
      {/* Privacy gate */}
      <div className="bg-muted/40 flex items-start justify-between gap-3 rounded-xl border p-3">
        <div className="min-w-0">
          <p className="text-foreground text-sm font-medium">Who can follow you</p>
          <p className="text-muted-foreground mt-1 text-xs">
            {followPrivacy === 'public'
              ? 'Anyone can follow you instantly.'
              : 'New followers ask first — you approve each one.'}
          </p>
        </div>
        <button
          type="button"
          className="btn-ghost min-h-9 shrink-0 rounded-full px-4 text-sm"
          disabled={privacyUpdating}
          onClick={() =>
            void togglePrivacy(followPrivacy === 'public' ? 'approval_required' : 'public')
          }
        >
          {privacyUpdating
            ? 'Saving…'
            : followPrivacy === 'public'
              ? 'Require approval'
              : 'Make public'}
        </button>
      </div>

      {/* Tab bar */}
      <div className="flex border-b">
        <button
          type="button"
          className={`px-4 py-2.5 text-sm font-medium transition-colors ${
            activeTab === 'following'
              ? 'border-foreground text-foreground border-b-2'
              : 'text-muted-foreground hover:text-foreground'
          }`}
          onClick={() => setActiveTab('following')}
        >
          Following
        </button>
        <button
          type="button"
          className={`px-4 py-2.5 text-sm font-medium transition-colors ${
            activeTab === 'followers'
              ? 'border-foreground text-foreground border-b-2'
              : 'text-muted-foreground hover:text-foreground'
          }`}
          onClick={() => setActiveTab('followers')}
        >
          Followers
        </button>
        <button
          type="button"
          className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium transition-colors ${
            activeTab === 'pending'
              ? 'border-foreground text-foreground border-b-2'
              : 'text-muted-foreground hover:text-foreground'
          }`}
          onClick={() => setActiveTab('pending')}
        >
          Pending
          {incomingRequests.length > 0 ? (
            <span className="bg-primary text-primary-foreground rounded-full px-1.5 py-0.5 text-xs leading-none">
              {incomingRequests.length}
            </span>
          ) : null}
        </button>
      </div>

      {error ? <p className="text-destructive text-sm font-medium">{error}</p> : null}

      {/* Following tab */}
      {activeTab === 'following' ? (
        <section>
          {loading ? (
            <p className="text-muted-foreground text-sm">Loading…</p>
          ) : following.length > 0 ? (
            <div className="space-y-3">
              {following.map((person) => (
                <PersonCard key={person.id} person={person} />
              ))}
            </div>
          ) : (
            <div className="py-2 text-center">
              <h2 className="font-serif text-xl font-semibold">
                Follow the people you trade facts with.
              </h2>
              <p className="text-muted-foreground mt-2 text-sm leading-6">
                When you follow someone, their questions and moments start showing up for you.
              </p>
            </div>
          )}
        </section>
      ) : null}

      {/* Followers tab */}
      {activeTab === 'followers' ? (
        <section>
          {loading ? (
            <p className="text-muted-foreground text-sm">Loading…</p>
          ) : followers.length > 0 ? (
            <div className="space-y-3">
              {followers.map((person) => (
                <PersonCard
                  key={person.id}
                  person={person}
                  action={
                    person.youFollow ? null : (
                      <button
                        type="button"
                        className="btn-ghost min-h-9 rounded-full px-4 text-sm"
                        disabled={Boolean(pendingRequest)}
                        onClick={() => void followBack(person.id)}
                      >
                        {pendingRequest === `${person.id}:follow` ? 'Following…' : 'Follow back'}
                      </button>
                    )
                  }
                />
              ))}
            </div>
          ) : (
            <p className="text-muted-foreground bg-muted rounded-xl px-3 py-2 text-sm">
              No one follows you yet.
            </p>
          )}
        </section>
      ) : null}

      {/* Pending tab */}
      {activeTab === 'pending' ? (
        <div className="space-y-6">
          {newDiscoveryCount && newDiscoveryCount > 0 ? (
            <Link
              href="/friends/find"
              className="bg-primary/5 ring-primary/20 hover:border-foreground/30 text-card-foreground block rounded-2xl border p-4 shadow-sm ring-1 transition"
            >
              <p className="text-foreground text-sm font-medium">
                ✨ {newDiscoveryCount} new{' '}
                {newDiscoveryCount === 1 ? 'contact is' : 'contacts are'} on Joshing.
              </p>
              <p className="text-muted-foreground mt-1 text-xs">→ Find friends</p>
            </Link>
          ) : (
            <Link
              href="/friends/find"
              className="bg-card hover:border-foreground/30 text-card-foreground block rounded-2xl border p-4 shadow-sm transition"
            >
              <p className="text-foreground text-sm font-medium">
                Find friends already on Joshing or invite someone new →
              </p>
            </Link>
          )}

          <section className="bg-card text-card-foreground rounded-2xl border p-4 shadow-sm">
            <h2 className="font-serif text-lg font-semibold">Follow requests</h2>
            {loading ? (
              <p className="text-muted-foreground mt-2 text-sm">Loading…</p>
            ) : incomingRequests.length > 0 ? (
              <div className="mt-3 space-y-3">
                {incomingRequests.map((request) => (
                  <article key={request.id} className="bg-background rounded-xl border p-3">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <h3 className="text-foreground font-medium">{request.requesterName}</h3>
                        {request.suggestedInterests.length > 0 ? (
                          <div className="mt-3 flex flex-wrap gap-2">
                            {request.suggestedInterests.map((interest) => (
                              <span
                                key={interest}
                                className="bg-primary/5 text-foreground border-primary/10 rounded-full border px-3 py-1 text-sm"
                              >
                                {interest}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <p className="text-muted-foreground mt-1 text-sm">
                            Wants to follow you.
                          </p>
                        )}
                        {request.personalNote ? (
                          <blockquote className="border-primary/30 text-muted-foreground mt-3 border-l-2 pl-3 text-sm italic">
                            “{request.personalNote}”
                          </blockquote>
                        ) : null}
                      </div>

                      <div className="grid grid-cols-2 gap-2 sm:min-w-48">
                        <button
                          type="button"
                          className="btn-primary min-h-11 rounded-full"
                          disabled={Boolean(pendingRequest)}
                          onClick={() => void updateRequest(request.id, 'accept')}
                        >
                          {pendingRequest === `${request.id}:accept` ? 'Approving…' : 'Approve'}
                        </button>
                        <button
                          type="button"
                          className="btn-ghost min-h-11 rounded-full"
                          disabled={Boolean(pendingRequest)}
                          onClick={() => void updateRequest(request.id, 'ignore')}
                        >
                          {pendingRequest === `${request.id}:ignore` ? 'Setting aside…' : 'Not now'}
                        </button>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <p className="text-muted-foreground bg-muted mt-2 rounded-xl px-3 py-2 text-sm">
                No follow requests right now.
              </p>
            )}
          </section>

          {outboundRequests.length > 0 ? (
            <section className="bg-card text-card-foreground rounded-2xl border p-4 shadow-sm">
              <h2 className="font-serif text-lg font-semibold">Sent requests</h2>
              <p className="text-muted-foreground mt-1 text-sm">Waiting on their approval.</p>
              <div className="mt-3 space-y-3">
                {outboundRequests.map((request) => (
                  <article key={request.id} className="bg-background rounded-xl border p-3">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <h3 className="text-foreground font-medium">{request.recipientName}</h3>
                        <p className="text-muted-foreground/70 mt-1 text-xs">
                          sent {formatRelativeTime(request.createdAt)}
                        </p>
                        {request.personalNote ? (
                          <blockquote className="border-primary/30 text-muted-foreground mt-3 border-l-2 pl-3 text-sm italic">
                            “{request.personalNote}”
                          </blockquote>
                        ) : null}
                      </div>
                      <button
                        type="button"
                        className="btn-ghost min-h-9 self-start rounded-full px-4 text-sm"
                        disabled={Boolean(pendingRequest)}
                        onClick={() => void cancelOutbound(request.id)}
                      >
                        {pendingRequest === `${request.id}:cancel` ? 'Cancelling…' : 'Cancel'}
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          ) : null}

          <PeopleYouInvited />
        </div>
      ) : null}
    </div>
  )
}
