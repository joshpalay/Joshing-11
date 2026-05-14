import { beforeEach, describe, expect, it, vi } from 'vitest'

const { acceptFriendInvitationMock, createSessionMock, dbMock, verifyOtpMock } =
  vi.hoisted(() => {
    const user = {
      id: 'user-1',
      phoneNumber: '+15551234567',
      displayName: null,
      timezone: 'America/New_York',
    }

    const dbMock = {
      insert: vi.fn(() => ({
        values: vi.fn(() => ({
          onConflictDoNothing: vi.fn(() => ({
            returning: vi.fn(async () => [user]),
          })),
        })),
      })),
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn(async () => [user]),
          })),
        })),
      })),
    }

    return {
      acceptFriendInvitationMock: vi.fn(),
      createSessionMock: vi.fn(async () => 'session-token'),
      dbMock,
      verifyOtpMock: vi.fn(async (phone: string, code: string) =>
        code === '000000' ? phone : null
      ),
    }
  })

vi.mock('@/server/auth', () => ({
  verifyOtp: verifyOtpMock,
}))

vi.mock('@/server/auth/session', () => ({
  createSession: createSessionMock,
}))

vi.mock('@/server/db', () => ({
  db: dbMock,
  users: {
    id: 'users.id',
    phoneNumber: 'users.phoneNumber',
    displayName: 'users.displayName',
    timezone: 'users.timezone',
  },
}))

vi.mock('@/server/friends/invitations', () => ({
  acceptFriendInvitation: acceptFriendInvitationMock,
  INVITATION_ACCEPTANCE_ERROR_MESSAGE: 'This invitation could not be accepted.',
}))

import { POST } from '@/app/api/auth/verify-otp/route'

function jsonRequest(body: unknown) {
  return new Request('http://localhost/api/auth/verify-otp', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

describe('/api/auth/verify-otp invitation handling', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    acceptFriendInvitationMock.mockResolvedValue({ accepted: true })
  })

  it('allows normal login without an invitation using the hardcoded 000000 OTP', async () => {
    const response = await POST(
      jsonRequest({ phone: '+15551234567', code: '000000' })
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.invitation).toEqual({ accepted: false })
    expect(verifyOtpMock).toHaveBeenCalledWith('+15551234567', '000000')
    expect(acceptFriendInvitationMock).not.toHaveBeenCalled()
    expect(createSessionMock).toHaveBeenCalledWith('user-1')
  })

  it('continues to reject non-000000 OTP codes before invitation acceptance', async () => {
    const response = await POST(
      jsonRequest({
        phone: '+15551234567',
        code: '123456',
        invitationToken: 'invite-token',
      })
    )
    const body = await response.json()

    expect(response.status).toBe(401)
    expect(body).toEqual(expect.objectContaining({ error: 'invalid_code' }))
    expect(verifyOtpMock).toHaveBeenCalledWith('+15551234567', '123456')
    expect(acceptFriendInvitationMock).not.toHaveBeenCalled()
    expect(createSessionMock).not.toHaveBeenCalled()
  })

  it('accepts an invitation only after OTP verification and passes the verified phone to invitation acceptance', async () => {
    const response = await POST(
      jsonRequest({
        phone: '+15551234567',
        code: '000000',
        invitationToken: 'invite-token',
      })
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.invitation).toEqual({ accepted: true })
    expect(acceptFriendInvitationMock).toHaveBeenCalledWith({
      token: 'invite-token',
      inviteeUserId: 'user-1',
      verifiedPhone: '+15551234567',
    })
    expect(createSessionMock).toHaveBeenCalledWith('user-1')
  })

  it('fails invite login with safe copy when invitation acceptance rejects the claim', async () => {
    acceptFriendInvitationMock.mockResolvedValueOnce({
      accepted: false,
      reason: 'phone_mismatch',
    })

    const response = await POST(
      jsonRequest({
        phone: '+15550000000',
        code: '000000',
        invitationToken: 'invite-token',
      })
    )
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body).toEqual({
      error: 'invalid_invitation',
      message: 'This invitation could not be accepted.',
    })
    expect(createSessionMock).not.toHaveBeenCalled()
  })
})
