import { describe, expect, it, vi } from 'vitest'

const { getSessionMock, getOrCreateInviteTokenMock, getInviteLinkSeedTopicsMock } = vi.hoisted(() => ({
  getSessionMock: vi.fn(),
  getOrCreateInviteTokenMock: vi.fn(),
  getInviteLinkSeedTopicsMock: vi.fn(),
}))

vi.mock('@/server/auth/session', () => ({ getSession: getSessionMock }))
vi.mock('@/server/friends/user-invite-token', () => ({
  getOrCreateInviteToken: getOrCreateInviteTokenMock,
  getInviteLinkSeedTopics: getInviteLinkSeedTopicsMock,
  buildInviteUrl: (baseUrl: string, handle: string, token: string) =>
    `${baseUrl}/u/${handle}/${token}`,
  getBaseUrl: () => 'https://example.com',
}))

import { GET } from '@/app/api/account/invite-token/route'

describe('GET /api/account/invite-token', () => {
  it('401s when there is no session', async () => {
    getSessionMock.mockResolvedValueOnce(null)
    const response = await GET(new Request('https://example.com/api/account/invite-token'))
    expect(response.status).toBe(401)
  })

  it('409s when the user has no handle yet', async () => {
    getSessionMock.mockResolvedValueOnce({ userId: 'u1' })
    getOrCreateInviteTokenMock.mockResolvedValueOnce({ token: 'tok', handle: null })
    const response = await GET(new Request('https://example.com/api/account/invite-token'))
    expect(response.status).toBe(409)
  })

  // Stage 3 addition: userId + the RESOLVED topic count (curated set, or the
  // automatic declared-interests fallback) so InviteSomeoneNew's "N topics"
  // line reflects what the link actually carries, and can link to /users/<id>
  // without a second fetch.
  it('includes userId and the resolved topic count', async () => {
    getSessionMock.mockResolvedValueOnce({ userId: 'u1' })
    getOrCreateInviteTokenMock.mockResolvedValueOnce({ token: 'tok', handle: 'josh' })
    getInviteLinkSeedTopicsMock.mockResolvedValueOnce([
      { label: 'Jazz' },
      { label: 'Poetry' },
    ])

    const response = await GET(new Request('https://example.com/api/account/invite-token'))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual({
      token: 'tok',
      url: 'https://example.com/u/josh/tok',
      userId: 'u1',
      topicCount: 2,
    })
    expect(getInviteLinkSeedTopicsMock).toHaveBeenCalledWith('u1')
  })

  it('reports 0 topics when the link has neither a curated set nor declared interests', async () => {
    getSessionMock.mockResolvedValueOnce({ userId: 'u1' })
    getOrCreateInviteTokenMock.mockResolvedValueOnce({ token: 'tok', handle: 'josh' })
    getInviteLinkSeedTopicsMock.mockResolvedValueOnce([])

    const response = await GET(new Request('https://example.com/api/account/invite-token'))
    const body = await response.json()

    expect(body.topicCount).toBe(0)
  })
})
