import { describe, expect, it, vi } from 'vitest'

vi.mock('@/server/db', () => ({ db: {} }))

import { selectAcceptedRequestNotice } from '@/server/db/queries/activity'

const row = (id: string, actorUserId: string | null, minutesAgo: number, actorDisplayName: string | null = actorUserId) => ({
  id,
  actorUserId,
  createdAt: new Date(Date.UTC(2026, 9, 10, 12, 0) - minutesAgo * 60_000),
  actorDisplayName,
})

describe('selectAcceptedRequestNotice — home "said yes" card', () => {
  it('lists each accepter once, newest first, and keeps every row id for dismissal', () => {
    const notice = selectAcceptedRequestNotice(
      [row('a1', 'chiann', 30, 'Chiann'), row('b1', 'tre', 5, 'Tre'), row('a2', 'chiann', 10, 'Chiann')],
      new Set(),
      new Set(['chiann', 'tre']),
    )
    expect(notice.friends).toEqual([
      { userId: 'tre', name: 'Tre' },
      { userId: 'chiann', name: 'Chiann' },
    ])
    expect(notice.activityIds.sort()).toEqual(['a1', 'a2', 'b1'])
  })

  it('drops accepters who are no longer friends, are blocked, or are gone', () => {
    const notice = selectAcceptedRequestNotice(
      [row('a', 'unfriended', 1), row('b', 'blocked', 2), row('c', null, 3), row('d', 'chiann', 4, 'Chiann')],
      new Set(['blocked']),
      new Set(['blocked', 'chiann']),
    )
    expect(notice.friends).toEqual([{ userId: 'chiann', name: 'Chiann' }])
    expect(notice.activityIds).toEqual(['d'])
  })

  it('falls back to a friendly name when the accepter has no display name', () => {
    const notice = selectAcceptedRequestNotice([row('a', 'x', 1, null)], new Set(), new Set(['x']))
    expect(notice.friends[0].name).toBe('Your friend')
  })
})
