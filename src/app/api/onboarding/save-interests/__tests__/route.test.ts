import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getSessionMock, markOnboardingCompleteMock, saveDeclaredInterestsMock } = vi.hoisted(() => ({
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

function jsonRequest(interests: unknown) {
  return new Request('https://joshing.example/api/onboarding/save-interests', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ interests }),
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
    const response = await POST(jsonRequest([
      { domain: 'Sondheim', broadCategory: 'Theater' },
      { domain: 'Jazz', broadCategory: 'Music' },
    ]))

    expect(response.status).toBe(200)
    expect(saveDeclaredInterestsMock).toHaveBeenCalledWith('user-invitee', [
      { label: 'Sondheim', broadCategory: 'Theater' },
      { label: 'Jazz', broadCategory: 'Music' },
    ])
    expect(markOnboardingCompleteMock).toHaveBeenCalledWith('user-invitee')
  })

  it('partial selection saves only selected interests', async () => {
    const response = await POST(jsonRequest([
      { domain: 'Sondheim', broadCategory: 'Theater' },
    ]))

    expect(response.status).toBe(200)
    expect(saveDeclaredInterestsMock).toHaveBeenCalledWith('user-invitee', [
      { label: 'Sondheim', broadCategory: 'Theater' },
    ])
  })

  it('skip saves none of the invited interests unless the user adds others', async () => {
    const response = await POST(jsonRequest([
      { domain: 'Italian Renaissance painting', broadCategory: 'Art' },
    ]))

    expect(response.status).toBe(200)
    expect(saveDeclaredInterestsMock).toHaveBeenCalledWith('user-invitee', [
      { label: 'Italian Renaissance painting', broadCategory: 'Art' },
    ])
    expect(saveDeclaredInterestsMock).not.toHaveBeenCalledWith(
      'user-invitee',
      expect.arrayContaining([{ label: 'Sondheim', broadCategory: 'Theater' }]),
    )
  })

  it('does not silently save rejected interests from an empty selection', async () => {
    const response = await POST(jsonRequest([]))
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.error).toBe('invalid_request')
    expect(saveDeclaredInterestsMock).not.toHaveBeenCalled()
    expect(markOnboardingCompleteMock).not.toHaveBeenCalled()
  })
})
