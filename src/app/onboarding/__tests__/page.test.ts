import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  getSessionMock,
  getUserOnboardingProfileMock,
  getPreSeededInterestsForUserMock,
  hasInviteLinkFriendshipMock,
  friendInvitationRowsMock,
  redirectMock,
} = vi.hoisted(() => ({
  getSessionMock: vi.fn(),
  getUserOnboardingProfileMock: vi.fn(),
  getPreSeededInterestsForUserMock: vi.fn(),
  hasInviteLinkFriendshipMock: vi.fn(async () => false),
  // Drives the FriendInvitation grandfather-guard query result.
  friendInvitationRowsMock: vi.fn(
    async () => [{ id: 'inv-1' }] as Array<{ id: string }>,
  ),
  redirectMock: vi.fn((target: string) => {
    // Mirror Next.js: redirect() throws to short-circuit rendering.
    throw new Error(`__REDIRECT__:${target}`)
  }),
}))

vi.mock('next/navigation', () => ({
  redirect: redirectMock,
}))

vi.mock('@/server/auth/session', () => ({
  getSession: getSessionMock,
}))

vi.mock('@/server/db/queries/users', () => ({
  getUserOnboardingProfile: getUserOnboardingProfileMock,
  getPreSeededInterestsForUser: getPreSeededInterestsForUserMock,
}))

// The page runs a grandfather-guard query (select FriendInvitation … limit 1)
// directly against db. Stub the chain so it resolves without a real connection;
// the result is discarded by the page (void hasInvitation), so [] is fine.
// The page runs a grandfather-guard query (select FriendInvitation … limit 1)
// directly against db. The limit() result is driven by friendInvitationRowsMock
// so individual tests can simulate "no FriendInvitation row" (invite-link path).
vi.mock('@/server/db', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => friendInvitationRowsMock(),
        }),
      }),
    }),
  },
  friendInvitations: {
    id: 'friendInvitations.id',
    inviteeUserId: 'friendInvitations.inviteeUserId',
    acceptedAt: 'friendInvitations.acceptedAt',
  },
}))

vi.mock('@/server/friends/user-invite-token', () => ({
  hasInviteLinkFriendship: hasInviteLinkFriendshipMock,
}))

// Stub the client component import so this test stays server-side.
vi.mock('@/app/onboarding/OnboardingFlow', () => ({
  default: () => null,
}))

import OnboardingPage from '@/app/onboarding/page'

async function callPage() {
  try {
    await OnboardingPage()
    return { redirected: false as const }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const match = message.match(/^__REDIRECT__:(.+)$/)
    if (match) return { redirected: true as const, target: match[1] }
    throw err
  }
}

describe('OnboardingPage guard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getSessionMock.mockReset()
    getUserOnboardingProfileMock.mockReset()
    getPreSeededInterestsForUserMock.mockReset()
    getPreSeededInterestsForUserMock.mockResolvedValue({
      inviterName: 'Someone',
      interests: [],
    })
    hasInviteLinkFriendshipMock.mockReset()
    hasInviteLinkFriendshipMock.mockResolvedValue(false)
    friendInvitationRowsMock.mockReset()
    friendInvitationRowsMock.mockResolvedValue([{ id: 'inv-1' }])
  })

  it('redirects to /login when there is no session', async () => {
    getSessionMock.mockResolvedValueOnce(null)
    const result = await callPage()
    expect(result).toEqual({ redirected: true, target: '/login' })
  })

  it('redirects to /login when the user row is missing', async () => {
    getSessionMock.mockResolvedValueOnce({ userId: 'u1', id: 's1' })
    getUserOnboardingProfileMock.mockResolvedValueOnce(null)
    const result = await callPage()
    expect(result).toEqual({ redirected: true, target: '/login' })
  })

  it('redirects already-onboarded users to /', async () => {
    getSessionMock.mockResolvedValueOnce({ userId: 'u1', id: 's1' })
    getUserOnboardingProfileMock.mockResolvedValueOnce({
      id: 'u1',
      onboardingComplete: true,
    })
    const result = await callPage()
    expect(result).toEqual({ redirected: true, target: '/' })
  })

  it('renders OnboardingFlow when session present and not-yet-onboarded', async () => {
    getSessionMock.mockResolvedValueOnce({ userId: 'u1', id: 's1' })
    getUserOnboardingProfileMock.mockResolvedValueOnce({
      id: 'u1',
      onboardingComplete: false,
    })
    const result = await callPage()
    expect(result).toEqual({ redirected: false })
    expect(getPreSeededInterestsForUserMock).toHaveBeenCalledWith('u1')
  })

  it('renders OnboardingFlow for an invite-link signup (no FriendInvitation row, but an invite-link friendship)', async () => {
    getSessionMock.mockResolvedValueOnce({ userId: 'u1', id: 's1' })
    getUserOnboardingProfileMock.mockResolvedValueOnce({
      id: 'u1',
      onboardingComplete: false,
    })
    friendInvitationRowsMock.mockResolvedValueOnce([]) // no SMS-style invitation
    hasInviteLinkFriendshipMock.mockResolvedValueOnce(true) // arrived via /u/<handle>/<token>
    const result = await callPage()
    expect(result).toEqual({ redirected: false })
  })

  it('redirects to /login when there is neither a FriendInvitation nor an invite-link friendship', async () => {
    getSessionMock.mockResolvedValueOnce({ userId: 'u1', id: 's1' })
    getUserOnboardingProfileMock.mockResolvedValueOnce({
      id: 'u1',
      onboardingComplete: false,
    })
    friendInvitationRowsMock.mockResolvedValueOnce([])
    hasInviteLinkFriendshipMock.mockResolvedValueOnce(false)
    const result = await callPage()
    expect(result).toEqual({ redirected: true, target: '/login' })
  })
})
