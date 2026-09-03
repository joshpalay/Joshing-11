import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getInviterForUserMock } = vi.hoisted(() => ({
  getInviterForUserMock: vi.fn(),
}))

// Only the DB-touching resolver is mocked. normalizePersonName is imported
// for real — it's a pure string helper, safe even though it lives in
// @/server/db/queries/users (vitest.setup.ts stubs DATABASE_URL so that
// module's top-level `db` init doesn't throw at import).
vi.mock('@/server/db/queries/friend-invitations', () => ({
  getInviterForUser: getInviterForUserMock,
}))

import { getWelcomeInviterName } from '@/server/home/welcome-inviter-name'

describe('getWelcomeInviterName', () => {
  beforeEach(() => {
    getInviterForUserMock.mockReset()
  })

  it('returns null without querying when the tour is not active', async () => {
    const result = await getWelcomeInviterName(false, 'user-1')
    expect(result).toBeNull()
    expect(getInviterForUserMock).not.toHaveBeenCalled()
  })

  it('returns null without querying when there is no session (userId null)', async () => {
    const result = await getWelcomeInviterName(true, null)
    expect(result).toBeNull()
    expect(getInviterForUserMock).not.toHaveBeenCalled()
  })

  it('resolves and normalizes the inviter name when one exists (named or link — getInviterForUser already merges both)', async () => {
    getInviterForUserMock.mockResolvedValueOnce({
      inviterUserId: 'inviter-1',
      inviterName: '  Jaime   Rivera  ',
      sourceId: 'follow-1',
      sourceType: 'follow',
    })

    const result = await getWelcomeInviterName(true, 'user-1')

    expect(getInviterForUserMock).toHaveBeenCalledWith('user-1')
    // normalizePersonName trims + collapses internal whitespace.
    expect(result).toBe('Jaime Rivera')
  })

  it('returns null (WelcomeTourScreen\'s own "a friend" fallback applies) when there is no inviter', async () => {
    getInviterForUserMock.mockResolvedValueOnce(null)

    const result = await getWelcomeInviterName(true, 'user-1')

    expect(result).toBeNull()
  })

  it('returns null when the inviter has no display name set', async () => {
    getInviterForUserMock.mockResolvedValueOnce({
      inviterUserId: 'inviter-1',
      inviterName: null,
      sourceId: 'inv-1',
      sourceType: 'friend_invitation',
    })

    const result = await getWelcomeInviterName(true, 'user-1')

    expect(result).toBeNull()
  })
})
