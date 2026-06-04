import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getSessionMock, setFollowPrivacyMock } = vi.hoisted(() => ({
  getSessionMock: vi.fn(),
  setFollowPrivacyMock: vi.fn(),
}))

vi.mock('@/server/auth/session', () => ({ getSession: getSessionMock }))
vi.mock('@/server/db/queries/users', () => ({ setFollowPrivacy: setFollowPrivacyMock }))

import { PATCH } from '@/app/api/users/me/route'

function patch(body: unknown) {
  return new Request('https://joshing.example/api/users/me', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('PATCH /api/users/me', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getSessionMock.mockResolvedValue({ userId: 'me' })
    setFollowPrivacyMock.mockResolvedValue({ id: 'me', followPrivacy: 'public' })
  })

  it('updates the follow-privacy gate', async () => {
    const response = await PATCH(patch({ followPrivacy: 'public' }))
    const body = await response.json()
    expect(response.status).toBe(200)
    expect(setFollowPrivacyMock).toHaveBeenCalledWith('me', 'public')
    expect(body).toEqual({ ok: true, followPrivacy: 'public' })
  })

  it('rejects unauthenticated callers', async () => {
    getSessionMock.mockResolvedValueOnce(null)
    const response = await PATCH(patch({ followPrivacy: 'public' }))
    expect(response.status).toBe(401)
    expect(setFollowPrivacyMock).not.toHaveBeenCalled()
  })

  it('rejects an invalid privacy value', async () => {
    const response = await PATCH(patch({ followPrivacy: 'everyone' }))
    expect(response.status).toBe(400)
    expect(setFollowPrivacyMock).not.toHaveBeenCalled()
  })
})
