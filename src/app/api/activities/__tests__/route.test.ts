import { beforeEach, describe, expect, it, vi } from 'vitest'

// B-HOME-OVERFLOW-WINDOW-03 — guard the OTHER getActivitiesForUser caller. The
// standalone Activities tab (PRD §8.15) keeps its own 90-day cutoff: this route
// must invoke getActivitiesForUser with NO window argument, so the home overflow
// narrowing never globally narrows the Activities tab.

const { getSessionMock, getActivitiesForUserMock, getUnreadCountMock } = vi.hoisted(() => ({
  getSessionMock: vi.fn(),
  getActivitiesForUserMock: vi.fn(),
  getUnreadCountMock: vi.fn(),
}))

vi.mock('@/server/auth/session', () => ({ getSession: getSessionMock }))
vi.mock('@/server/db/queries/activity', () => ({
  getActivitiesForUser: getActivitiesForUserMock,
  getUnreadCount: getUnreadCountMock,
}))

import { GET } from '@/app/api/activities/route'

describe('GET /api/activities — standalone Activities tab is NOT windowed to 7d', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getSessionMock.mockResolvedValue({ userId: 'u1' })
    getActivitiesForUserMock.mockResolvedValue([])
    getUnreadCountMock.mockResolvedValue(0)
  })

  it('queries activities with no window argument (keeps the default 90-day cutoff)', async () => {
    await GET()
    expect(getActivitiesForUserMock).toHaveBeenCalledWith('u1')
    // No second argument → getActivitiesForUser falls back to its 90-day cutoff.
    expect(getActivitiesForUserMock.mock.calls[0]).toHaveLength(1)
  })
})
