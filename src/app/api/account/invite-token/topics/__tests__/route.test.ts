import { describe, expect, it } from 'vitest'
import { vi } from 'vitest'

const { getSessionMock, getCuratedInviteSeedTopicsMock, setCuratedInviteSeedTopicsMock } = vi.hoisted(() => ({
  getSessionMock: vi.fn(),
  getCuratedInviteSeedTopicsMock: vi.fn(),
  setCuratedInviteSeedTopicsMock: vi.fn(),
}))

vi.mock('@/server/auth/session', () => ({ getSession: getSessionMock }))
vi.mock('@/server/friends/user-invite-token', () => ({
  getCuratedInviteSeedTopics: getCuratedInviteSeedTopicsMock,
  setCuratedInviteSeedTopics: setCuratedInviteSeedTopicsMock,
}))

import { GET, PATCH } from '@/app/api/account/invite-token/topics/route'

function patchRequest(body: unknown) {
  return new Request('https://example.com/api/account/invite-token/topics', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('GET /api/account/invite-token/topics', () => {
  it('401s when there is no session', async () => {
    getSessionMock.mockResolvedValueOnce(null)
    const response = await GET()
    expect(response.status).toBe(401)
  })

  it('returns the curated topics', async () => {
    getSessionMock.mockResolvedValueOnce({ userId: 'u1' })
    getCuratedInviteSeedTopicsMock.mockResolvedValueOnce(['Jazz', 'Poetry'])
    const response = await GET()
    const body = await response.json()
    expect(body).toEqual({ topics: ['Jazz', 'Poetry'] })
  })
})

describe('PATCH /api/account/invite-token/topics', () => {
  it('401s when there is no session', async () => {
    getSessionMock.mockResolvedValueOnce(null)
    const response = await PATCH(patchRequest({ topics: ['Jazz'] }))
    expect(response.status).toBe(401)
  })

  it('400s on a malformed body (not an object with a topics array)', async () => {
    getSessionMock.mockResolvedValueOnce({ userId: 'u1' })
    const response = await PATCH(patchRequest({ nope: true }))
    expect(response.status).toBe(400)
    expect(setCuratedInviteSeedTopicsMock).not.toHaveBeenCalled()
  })

  it('400s when more than 3 topics are submitted', async () => {
    getSessionMock.mockResolvedValueOnce({ userId: 'u1' })
    const response = await PATCH(patchRequest({ topics: ['A', 'B', 'C', 'D'] }))
    expect(response.status).toBe(400)
    expect(setCuratedInviteSeedTopicsMock).not.toHaveBeenCalled()
  })

  it('400s and does NOT save when one topic is too broad — rejects the whole batch', async () => {
    getSessionMock.mockResolvedValueOnce({ userId: 'u1' })
    const response = await PATCH(patchRequest({ topics: ['Jazz', 'Music'] }))
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.error).toBe('too_broad')
    expect(body.message).toContain('Music')
    expect(setCuratedInviteSeedTopicsMock).not.toHaveBeenCalled()
  })

  it('saves and returns the persisted topics on success', async () => {
    getSessionMock.mockResolvedValueOnce({ userId: 'u1' })
    setCuratedInviteSeedTopicsMock.mockResolvedValueOnce(undefined)
    getCuratedInviteSeedTopicsMock.mockResolvedValueOnce(['Jazz', 'Poetry'])

    const response = await PATCH(patchRequest({ topics: ['Jazz', 'Poetry'] }))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(setCuratedInviteSeedTopicsMock).toHaveBeenCalledWith('u1', ['Jazz', 'Poetry'])
    expect(body).toEqual({ topics: ['Jazz', 'Poetry'] })
  })

  it('an empty array clears the curated set (reverts to the automatic fallback)', async () => {
    getSessionMock.mockResolvedValueOnce({ userId: 'u1' })
    setCuratedInviteSeedTopicsMock.mockResolvedValueOnce(undefined)
    getCuratedInviteSeedTopicsMock.mockResolvedValueOnce([])

    const response = await PATCH(patchRequest({ topics: [] }))

    expect(response.status).toBe(200)
    expect(setCuratedInviteSeedTopicsMock).toHaveBeenCalledWith('u1', [])
  })
})
