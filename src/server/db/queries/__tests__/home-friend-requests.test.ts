import { describe, expect, it } from 'vitest'

import {
  HOME_FRIEND_REQUESTS_LIMIT,
  selectHomeFriendRequests,
  type IncomingFollowRequest,
} from '@/server/db/queries/friends'

function request(id: string, createdAt: string): IncomingFollowRequest {
  return {
    id,
    requesterId: `requester-${id}`,
    requesterName: `Requester ${id}`,
    suggestedInterests: [],
    personalNote: null,
    createdAt: new Date(createdAt),
  }
}

describe('selectHomeFriendRequests', () => {
  it('returns an empty top and zero count when there are no requests', () => {
    expect(selectHomeFriendRequests([])).toEqual({ top: [], totalCount: 0 })
  })

  it('caps top at the limit while reporting the full pending count', () => {
    const requests = [
      request('a', '2026-06-20T00:00:00.000Z'),
      request('b', '2026-06-21T00:00:00.000Z'),
      request('c', '2026-06-22T00:00:00.000Z'),
      request('d', '2026-06-23T00:00:00.000Z'),
      request('e', '2026-06-24T00:00:00.000Z'),
    ]

    const result = selectHomeFriendRequests(requests)

    expect(HOME_FRIEND_REQUESTS_LIMIT).toBe(3)
    expect(result.top).toHaveLength(3)
    expect(result.totalCount).toBe(5)
  })

  it('orders top most-recent-first regardless of input order', () => {
    const requests = [
      request('oldest', '2026-06-20T00:00:00.000Z'),
      request('newest', '2026-06-24T00:00:00.000Z'),
      request('middle', '2026-06-22T00:00:00.000Z'),
    ]

    const result = selectHomeFriendRequests(requests)

    expect(result.top.map((r) => r.id)).toEqual(['newest', 'middle', 'oldest'])
  })

  it('does not mutate the caller-supplied array', () => {
    const requests = [
      request('a', '2026-06-20T00:00:00.000Z'),
      request('b', '2026-06-24T00:00:00.000Z'),
    ]
    const order = requests.map((r) => r.id)

    selectHomeFriendRequests(requests)

    expect(requests.map((r) => r.id)).toEqual(order)
  })
})
