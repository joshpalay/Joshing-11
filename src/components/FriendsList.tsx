'use client'

import Link from 'next/link'
import PeopleYouInvited from '@/components/PeopleYouInvited'
import { useCallback, useEffect, useState } from 'react'

type Tab = 'friends' | 'requests' | 'sent'

type Friend = {
  id: string
  displayName: string
  declaredInterests: string[]
  sharedInterests: string[]
}

type IncomingRequest = {
  id: string
  requesterId: string
  requesterName: string
  suggestedInterests: string[]
  createdAt: string
}

type FriendsHubResponse = {
  ok: boolean
  friends: Friend[]
  incomingRequests: IncomingRequest[]
}

type RequestAction = 'accept' | 'ignore'

function previewInterests(interests: string[]) {
  if (interests.length === 0) return null
  return interests.slice(0, 5).join(', ')
}

export default function FriendsList() {
  const [friends, setFriends] = useState<Friend[]>([])
  const [incomingRequests, setIncomingRequests] = useState<IncomingRequest[]>(
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
            activeTab === 'requests'
              ? 'border-b-2 border-foreground text-foreground'
              : 'text-muted-foreground hover:text-foreground'
          }`}
          onClick={() => setActiveTab('requests')}
        >
          Requests
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

      {/* Requests tab */}
      {activeTab === 'requests' ? (
        <section className="bg-card text-card-foreground rounded-2xl border p-4 shadow-sm">
          {loading ? (
            <p className="text-muted-foreground text-sm">Loading requests…</p>
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
              No incoming requests right now.
            </p>
          )}
        </section>
      ) : null}

      {/* Sent tab */}
      {activeTab === 'sent' ? <PeopleYouInvited /> : null}
    </div>
  )
}
