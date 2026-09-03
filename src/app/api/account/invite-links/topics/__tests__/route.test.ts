import { describe, expect, it, vi } from 'vitest'

const { getSessionMock, getCuratedInviteSeedTopicsMock, getInviteLinkSeedTopicsMock, setCuratedInviteSeedTopicsMock } =
  vi.hoisted(() => ({
    getSessionMock: vi.fn(),
    getCuratedInviteSeedTopicsMock: vi.fn(),
    getInviteLinkSeedTopicsMock: vi.fn(),
    setCuratedInviteSeedTopicsMock: vi.fn(),
  }))

vi.mock('@/server/auth/session', () => ({ getSession: getSessionMock }))
vi.mock('@/server/friends/user-invite-token', () => ({
  getCuratedInviteSeedTopics: getCuratedInviteSeedTopicsMock,
  getInviteLinkSeedTopics: getInviteLinkSeedTopicsMock,
  setCuratedInviteSeedTopics: setCuratedInviteSeedTopicsMock,
}))

import { GET, PATCH } from '@/app/api/account/invite-links/topics/route'

function patchRequest(body: unknown) {
  return new Request('https://example.com/api/account/invite-links/topics', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('GET /api/account/invite-links/topics', () => {
  it('returns 401 when signed out', async () => {
    getSessionMock.mockResolvedValueOnce(null)
    const response = await GET()
    expect(response.status).toBe(401)
  })

  it('returns the RESOLVED (curated-or-fallback) set, not curated-only', async () => {
    getSessionMock.mockResolvedValueOnce({ userId: 'u1' })
    getInviteLinkSeedTopicsMock.mockResolvedValueOnce([
      { label: 'Sondheim', broadCategory: 'Music' },
    ])
    const response = await GET()
    const body = await response.json()
    expect(body.topics).toEqual([{ label: 'Sondheim', broadCategory: 'Music' }])
    expect(getInviteLinkSeedTopicsMock).toHaveBeenCalledWith('u1')
  })
})

describe('PATCH /api/account/invite-links/topics', () => {
  it('returns 401 when signed out', async () => {
    getSessionMock.mockResolvedValueOnce(null)
    const response = await PATCH(patchRequest({ topics: ['Sondheim'] }))
    expect(response.status).toBe(401)
  })

  it('rejects a too-broad topic without saving', async () => {
    getSessionMock.mockResolvedValueOnce({ userId: 'u1' })
    const response = await PATCH(patchRequest({ topics: ['Music'] }))
    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.error).toBe('too_broad')
    expect(setCuratedInviteSeedTopicsMock).not.toHaveBeenCalled()
  })

  it('saves and echoes the curated set', async () => {
    getSessionMock.mockResolvedValueOnce({ userId: 'u1' })
    getCuratedInviteSeedTopicsMock.mockResolvedValueOnce(['Sondheim'])
    const response = await PATCH(patchRequest({ topics: ['Sondheim'] }))
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.topics).toEqual([{ label: 'Sondheim' }])
    expect(setCuratedInviteSeedTopicsMock).toHaveBeenCalledWith('u1', ['Sondheim'])
  })
})
