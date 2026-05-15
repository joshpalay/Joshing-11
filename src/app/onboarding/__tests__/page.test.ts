import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  getSessionMock,
  getUserOnboardingProfileMock,
  getPreSeededInterestsForUserMock,
  hasAcceptedInvitationForUserMock,
  redirectMock,
} = vi.hoisted(() => ({
  getSessionMock: vi.fn(),
  getUserOnboardingProfileMock: vi.fn(),
  getPreSeededInterestsForUserMock: vi.fn(),
  hasAcceptedInvitationForUserMock: vi.fn(),
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

vi.mock('@/server/friends/invitations', () => ({
  hasAcceptedInvitationForUser: hasAcceptedInvitationForUserMock,
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
    hasAcceptedInvitationForUserMock.mockReset()
    getPreSeededInterestsForUserMock.mockResolvedValue({
      inviterName: 'Someone',
      interests: [],
    })
  })

  it('redirects to /login when there is no session', async () => {
    getSessionMock.mockResolvedValueOnce(null)
    const result = await callPage()
    expect(result).toEqual({ redirected: true, target: '/login' })
    expect(hasAcceptedInvitationForUserMock).not.toHaveBeenCalled()
  })

  it('redirects to /login when the user row is missing', async () => {
    getSessionMock.mockResolvedValueOnce({ userId: 'u1', id: 's1' })
    getUserOnboardingProfileMock.mockResolvedValueOnce(null)
    const result = await callPage()
    expect(result).toEqual({ redirected: true, target: '/login' })
    expect(hasAcceptedInvitationForUserMock).not.toHaveBeenCalled()
  })

  it('redirects to /login?reason=no_invitation when the user has no accepted invitation', async () => {
    getSessionMock.mockResolvedValueOnce({ userId: 'u1', id: 's1' })
    getUserOnboardingProfileMock.mockResolvedValueOnce({
      id: 'u1',
      onboardingComplete: false,
    })
    hasAcceptedInvitationForUserMock.mockResolvedValueOnce(false)
    const result = await callPage()
    expect(result).toEqual({
      redirected: true,
      target: '/login?reason=no_invitation',
    })
    expect(getPreSeededInterestsForUserMock).not.toHaveBeenCalled()
  })

  it('redirects already-onboarded users to /', async () => {
    getSessionMock.mockResolvedValueOnce({ userId: 'u1', id: 's1' })
    getUserOnboardingProfileMock.mockResolvedValueOnce({
      id: 'u1',
      onboardingComplete: true,
    })
    hasAcceptedInvitationForUserMock.mockResolvedValueOnce(true)
    const result = await callPage()
    expect(result).toEqual({ redirected: true, target: '/' })
  })

  it('renders OnboardingFlow when session + invitation + not-yet-onboarded', async () => {
    getSessionMock.mockResolvedValueOnce({ userId: 'u1', id: 's1' })
    getUserOnboardingProfileMock.mockResolvedValueOnce({
      id: 'u1',
      onboardingComplete: false,
    })
    hasAcceptedInvitationForUserMock.mockResolvedValueOnce(true)
    const result = await callPage()
    expect(result).toEqual({ redirected: false })
    expect(getPreSeededInterestsForUserMock).toHaveBeenCalledWith('u1')
  })
})
