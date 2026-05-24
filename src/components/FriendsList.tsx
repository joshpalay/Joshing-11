'use client'

import Link from 'next/link'
import PeopleYouInvited from '@/components/PeopleYouInvited'
import { formatRelativeTime } from '@/components/feed/visual'
import { useCallback, useEffect, useState } from 'react'

type Tab = 'friends' | 'invitations' | 'sent'

type Friend = {
  id: string
  displayName: string
  declaredInterests: string[]
  sharedInterests: string[]
  lastActiveAt: string | null
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

type FriendsHubResponse = {
  ok: boolean
  friends: Friend[]
  incomingRequests: IncomingRequest[]
  outboundRequests: OutboundRequest[]
}

type RequestAction = 'accept' | 'ignore'

function previewInterests(interests: string[]) {
  if (interests.length === 0) return null
  return interests.join(', ')
}

export default function FriendsList() {
  const [friends, setFriends] = useState<Friend[]>([])
  const [incomingRequests, setIncomingRequests] = useState<IncomingRequest[]>(
    []
  )
  const [outboundRequests, setOutboundRequests] = useState<OutboundRequest[]>(
    []
  )
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [pendingRequest, setPendingRequest] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<Tab>('friends')

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

      if (!response.ok || !body || !('friends' in body)) {
        throw new Error(
          body && 'message' in body && body.message
            ? body.message
            : 'Could not load friends.'
        )
      }

      setFriends(body.friends)
      setIncomingRequests(body.incomingRequests)
      setOutboundRequests(body.outboundRequests ?? [])
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Could not load friends.'
      )
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    queueMicrotask(() => void loadFriends())
  }, [loadFriends])

  async function updateRequest(requestId: string, action: RequestAction) {
    setPendingRequest(`${requestId}:${action}`)
    setError(null)

    try {
      const response = await fetch(
        `/api/friend-requests/${requestId}/${action}`,
        {
          method: 'POST',
          credentials: 'include',
        }
      )
      const body = (await response.json().catch(() => null)) as {
        message?: string
      } | null

      if (!response.ok) {
        throw new Error(body?.message ?? 'Could not update this request.')
      }

      await loadFriends()
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Could not update this request.'
      )
    } finally {
      setPendingRequest(null)
    }
  }

  async function cancelOutbound(requestId: string) {
    setPendingRequest(`${requestId}:cancel`)
    setError(null)
    // Optimistic: remove the row immediately; restore on error.
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
      setError(
        caught instanceof Error
          ? caught.message
          : 'Could not cancel this request.'
      )
    } finally {
      setPendingRequest(null)
    }
  }

  return (
    <div className="space-y-5">
      {/* Tab bar */}
      <div className="flex border-b">
        <button
          type="button"
          className={`px-4 py-2.5 text-sm font-medium transition-colors ${
            activeTab === 'friends'
              ? 'border-b-2 border-foreground text-foreground'
              : 'text-muted-foreground hover:text-foreground'
          }`}
          onClick={() => setActiveTab('friends')}
        >
          Friends
        </button>
        <button
          type="button"
          className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium transition-colors ${
            activeTab === 'invitations'
              ? 'border-b-2 border-foreground text-foreground'
              : 'text-muted-foreground hover:text-foreground'
          }`}
          onClick={() => setActiveTab('invitations')}
        >
          Invitations
          {incomingRequests.length > 0 ? (
            <span className="bg-primary text-primary-foreground rounded-full px-1.5 py-0.5 text-xs leading-none">
              {incomingRequests.length}
            </span>
          ) : null}
        </button>
        <button
          type="button"
          className={`px-4 py-2.5 text-sm font-medium transition-colors ${
            activeTab === 'sent'
              ? 'border-b-2 border-foreground text-foreground'
              : 'text-muted-foreground hover:text-foreground'
          }`}
          onClick={() => setActiveTab('sent')}
        >
          Sent
        </button>
      </div>

      {/* Friends tab */}
      {activeTab === 'friends' ? (
        <section>
          {error ? (
            <p className="text-destructive mb-3 text-sm font-medium">{error}</p>
          ) : null}

          {loading ? (
            <p className="text-muted-foreground text-sm">Loading friends…</p>
          ) : friends.length > 0 ? (
            <div className="space-y-3">
              {friends.map((friend) => {
                const interests = previewInterests(friend.declaredInterests)
                const sharedInterest = friend.sharedInterests[0]
                const lastActiveLabel = friend.lastActiveAt
                  ? formatRelativeTime(friend.lastActiveAt)
                  : null

                return (
                  <Link
                    key={friend.id}
                    href={`/users/${friend.id}`}
                    className="bg-background hover:border-foreground/30 block rounded-xl border p-3 transition hover:shadow-sm"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h3 className="text-primary font-medium underline decoration-primary/40 underline-offset-4 hover:decoration-primary">
                          {friend.displayName}
                        </h3>
                        {interests ? (
                          <p className="text-muted-foreground mt-1 text-sm leading-6">
                            A mind into {interests}
                          </p>
                        ) : (
                          <p className="text-muted-foreground mt-1 text-sm leading-6">
                            Interests will appear here as they declare them.
                          </p>
                        )}
                        {lastActiveLabel ? (
                          <p className="text-muted-foreground/70 mt-1 text-xs">
                            Active {lastActiveLabel}
                          </p>
                        ) : null}
                      </div>
                      {sharedInterest ? (
                        <span className="bg-muted text-foreground shrink-0 rounded-full px-3 py-1 text-xs font-medium">
                          Shared: {sharedInterest}
                        </span>
                      ) : null}
                    </div>
                  </Link>
                )
              })}
            </div>
          ) : (
            <div className="py-2 text-center">
              <h2 className="font-serif text-xl font-semibold">
                Joshing gets better when your people are here.
              </h2>
              <p className="text-muted-foreground mt-2 text-sm leading-6">
                Invite someone you already trade facts, recommendations, and
                inside jokes with.
              </p>
            </div>
          )}
        </section>
      ) : null}

      {/* Invitations tab */}
      {activeTab === 'invitations' ? (
        <section className="bg-card text-card-foreground rounded-2xl border p-4 shadow-sm">
          {loading ? (
            <p className="text-muted-foreground text-sm">Loading invitations…</p>
          ) : incomingRequests.length > 0 ? (
            <div className="space-y-3">
              {incomingRequests.map((request) => (
                <article
                  key={request.id}
                  className="bg-background rounded-xl border p-3"
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <h3 className="text-foreground font-medium">
                        {request.requesterName}
                      </h3>
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
                          No ideas attached — just a friendly hello.
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
                        onClick={() =>
                          void updateRequest(request.id, 'accept')
                        }
                      >
                        {pendingRequest === `${request.id}:accept`
                          ? 'Accepting…'
                          : 'Accept'}
                      </button>
                      <button
                        type="button"
                        className="btn-ghost min-h-11 rounded-full"
                        disabled={Boolean(pendingRequest)}
                        onClick={() =>
                          void updateRequest(request.id, 'ignore')
                        }
                      >
                        {pendingRequest === `${request.id}:ignore`
                          ? 'Setting aside…'
                          : 'Not now'}
                      </button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <p className="text-muted-foreground bg-muted rounded-xl px-3 py-2 text-sm">
              No incoming invitations right now.
            </p>
          )}
        </section>
      ) : null}

      {/* Sent tab */}
      {activeTab === 'sent' ? (
        <div className="space-y-6">
          {outboundRequests.length > 0 ? (
            <section className="bg-card text-card-foreground rounded-2xl border p-4 shadow-sm">
              <h2 className="font-serif text-lg font-semibold">
                Sent friend requests
              </h2>
              <p className="text-muted-foreground mt-1 text-sm">
                Waiting on a reply. They expire after 30 days.
              </p>
              <div className="mt-3 space-y-3">
                {outboundRequests.map((request) => (
                  <article
                    key={request.id}
                    className="bg-background rounded-xl border p-3"
                  >
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <h3 className="text-foreground font-medium">
                          {request.recipientName}
                        </h3>
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
                        {pendingRequest === `${request.id}:cancel`
                          ? 'Cancelling…'
                          : 'Cancel'}
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
