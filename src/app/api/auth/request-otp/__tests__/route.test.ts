import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  findUserSelectMock,
  hasValidPendingInvitationForPhoneMock,
  requestOtpMock,
  resolveInviteLinkMock,
} = vi.hoisted(() => {
  const findUserSelectMock = vi.fn(
    async () => [] as Array<Record<string, unknown>>,
  )
  return {
    findUserSelectMock,
    hasValidPendingInvitationForPhoneMock: vi.fn(async () => false),
    requestOtpMock: vi.fn(async () => ({ code: '424242' })),
    resolveInviteLinkMock: vi.fn(async () => null as unknown),
  }
})

vi.mock('@/server/auth', () => ({
  isUsPhoneNumber: (value: string) => /^\+1\d{10}$/.test(value),
  normalizePhone: (value: string) => value,
  requestOtp: requestOtpMock,
}))

vi.mock('@/server/db', () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(() => findUserSelectMock()),
        })),
      })),
    })),
  },
  users: { id: 'users.id', phoneNumber: 'users.phoneNumber' },
}))

vi.mock('@/server/friends/invitations', () => ({
  hasValidPendingInvitationForPhone: hasValidPendingInvitationForPhoneMock,
  INVITE_REQUIRED_MESSAGE:
    "Joshing is invite-only. Ask a friend who's already on Joshing to send you an invite.",
}))

vi.mock('@/server/friends/user-invite-token', () => ({
  resolveInviteLink: resolveInviteLinkMock,
}))

import { POST } from '@/app/api/auth/request-otp/route'

function jsonRequest(body: unknown) {
  return new Request('http://localhost/api/auth/request-otp', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

const NEW_PHONE = '+15551230001'
const USER_INVITE = { handle: 'jpalay', token: 'real-token' }

describe('/api/auth/request-otp invite gate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    findUserSelectMock.mockReset()
    // Default: phone belongs to no existing user (new-signup path).
    findUserSelectMock.mockResolvedValue([])
    hasValidPendingInvitationForPhoneMock.mockResolvedValue(false)
    resolveInviteLinkMock.mockResolvedValue(null)
    requestOtpMock.mockResolvedValue({ code: '424242' })
  })

  it('blocks a brand-new phone with no invitation (403, no OTP sent)', async () => {
    const response = await POST(jsonRequest({ phone: NEW_PHONE }))

    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ error: 'invite_required' })
    expect(requestOtpMock).not.toHaveBeenCalled()
  })

  it('lets a brand-new phone through when a valid per-user invite link is supplied', async () => {
    resolveInviteLinkMock.mockResolvedValue({
      inviterUserId: 'inviter-1',
      inviterHandle: 'jpalay',
      inviterDisplayName: 'Joshua P',
      inviterAvatarColor: null,
    })

    const response = await POST(
      jsonRequest({ phone: NEW_PHONE, userInvite: USER_INVITE }),
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ ok: true })
    expect(resolveInviteLinkMock).toHaveBeenCalledWith('jpalay', 'real-token')
    expect(requestOtpMock).toHaveBeenCalledTimes(1)
  })

  it('still blocks a brand-new phone when the invite link does not resolve', async () => {
    resolveInviteLinkMock.mockResolvedValue(null)

    const response = await POST(
      jsonRequest({
        phone: NEW_PHONE,
        userInvite: { handle: 'jpalay', token: 'bogus' },
      }),
    )

    expect(response.status).toBe(403)
    expect(requestOtpMock).not.toHaveBeenCalled()
  })

  it('does not require an invitation for an existing user', async () => {
    findUserSelectMock.mockResolvedValue([{ id: 'user-1' }])

    const response = await POST(jsonRequest({ phone: NEW_PHONE }))

    expect(response.status).toBe(200)
    expect(resolveInviteLinkMock).not.toHaveBeenCalled()
    expect(requestOtpMock).toHaveBeenCalledTimes(1)
  })
})
