import { describe, expect, it, vi } from 'vitest'

const { getSessionMock, softDeleteInviteLinkMock } = vi.hoisted(() => ({
  getSessionMock: vi.fn(),
  softDeleteInviteLinkMock: vi.fn(),
}))

vi.mock('@/server/auth/session', () => ({ getSession: getSessionMock }))
vi.mock('@/server/db/queries/invite-links', () => ({
  softDeleteInviteLink: softDeleteInviteLinkMock,
}))

import { POST } from '@/app/api/account/invite-links/[linkId]/delete/route'

function ctx(linkId: string) {
  return { params: Promise.resolve({ linkId }) }
}

describe('POST /api/account/invite-links/[linkId]/delete', () => {
  it('returns 401 when signed out', async () => {
    getSessionMock.mockResolvedValueOnce(null)
    const response = await POST(new Request('https://example.com'), ctx('lk1'))
    expect(response.status).toBe(401)
  })

  it('returns 404 when nothing was deleted (not found, not owned, or already gone)', async () => {
    getSessionMock.mockResolvedValueOnce({ userId: 'u1' })
    softDeleteInviteLinkMock.mockResolvedValueOnce(false)
    const response = await POST(new Request('https://example.com'), ctx('lk1'))
    expect(response.status).toBe(404)
  })

  it('soft-deletes the link and confirms', async () => {
    getSessionMock.mockResolvedValueOnce({ userId: 'u1' })
    softDeleteInviteLinkMock.mockResolvedValueOnce(true)
    const response = await POST(new Request('https://example.com'), ctx('lk1'))
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.ok).toBe(true)
    expect(softDeleteInviteLinkMock).toHaveBeenCalledWith('u1', 'lk1')
  })
})
