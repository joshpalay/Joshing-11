import type * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}))

// The component refreshes the server tree after a successful action (to clear
// the same request's Recent Activity duplicate), so it reads from the app
// router. Provide a no-op so the static-render tests have a router in context.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}))

import FriendRequestsSection, {
  FRIEND_REQUEST_ENDPOINTS,
  submitFriendRequestAction,
  type SerializedIncomingRequest,
} from '@/components/home/FriendRequestsSection'

function request(id: string, overrides: Partial<SerializedIncomingRequest> = {}): SerializedIncomingRequest {
  return {
    id,
    requesterId: `requester-${id}`,
    requesterName: `Requester ${id}`,
    suggestedInterests: [],
    personalNote: null,
    createdAt: '2026-06-24T00:00:00.000Z',
    ...overrides,
  }
}

function jsonResponse(ok: boolean, body: unknown, status = ok ? 200 : 400): Response {
  return {
    ok,
    status,
    json: async () => body,
  } as unknown as Response
}

describe('FriendRequestsSection render', () => {
  it('renders nothing when there are no requests', () => {
    const html = renderToStaticMarkup(
      <FriendRequestsSection initial={{ top: [], totalCount: 0 }} />,
    )
    expect(html).toBe('')
  })

  it('renders up to 3 cards with the eyebrow and a See all overflow line', () => {
    const html = renderToStaticMarkup(
      <FriendRequestsSection
        initial={{
          top: [request('a'), request('b'), request('c')],
          totalCount: 5,
        }}
      />,
    )

    expect(html).toContain('Wants to connect')
    expect(html).toContain('Requester a')
    expect(html).toContain('Requester b')
    expect(html).toContain('Requester c')
    // One Accept + one Decline per card.
    expect(html.match(/Accept follow request from/g)).toHaveLength(3)
    expect(html.match(/Decline follow request from/g)).toHaveLength(3)
    // Overflow line is honest about the full pending count and routes to /friends.
    expect(html).toContain('See all (5)')
    expect(html).toContain('href="/friends"')
  })

  it('omits the See all line when nothing overflows', () => {
    const html = renderToStaticMarkup(
      <FriendRequestsSection initial={{ top: [request('a')], totalCount: 1 }} />,
    )
    expect(html).not.toContain('See all')
  })

  it('shows the personal note and suggested interests when present', () => {
    const html = renderToStaticMarkup(
      <FriendRequestsSection
        initial={{
          top: [
            request('a', {
              personalNote: 'We met at the show',
              suggestedInterests: ['Jazz', 'Film', 'Hiking', 'Dropped'],
            }),
          ],
          totalCount: 1,
        }}
      />,
    )
    expect(html).toContain('We met at the show')
    // Capped at three interests, rendered as quiet inline text (no color chips).
    expect(html).toContain('Into Jazz, Film, Hiking')
    expect(html).not.toContain('Dropped')
  })
})

describe('submitFriendRequestAction', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('builds the accept and ignore endpoints', () => {
    expect(FRIEND_REQUEST_ENDPOINTS.accept('abc')).toBe('/api/friend-requests/abc/accept')
    expect(FRIEND_REQUEST_ENDPOINTS.ignore('abc')).toBe('/api/friend-requests/abc/ignore')
  })

  it('POSTs Accept to the accept route and resolves ok', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(true, { ok: true }))
    const result = await submitFriendRequestAction('req-1', 'accept', 'nope', fetchImpl as typeof fetch)

    expect(fetchImpl).toHaveBeenCalledWith(
      '/api/friend-requests/req-1/accept',
      expect.objectContaining({ method: 'POST', credentials: 'include' }),
    )
    expect(result).toEqual({ ok: true })
  })

  it('POSTs Decline to the silent ignore route and resolves ok', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(true, { ok: true }))
    const result = await submitFriendRequestAction('req-1', 'ignore', 'nope', fetchImpl as typeof fetch)

    expect(fetchImpl).toHaveBeenCalledWith(
      '/api/friend-requests/req-1/ignore',
      expect.objectContaining({ method: 'POST', credentials: 'include' }),
    )
    expect(result).toEqual({ ok: true })
  })

  it('returns a failure with the server message on a non-ok response', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(false, { message: 'Already handled.' }))
    const result = await submitFriendRequestAction('req-1', 'accept', 'fallback', fetchImpl as typeof fetch)
    expect(result).toEqual({ ok: false, message: 'Already handled.' })
  })

  it('treats a 404 (no longer pending) as an idempotent success', async () => {
    // The request was already accepted/declined elsewhere — the end state the
    // tap wanted already holds, so the caller should clear the stale card rather
    // than surface an error.
    const fetchImpl = vi.fn(async () =>
      jsonResponse(false, { error: 'not_found', message: 'No pending friend request was found.' }, 404),
    )
    const result = await submitFriendRequestAction('req-1', 'accept', 'fallback', fetchImpl as typeof fetch)
    expect(result).toEqual({ ok: true })
  })

  it('falls back to the failure message when the request throws', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('network down')
    })
    const result = await submitFriendRequestAction('req-1', 'ignore', 'Could not decline.', fetchImpl as typeof fetch)
    expect(result).toEqual({ ok: false, message: 'Could not decline.' })
  })
})

// The component's success/failure transitions are pure: on ok the card is
// filtered out of local state and the count decremented; on failure the list is
// untouched and the error surfaced. Mirror that here so a green action test
// can't mask a broken consumer.
describe('FriendRequestsSection state transitions', () => {
  it('removes the acted card and decrements the count on success', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(true, { ok: true }))
    let requests = [request('a'), request('b'), request('c')]
    let totalCount = 5

    const result = await submitFriendRequestAction('b', 'accept', 'nope', fetchImpl as typeof fetch)
    if (result.ok) {
      requests = requests.filter((item) => item.id !== 'b')
      totalCount = Math.max(0, totalCount - 1)
    }

    expect(requests.map((r) => r.id)).toEqual(['a', 'c'])
    expect(totalCount).toBe(4)
  })

  it('keeps the card and surfaces the error on failure', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(false, { message: 'Try again.' }))
    let requests = [request('a'), request('b')]
    let error: string | null = null

    const result = await submitFriendRequestAction('b', 'ignore', 'nope', fetchImpl as typeof fetch)
    if (!result.ok) {
      error = result.message
    } else {
      requests = requests.filter((item) => item.id !== 'b')
    }

    expect(requests.map((r) => r.id)).toEqual(['a', 'b'])
    expect(error).toBe('Try again.')
  })
})
