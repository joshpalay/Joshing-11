import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  acceptFriendInvitationMock,
  createSessionMock,
  dbMock,
  findUserSelectMock,
  hasAcceptedInvitationForUserMock,
  getValidInvitationForPhoneMock,
  provisionUserInsertMock,
  verifyOtpMock,
} = vi.hoisted(() => {
  const findUserSelectMock = vi.fn(
    async () => [] as Array<Record<string, unknown>>
  )
  const provisionUserInsertMock = vi.fn(
    async () => [] as Array<Record<string, unknown>>
  )
  const dbMock = {
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        onConflictDoNothing: vi.fn(() => ({
          returning: vi.fn(() => provisionUserInsertMock()),
        })),
      })),
    })),
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(() => findUserSelectMock()),
        })),
      })),
    })),
  }
  return {
    acceptFriendInvitationMock: vi.fn(),
    createSessionMock: vi.fn(async () => 'session-token'),
    dbMock,
    findUserSelectMock,
    hasAcceptedInvitationForUserMock: vi.fn(async () => false),
    getValidInvitationForPhoneMock: vi.fn(async () => null as unknown),
    provisionUserInsertMock,
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
  getValidInvitationForPhone: getValidInvitationForPhoneMock,
  hasAcceptedInvitationForUser: hasAcceptedInvitationForUserMock,
  INVITATION_ACCEPTANCE_ERROR_MESSAGE: 'This invitation could not be accepted.',
  // The route also imports INVITE_REQUIRED_MESSAGE for its 403 (new-signup,
  // no token) path; mock must expose it or that branch throws.
  INVITE_REQUIRED_MESSAGE:
    "Joshing is invite-only. Ask a friend who's already on Joshing to send you an invite.",
}))

import { POST } from '@/app/api/auth/verify-otp/route'

const EXISTING_USER = {
  id: 'user-1',
  phoneNumber: '+15551234567',
  displayName: null,
  timezone: 'America/New_York',
}

const NEW_USER = {
  id: 'user-2',
  phoneNumber: '+15559876543',
  displayName: null,
  timezone: 'America/New_York',
}

const VALID_INVITATION = {
  id: 'inv-1',
  inviterUserId: 'inviter-1',
  inviteePhone: '+15559876543',
  inviteeDisplayName: 'New Friend',
  inviteeUserId: null,
  preSeededInterests: null,
  personalMessage: null,
  token: 'invite-token',
  sentAt: new Date(),
  acceptedAt: null,
  cancelledAt: null,
  expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24),
}

function jsonRequest(body: unknown) {
  return new Request('http://localhost/api/auth/verify-otp', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

describe('/api/auth/verify-otp invitation gate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    findUserSelectMock.mockReset()
    provisionUserInsertMock.mockReset()
    hasAcceptedInvitationForUserMock.mockReset()
    getValidInvitationForPhoneMock.mockReset()
    acceptFriendInvitationMock.mockReset()

    findUserSelectMock.mockResolvedValue([])
    provisionUserInsertMock.mockResolvedValue([])
    hasAcceptedInvitationForUserMock.mockResolvedValue(false)
    getValidInvitationForPhoneMock.mockResolvedValue(null)
    acceptFriendInvitationMock.mockResolvedValue({ accepted: true })
  })

  describe('re-login (existing user)', () => {
    it('allows re-login with no token when the user has a prior accepted invitation', async () => {
      findUserSelectMock.mockResolvedValueOnce([EXISTING_USER])

      const response = await POST(
        jsonRequest({ phone: '+15551234567', code: '000000' })
      )
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.user.id).toBe('user-1')
      expect(body.invitation).toEqual({ accepted: false })
      expect(createSessionMock).toHaveBeenCalledWith('user-1', {
        invitationAccepted: true,
        onboardingComplete: false,
      })
      expect(acceptFriendInvitationMock).not.toHaveBeenCalled()
    })

    it('allows re-login with no token even when the user has no prior accepted invitation (legacy/grandfathered account)', async () => {
      findUserSelectMock.mockResolvedValueOnce([EXISTING_USER])

      const response = await POST(
        jsonRequest({ phone: '+15551234567', code: '000000' })
      )
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.user.id).toBe('user-1')
      expect(body.invitation).toEqual({ accepted: false })
      expect(createSessionMock).toHaveBeenCalledWith('user-1', {
        invitationAccepted: true,
        onboardingComplete: false,
      })
      expect(hasAcceptedInvitationForUserMock).not.toHaveBeenCalled()
    })

    it('allows re-login when accepting a new invitation', async () => {
      findUserSelectMock.mockResolvedValueOnce([EXISTING_USER])
      acceptFriendInvitationMock.mockResolvedValueOnce({ accepted: true })

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
      expect(createSessionMock).toHaveBeenCalledWith('user-1', {
        invitationAccepted: true,
        onboardingComplete: false,
      })
    })

    it('still logs in when a supplied invitation token fails to accept', async () => {
      findUserSelectMock.mockResolvedValueOnce([EXISTING_USER])
      acceptFriendInvitationMock.mockResolvedValueOnce({
        accepted: false,
        reason: 'expired',
      })

      const response = await POST(
        jsonRequest({
          phone: '+15551234567',
          code: '000000',
          invitationToken: 'invite-token',
        })
      )

      expect(response.status).toBe(200)
      expect(createSessionMock).toHaveBeenCalledWith('user-1', {
        invitationAccepted: true,
        onboardingComplete: false,
      })
    })
  })

  describe('new signup', () => {
    it('rejects a brand new phone number with no invitation token', async () => {
      findUserSelectMock.mockResolvedValueOnce([])

      const response = await POST(
        jsonRequest({ phone: '+15559876543', code: '000000' })
      )
      const body = await response.json()

      // New signup with no token is gated by inviteRequiredRejection() →
      // 403 invite_required (not the 400 invalid_invitation used for bad/empty
      // tokens). This is the invite-only signup gate.
      expect(response.status).toBe(403)
      expect(body).toEqual({
        error: 'invite_required',
        message:
          "Joshing is invite-only. Ask a friend who's already on Joshing to send you an invite.",
      })
      expect(createSessionMock).not.toHaveBeenCalled()
      // No user should be created.
      expect(provisionUserInsertMock).not.toHaveBeenCalled()
    })

    it('rejects an empty-string invitation token (closes the {"invitationToken": ""} bypass)', async () => {
      const response = await POST(
        jsonRequest({
          phone: '+15559876543',
          code: '000000',
          invitationToken: '',
        })
      )
      const body = await response.json()

      expect(response.status).toBe(400)
      expect(body).toEqual({
        error: 'invalid_invitation',
        message: 'This invitation could not be accepted.',
      })
      expect(verifyOtpMock).not.toHaveBeenCalled()
      expect(createSessionMock).not.toHaveBeenCalled()
      expect(provisionUserInsertMock).not.toHaveBeenCalled()
    })

    it('rejects a whitespace-only invitation token', async () => {
      const response = await POST(
        jsonRequest({
          phone: '+15559876543',
          code: '000000',
          invitationToken: '   ',
        })
      )

      expect(response.status).toBe(400)
      expect(createSessionMock).not.toHaveBeenCalled()
      expect(provisionUserInsertMock).not.toHaveBeenCalled()
    })

    it('rejects a new phone with a token that does not match an invitation', async () => {
      findUserSelectMock.mockResolvedValueOnce([])
      getValidInvitationForPhoneMock.mockResolvedValueOnce(null)

      const response = await POST(
        jsonRequest({
          phone: '+15559876543',
          code: '000000',
          invitationToken: 'bogus-token',
        })
      )
      const body = await response.json()

      expect(response.status).toBe(400)
      expect(body.error).toBe('invalid_invitation')
      expect(createSessionMock).not.toHaveBeenCalled()
      expect(provisionUserInsertMock).not.toHaveBeenCalled()
      expect(acceptFriendInvitationMock).not.toHaveBeenCalled()
    })

    it('rejects a new phone when the invitation token does not match the verified phone', async () => {
      findUserSelectMock.mockResolvedValueOnce([])
      // Pre-validation rejects because phone doesn't match invitee phone.
      getValidInvitationForPhoneMock.mockResolvedValueOnce(null)

      const response = await POST(
        jsonRequest({
          phone: '+15550000000',
          code: '000000',
          invitationToken: 'invite-token',
        })
      )

      expect(response.status).toBe(400)
      expect(provisionUserInsertMock).not.toHaveBeenCalled()
      expect(acceptFriendInvitationMock).not.toHaveBeenCalled()
    })

    it('provisions a user and accepts the invitation when token + phone match', async () => {
      findUserSelectMock.mockResolvedValueOnce([])
      getValidInvitationForPhoneMock.mockResolvedValueOnce(VALID_INVITATION)
      provisionUserInsertMock.mockResolvedValueOnce([NEW_USER])
      acceptFriendInvitationMock.mockResolvedValueOnce({ accepted: true })

      const response = await POST(
        jsonRequest({
          phone: '+15559876543',
          code: '000000',
          invitationToken: 'invite-token',
        })
      )
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.user.id).toBe('user-2')
      expect(body.invitation).toEqual({ accepted: true })
      expect(provisionUserInsertMock).toHaveBeenCalled()
      expect(acceptFriendInvitationMock).toHaveBeenCalledWith({
        token: 'invite-token',
        inviteeUserId: 'user-2',
        verifiedPhone: '+15559876543',
      })
      expect(createSessionMock).toHaveBeenCalledWith('user-2', {
        invitationAccepted: true,
        onboardingComplete: false,
      })
    })

    it('rejects new signup when accept races and fails after provisioning', async () => {
      findUserSelectMock.mockResolvedValueOnce([])
      getValidInvitationForPhoneMock.mockResolvedValueOnce(VALID_INVITATION)
      provisionUserInsertMock.mockResolvedValueOnce([NEW_USER])
      acceptFriendInvitationMock.mockResolvedValueOnce({
        accepted: false,
        reason: 'claim_failed',
      })

      const response = await POST(
        jsonRequest({
          phone: '+15559876543',
          code: '000000',
          invitationToken: 'invite-token',
        })
      )
      const body = await response.json()

      expect(response.status).toBe(400)
      expect(body.error).toBe('invalid_invitation')
      expect(createSessionMock).not.toHaveBeenCalled()
    })
  })

  describe('OTP failure short-circuits', () => {
    it('rejects non-000000 OTP codes before any user lookup or invitation work', async () => {
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
      expect(findUserSelectMock).not.toHaveBeenCalled()
      expect(acceptFriendInvitationMock).not.toHaveBeenCalled()
      expect(createSessionMock).not.toHaveBeenCalled()
    })
  })
})
