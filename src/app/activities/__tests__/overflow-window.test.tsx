import { beforeEach, describe, expect, it, vi } from 'vitest'

// B-HOME-OVERFLOW-WINDOW-03 — the "See all activity →" portal (/activities, the
// Lately full view) is bounded to the same rolling home window as the edition.
// The standalone Activities tab (PRD §8.15, /api/activities → getActivitiesForUser)
// keeps its own 90-day cutoff; that caller is asserted untouched in
// src/app/api/activities/__tests__/route.test.ts.

const { getSessionMock, buildActivityStreamMock, getUserByIdMock } = vi.hoisted(() => ({
  getSessionMock: vi.fn(),
  buildActivityStreamMock: vi.fn(),
  getUserByIdMock: vi.fn(),
}))

vi.mock('@/server/auth/session', () => ({ getSession: getSessionMock }))
vi.mock('@/server/activity/build-stream', () => ({ buildActivityStream: buildActivityStreamMock }))
vi.mock('@/server/db/queries/users', () => ({ getUserById: getUserByIdMock }))
vi.mock('@/components/activity/ActivityStream', () => ({ ActivityStream: () => null }))
vi.mock('@/app/activities/MarkActivitiesRead', () => ({ MarkActivitiesRead: () => null }))

import ActivitiesPage from '@/app/activities/page'
import { HOME_WINDOW_DAYS } from '@/server/home/select-edition'

describe('/activities — "See all activity" overflow portal is 7-day windowed', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getSessionMock.mockResolvedValue({ userId: 'u1' })
    buildActivityStreamMock.mockResolvedValue([])
    getUserByIdMock.mockResolvedValue({ timezone: 'UTC' })
  })

  it('builds the stream bounded to the rolling home window', async () => {
    await ActivitiesPage()
    expect(buildActivityStreamMock).toHaveBeenCalledWith('u1', { windowDays: HOME_WINDOW_DAYS })
  })
})
