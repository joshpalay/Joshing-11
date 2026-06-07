import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  getSessionMock,
  getUserOnboardingProfileMock,
  markOnboardingCompleteMock,
  refreshSessionOnboardingClaimMock,
  saveDeclaredInterestsMock,
} = vi.hoisted(() => ({
  getSessionMock: vi.fn(),
  getUserOnboardingProfileMock: vi.fn(),
  markOnboardingCompleteMock: vi.fn(),
  refreshSessionOnboardingClaimMock: vi.fn(),
  saveDeclaredInterestsMock: vi.fn(),
}))

vi.mock('@/server/auth/session', () => ({
  getSession: getSessionMock,
  refreshSessionOnboardingClaim: refreshSessionOnboardingClaimMock,
}))

vi.mock('@/server/db/queries/users', () => ({
  getUserOnboardingProfile: getUserOnboardingProfileMock,
  markOnboardingComplete: markOnboardingCompleteMock,
  saveDeclaredInterests: saveDeclaredInterestsMock,
  // Account-wide sanity bound used by the route's parse step. Kept well above
  // the onboarding-specific cap so the 12-cap test below exercises the right
  // guard.
  MAX_ACTIVE_DECLARED_INTERESTS: 100,
}))

import { POST } from '@/app/api/onboarding/save-interests/route'

function jsonRequest(interests: unknown, telemetry?: unknown) {
  return new Request('https://joshing.example/api/onboarding/save-interests', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ interests, telemetry }),
  })
}

describe('POST /api/onboarding/save-interests', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getSessionMock.mockResolvedValue({ userId: 'user-invitee' })
    getUserOnboardingProfileMock.mockResolvedValue({
      id: 'user-invitee',
      displayName: 'Morgan Lee',
      onboardingComplete: false,
    })
    saveDeclaredInterestsMock.mockResolvedValue(undefined)
    markOnboardingCompleteMock.mockResolvedValue(undefined)
    refreshSessionOnboardingClaimMock.mockResolvedValue(true)
  })

  it('accept all saves selected invited interests', async () => {
    const response = await POST(
      jsonRequest([
        { domain: 'Sondheim', broadCategory: 'Theater' },
        { domain: 'Jazz', broadCategory: 'Music' },
      ])
    )

    expect(response.status).toBe(200)
    expect(saveDeclaredInterestsMock).toHaveBeenCalledWith('user-invitee', [
      { label: 'Sondheim', broadCategory: 'Theater' },
      { label: 'Jazz', broadCategory: 'Music' },
    ])
    expect(markOnboardingCompleteMock).toHaveBeenCalledWith('user-invitee')
  })

  it('partial selection saves only selected interests', async () => {
    const response = await POST(
      jsonRequest([{ domain: 'Sondheim', broadCategory: 'Theater' }])
    )

    expect(response.status).toBe(200)
    expect(saveDeclaredInterestsMock).toHaveBeenCalledWith('user-invitee', [
      { label: 'Sondheim', broadCategory: 'Theater' },
    ])
  })

  it('normalizes legacy Other broad categories to General Knowledge', async () => {
    const response = await POST(
      jsonRequest([{ domain: 'Puzzle Potpourri', broadCategory: 'Other' }])
    )

    expect(response.status).toBe(200)
    expect(saveDeclaredInterestsMock).toHaveBeenCalledWith('user-invitee', [
      { label: 'Puzzle Potpourri', broadCategory: 'General Knowledge' },
    ])
  })

  it('skip saves none of the invited interests and completes onboarding only after explicit skip telemetry', async () => {
    const response = await POST(
      jsonRequest([], { inviteInterestCount: 3, inviteSelectedCount: 0 })
    )

    expect(response.status).toBe(200)
    expect(saveDeclaredInterestsMock).toHaveBeenCalledWith('user-invitee', [])
    expect(markOnboardingCompleteMock).toHaveBeenCalledWith('user-invitee')
  })

  it('edited interests save correctly without retaining the original invite labels', async () => {
    const response = await POST(
      jsonRequest(
        [{ domain: 'Stephen Sondheim musicals', broadCategory: 'Theater' }],
        { inviteInterestCount: 1, inviteSelectedCount: 1 }
      )
    )

    expect(response.status).toBe(200)
    expect(saveDeclaredInterestsMock).toHaveBeenCalledWith('user-invitee', [
      { label: 'Stephen Sondheim musicals', broadCategory: 'Theater' },
    ])
    expect(saveDeclaredInterestsMock).not.toHaveBeenCalledWith(
      'user-invitee',
      expect.arrayContaining([{ label: 'Sondheim', broadCategory: 'Theater' }])
    )
  })

  it('saves only Jaime-confirmed invite interests across accept, remove, edit, and skip choices', async () => {
    const choices = [
      {
        label: 'accepting all',
        interests: [
          { domain: 'Sondheim', broadCategory: 'Theater' },
          { domain: 'Jazz', broadCategory: 'Music' },
          { domain: 'Poetry', broadCategory: 'Literature' },
        ],
        expected: [
          { label: 'Sondheim', broadCategory: 'Theater' },
          { label: 'Jazz', broadCategory: 'Music' },
          { label: 'Poetry', broadCategory: 'Literature' },
        ],
      },
      {
        label: 'removing one',
        interests: [
          { domain: 'Sondheim', broadCategory: 'Theater' },
          { domain: 'Poetry', broadCategory: 'Literature' },
        ],
        expected: [
          { label: 'Sondheim', broadCategory: 'Theater' },
          { label: 'Poetry', broadCategory: 'Literature' },
        ],
      },
      {
        label: 'editing one',
        interests: [{ domain: 'Stephen Sondheim', broadCategory: 'Theater' }],
        expected: [{ label: 'Stephen Sondheim', broadCategory: 'Theater' }],
      },
      { label: 'skipping all', interests: [], expected: [] },
    ]

    for (const choice of choices) {
      vi.clearAllMocks()
      getSessionMock.mockResolvedValue({ userId: 'user-jaime' })
      getUserOnboardingProfileMock.mockResolvedValue({
        id: 'user-jaime',
        displayName: 'Jaime',
        onboardingComplete: false,
      })
      saveDeclaredInterestsMock.mockResolvedValue(undefined)
      markOnboardingCompleteMock.mockResolvedValue(undefined)
      refreshSessionOnboardingClaimMock.mockResolvedValue(true)

      const response = await POST(
        jsonRequest(choice.interests, {
          inviteInterestCount: 3,
          inviteSelectedCount: choice.interests.length,
        })
      )

      expect(response.status, choice.label).toBe(200)
      expect(saveDeclaredInterestsMock, choice.label).toHaveBeenCalledWith(
        'user-jaime',
        choice.expected
      )
      expect(markOnboardingCompleteMock, choice.label).toHaveBeenCalledWith(
        'user-jaime'
      )
    }
  })

  function manyInterests(count: number) {
    return Array.from({ length: count }, (_, index) => ({
      domain: `Topic ${index + 1}`,
      broadCategory: 'Other',
    }))
  }

  it('accepts exactly the onboarding max of 12 interests', async () => {
    const response = await POST(jsonRequest(manyInterests(12)))

    expect(response.status).toBe(200)
    expect(saveDeclaredInterestsMock).toHaveBeenCalledTimes(1)
    expect(markOnboardingCompleteMock).toHaveBeenCalledWith('user-invitee')
  })

  it('enforces the onboarding max interest cap of 12', async () => {
    const response = await POST(jsonRequest(manyInterests(13)))

    expect(response.status).toBe(400)
    expect(saveDeclaredInterestsMock).not.toHaveBeenCalled()
    expect(markOnboardingCompleteMock).not.toHaveBeenCalled()
  })

  it('re-mints the session cookie so the next request sees onboardingComplete=true', async () => {
    const response = await POST(
      jsonRequest([{ domain: 'Sondheim', broadCategory: 'Theater' }])
    )

    expect(response.status).toBe(200)
    expect(markOnboardingCompleteMock).toHaveBeenCalledWith('user-invitee')
    expect(refreshSessionOnboardingClaimMock).toHaveBeenCalledTimes(1)
    const markOrder = markOnboardingCompleteMock.mock.invocationCallOrder[0]
    const refreshOrder = refreshSessionOnboardingClaimMock.mock.invocationCallOrder[0]
    expect(refreshOrder).toBeGreaterThan(markOrder)
  })

  it('does not silently save rejected interests from an empty non-invite selection', async () => {
    const response = await POST(jsonRequest([]))
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.error).toBe('invalid_request')
    expect(saveDeclaredInterestsMock).not.toHaveBeenCalled()
    expect(markOnboardingCompleteMock).not.toHaveBeenCalled()
  })

  it('refuses to complete onboarding when displayName is still null', async () => {
    getUserOnboardingProfileMock.mockResolvedValue({
      id: 'user-invitee',
      displayName: null,
      onboardingComplete: false,
    })

    const response = await POST(
      jsonRequest([{ domain: 'Sondheim', broadCategory: 'Theater' }])
    )
    const body = await response.json()

    expect(response.status).toBe(409)
    expect(body.error).toBe('display_name_required')
    expect(saveDeclaredInterestsMock).not.toHaveBeenCalled()
    expect(markOnboardingCompleteMock).not.toHaveBeenCalled()
  })

  it('refuses to complete onboarding when displayName is whitespace only', async () => {
    getUserOnboardingProfileMock.mockResolvedValue({
      id: 'user-invitee',
      displayName: '   ',
      onboardingComplete: false,
    })

    const response = await POST(
      jsonRequest([{ domain: 'Sondheim', broadCategory: 'Theater' }])
    )

    expect(response.status).toBe(409)
    expect(saveDeclaredInterestsMock).not.toHaveBeenCalled()
    expect(markOnboardingCompleteMock).not.toHaveBeenCalled()
  })
})
