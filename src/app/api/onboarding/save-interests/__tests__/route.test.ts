import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  getSessionMock,
  markOnboardingCompleteMock,
  saveDeclaredInterestsMock,
} = vi.hoisted(() => ({
  getSessionMock: vi.fn(),
  markOnboardingCompleteMock: vi.fn(),
  saveDeclaredInterestsMock: vi.fn(),
}))

vi.mock('@/server/auth/session', () => ({
  getSession: getSessionMock,
}))

vi.mock('@/server/db/queries/users', () => ({
  markOnboardingComplete: markOnboardingCompleteMock,
  saveDeclaredInterests: saveDeclaredInterestsMock,
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
    saveDeclaredInterestsMock.mockResolvedValue(undefined)
    markOnboardingCompleteMock.mockResolvedValue(undefined)
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
      saveDeclaredInterestsMock.mockResolvedValue(undefined)
      markOnboardingCompleteMock.mockResolvedValue(undefined)

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

  it('enforces the max interest cap', async () => {
    const response = await POST(
      jsonRequest([
        { domain: 'One', broadCategory: 'Other' },
        { domain: 'Two', broadCategory: 'Other' },
        { domain: 'Three', broadCategory: 'Other' },
        { domain: 'Four', broadCategory: 'Other' },
        { domain: 'Five', broadCategory: 'Other' },
        { domain: 'Six', broadCategory: 'Other' },
      ])
    )

    expect(response.status).toBe(400)
    expect(saveDeclaredInterestsMock).not.toHaveBeenCalled()
    expect(markOnboardingCompleteMock).not.toHaveBeenCalled()
  })

  it('does not silently save rejected interests from an empty non-invite selection', async () => {
    const response = await POST(jsonRequest([]))
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.error).toBe('invalid_request')
    expect(saveDeclaredInterestsMock).not.toHaveBeenCalled()
    expect(markOnboardingCompleteMock).not.toHaveBeenCalled()
  })
})
