import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getSessionMock, getUserByIdMock, blockUserMock, unblockUserMock } = vi.hoisted(() => ({
  getSessionMock: vi.fn(),
  getUserByIdMock: vi.fn(),
  blockUserMock: vi.fn(async () => undefined),
  unblockUserMock: vi.fn(async () => undefined),
}))

vi.mock('@/server/auth/session', () => ({ getSession: getSessionMock }))
vi.mock('@/server/db/queries/users', () => ({ getUserById: getUserByIdMock }))
vi.mock('@/server/db/queries/user-blocks', () => ({
  blockUser: blockUserMock,
  unblockUser: unblockUserMock,
}))

import { DELETE as unblock, POST as block } from '@/app/api/users/[id]/block/route'

function buildRequest(method: 'POST' | 'DELETE') {
  return new Request('https://joshing.example/api/users/target-user/block', { method })
}

function context(id: string) {
  return { params: Promise.resolve({ id }) }
}

const VIEWER = 'viewer-1'
const TARGET = 'target-user'

beforeEach(() => {
  vi.clearAllMocks()
  getSessionMock.mockResolvedValue({ userId: VIEWER })
  getUserByIdMock.mockResolvedValue({ id: TARGET })
})

describe('POST /api/users/[id]/block', () => {
  it('blocks the target user', async () => {
    const response = await block(buildRequest('POST'), context(TARGET))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual({ ok: true })
    expect(blockUserMock).toHaveBeenCalledWith(VIEWER, TARGET)
  })

  it('rejects unauthenticated callers', async () => {
    getSessionMock.mockResolvedValueOnce(null)
    const response = await block(buildRequest('POST'), context(TARGET))
    expect(response.status).toBe(401)
    expect(blockUserMock).not.toHaveBeenCalled()
  })

  it('rejects blocking yourself', async () => {
    const response = await block(buildRequest('POST'), context(VIEWER))
    expect(response.status).toBe(400)
    expect(blockUserMock).not.toHaveBeenCalled()
  })

  it('404s for a nonexistent target', async () => {
    getUserByIdMock.mockResolvedValueOnce(null)
    const response = await block(buildRequest('POST'), context('missing-user'))
    expect(response.status).toBe(404)
    expect(blockUserMock).not.toHaveBeenCalled()
  })
})

describe('DELETE /api/users/[id]/block', () => {
  it('unblocks the target user', async () => {
    const response = await unblock(buildRequest('DELETE'), context(TARGET))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual({ ok: true })
    expect(unblockUserMock).toHaveBeenCalledWith(VIEWER, TARGET)
  })

  it('rejects unauthenticated callers', async () => {
    getSessionMock.mockResolvedValueOnce(null)
    const response = await unblock(buildRequest('DELETE'), context(TARGET))
    expect(response.status).toBe(401)
    expect(unblockUserMock).not.toHaveBeenCalled()
  })
})
