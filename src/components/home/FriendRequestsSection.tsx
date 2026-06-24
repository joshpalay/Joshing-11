'use client'

import Link from 'next/link'
import { useState } from 'react'

// Serialized at the RSC boundary: createdAt is an ISO string (mirrors how the
// other home sections hand dates to their client components).
export type SerializedIncomingRequest = {
  id: string
  requesterId: string
  requesterName: string
  suggestedInterests: string[]
  personalNote: string | null
  createdAt: string
}

export type FriendRequestAction = 'accept' | 'ignore'

// Accept and Decline reuse the existing routes — Accept → the accept route,
// Decline → the silent `ignore` route (no requester notification). Kept as
// literal builders (not a `${action}` template) so each endpoint is explicit.
export const FRIEND_REQUEST_ENDPOINTS: Record<FriendRequestAction, (id: string) => string> = {
  accept: (id) => `/api/friend-requests/${id}/accept`,
  ignore: (id) => `/api/friend-requests/${id}/ignore`,
}

// POSTs to the request route and normalizes the result. Exported so the action
// path is unit-testable without a DOM (the repo's component convention).
export async function submitFriendRequestAction(
  id: string,
  action: FriendRequestAction,
  failureMessage: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    const response = await fetchImpl(FRIEND_REQUEST_ENDPOINTS[action](id), {
      method: 'POST',
      credentials: 'include',
    })
    const body = (await response.json().catch(() => null)) as { message?: string } | null
    if (!response.ok) {
      return { ok: false, message: body?.message ?? failureMessage }
    }
    return { ok: true }
  } catch {
    return { ok: false, message: failureMessage }
  }
}

type FriendRequestsSectionProps = {
  initial: {
    top: SerializedIncomingRequest[]
    totalCount: number
  }
}

// Quiet outline/text button — distinguished from the filled Accept by shape and
// weight (border + lighter weight), never by color alone (canon tripwire).
const DECLINE_BUTTON_CLASS = [
  'inline-flex min-h-11 items-center justify-center rounded-[var(--radius-xs)]',
  'border border-[var(--brand-border)] bg-transparent px-4 py-2 text-sm font-medium text-[var(--brand-ink)]',
  'transition hover:bg-[var(--brand-card)]',
  'focus-visible:ring-ring focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none',
  'disabled:pointer-events-none disabled:opacity-45',
].join(' ')

function interestPreview(interests: string[]): string | null {
  const cleaned = interests.map((interest) => interest.trim()).filter(Boolean).slice(0, 3)
  if (cleaned.length === 0) return null
  return cleaned.join(', ')
}

function RequestCard({
  request,
  busy,
  disabled,
  onAccept,
  onDecline,
}: {
  request: SerializedIncomingRequest
  busy: boolean
  disabled: boolean
  onAccept: (request: SerializedIncomingRequest) => void
  onDecline: (request: SerializedIncomingRequest) => void
}) {
  const note = request.personalNote?.trim()
  const interests = interestPreview(request.suggestedInterests)

  return (
    <article className="rounded-[var(--radius-xs)] border border-[var(--brand-border)] bg-[var(--feed-card-elevated)] p-4 shadow-[var(--shadow-card)]">
      {/* Requester is always a real human (requesterName) — no house/LLM author
          can reach this surface by construction. */}
      <h3 className="font-semibold text-[var(--brand-ink)]">{request.requesterName}</h3>

      {note ? (
        <p className="mt-1 truncate text-sm text-[var(--brand-ink-400)]">“{note}”</p>
      ) : null}

      {interests ? (
        <p className="mt-1 truncate text-sm text-[var(--brand-ink-400)]">Into {interests}</p>
      ) : null}

      <div className="mt-4 flex items-center gap-3">
        <button
          type="button"
          className="btn-primary flex-1"
          onClick={() => onAccept(request)}
          disabled={disabled}
          aria-busy={busy}
          aria-label={`Accept follow request from ${request.requesterName}`}
        >
          {busy ? 'Working…' : 'Accept'}
        </button>
        <button
          type="button"
          className={DECLINE_BUTTON_CLASS}
          onClick={() => onDecline(request)}
          disabled={disabled}
          aria-busy={busy}
          aria-label={`Decline follow request from ${request.requesterName}`}
        >
          Decline
        </button>
      </div>
    </article>
  )
}

export default function FriendRequestsSection({ initial }: FriendRequestsSectionProps) {
  const [requests, setRequests] = useState<SerializedIncomingRequest[]>(initial.top)
  const [totalCount, setTotalCount] = useState(initial.totalCount)
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Zero-state is invisible: this section simply isn't rendered when there are
  // no pending requests (quiet over loud — no empty chrome).
  if (requests.length === 0) return null

  async function actOnRequest(
    request: SerializedIncomingRequest,
    action: FriendRequestAction,
    failureMessage: string,
  ) {
    setPendingId(request.id)
    setError(null)

    const result = await submitFriendRequestAction(request.id, action, failureMessage)

    if (result.ok) {
      // Success: remove the card and decrement the local pending total so the
      // "See all" overflow line stays honest as cards clear.
      setRequests((current) => current.filter((item) => item.id !== request.id))
      setTotalCount((current) => Math.max(0, current - 1))
    } else {
      // Failure: the card stays put and we surface an inline error.
      setError(result.message)
    }

    setPendingId(null)
  }

  function acceptRequest(request: SerializedIncomingRequest) {
    void actOnRequest(request, 'accept', 'Could not accept this request.')
  }

  // Decline is the silent decline (the existing `ignore` route): no requester
  // notification, no confirm dialog, no hide-but-keep-alive state.
  function declineRequest(request: SerializedIncomingRequest) {
    void actOnRequest(request, 'ignore', 'Could not decline this request.')
  }

  const showOverflow = totalCount > requests.length

  return (
    <section aria-labelledby="home-friend-requests-heading" className="space-y-3">
      <h2
        id="home-friend-requests-heading"
        className="text-[13px] font-bold tracking-[0.1em] text-[var(--brand-ink-400)] uppercase"
      >
        Wants to connect
      </h2>

      {error ? (
        <p role="alert" className="text-sm font-medium text-[var(--brand-ink)]">
          {error}
        </p>
      ) : null}

      <div className="space-y-3">
        {requests.map((request) => (
          <RequestCard
            key={request.id}
            request={request}
            busy={pendingId === request.id}
            disabled={pendingId !== null}
            onAccept={acceptRequest}
            onDecline={declineRequest}
          />
        ))}
      </div>

      {showOverflow ? (
        <Link
          href="/friends"
          className="focus-visible:ring-ring inline-flex text-sm font-medium text-[var(--brand-ink-400)] underline-offset-4 hover:underline focus-visible:rounded focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
        >
          See all ({totalCount}) →
        </Link>
      ) : null}
    </section>
  )
}
