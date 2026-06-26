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
  deriveVisibleRequests,
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

// The component's success/failure transitions are pure: on ok the acted id is
// added to the optimistically-removed set; on failure the list is untouched and
// the error surfaced. The visible set is then derived from props minus that set
// (deriveVisibleRequests), which is what keeps this card in lockstep with the
// same request's Recent Activity duplicate across a router.refresh(). Mirror
// that here so a green action test can't mask a broken consumer.
describe('FriendRequestsSection state transitions', () => {
  it('removes the acted card and decrements the count on success', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(true, { ok: true }))
    const initial = { top: [request('a'), request('b'), request('c')], totalCount: 5 }
    const removed = new Set<string>()

    const result = await submitFriendRequestAction('b', 'accept', 'nope', fetchImpl as typeof fetch)
    if (result.ok) removed.add('b')

    const { requests, totalCount } = deriveVisibleRequests(initial, removed)
    expect(requests.map((r) => r.id)).toEqual(['a', 'c'])
    expect(totalCount).toBe(4)
  })

  it('keeps the card and surfaces the error on failure', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(false, { message: 'Try again.' }))
    const initial = { top: [request('a'), request('b')], totalCount: 2 }
    const removed = new Set<string>()
    let error: string | null = null

    const result = await submitFriendRequestAction('b', 'ignore', 'nope', fetchImpl as typeof fetch)
    if (!result.ok) error = result.message
    else removed.add('b')

    const { requests } = deriveVisibleRequests(initial, removed)
    expect(requests.map((r) => r.id)).toEqual(['a', 'b'])
    expect(error).toBe('Try again.')
  })
})

// The cross-surface sync fix: visible cards are DERIVED from the latest server
// props minus locally-cleared ids — not seeded into useState — so a
// router.refresh() triggered by accepting/declining the same request in the
// Recent Activity feed (which re-renders this section with fresh props) clears
// this card too, instead of stranding a stale one with dead buttons.
describe('deriveVisibleRequests', () => {
  it('returns all props verbatim when nothing has been cleared', () => {
    const initial = { top: [request('a'), request('b')], totalCount: 4 }
    const { requests, totalCount } = deriveVisibleRequests(initial, new Set())
    expect(requests.map((r) => r.id)).toEqual(['a', 'b'])
    expect(totalCount).toBe(4)
  })

  it('hides a locally-cleared id and decrements the overflow total', () => {
    const initial = { top: [request('a'), request('b'), request('c')], totalCount: 5 }
    const { requests, totalCount } = deriveVisibleRequests(initial, new Set(['b']))
    expect(requests.map((r) => r.id)).toEqual(['a', 'c'])
    expect(totalCount).toBe(4)
  })

  it('treats a cleared id as a no-op once the refresh drops it from props', () => {
    // Simulates the post-router.refresh() render: the server already dropped 'b'
    // from `top` and decremented `totalCount`, while the removed set still holds
    // 'b'. The stale set entry must not double-decrement the count.
    const initial = { top: [request('a'), request('c')], totalCount: 4 }
    const { requests, totalCount } = deriveVisibleRequests(initial, new Set(['b']))
    expect(requests.map((r) => r.id)).toEqual(['a', 'c'])
    expect(totalCount).toBe(4)
  })

  it('never reports a negative total', () => {
    const initial = { top: [request('a')], totalCount: 0 }
    const { totalCount } = deriveVisibleRequests(initial, new Set(['a']))
    expect(totalCount).toBe(0)
  })
})
