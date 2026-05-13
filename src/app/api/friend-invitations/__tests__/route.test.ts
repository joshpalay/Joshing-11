import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  cancelFriendInvitationMock,
  createFriendInvitationMock,
  dbMock,
  getSessionMock,
  sendSmsMock,
  state,
} = vi.hoisted(() => {
  const state = {
    existingUser: null as { id: string } | null,
    existingFriendship: null as Record<string, unknown> | null,
    insertedFriendship: { id: 'friendship-1', status: 'pending' } as Record<
      string,
      unknown
    >,
    updateValues: undefined as Record<string, unknown> | undefined,
  }

  const dbMock = {
    select: vi.fn((selection?: Record<string, unknown>) => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(async () => {
            if (selection && Object.values(selection).includes('users.id')) {
              return state.existingUser ? [state.existingUser] : []
            }

            return state.existingFriendship ? [state.existingFriendship] : []
          }),
        })),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn((values: Record<string, unknown>) => {
        state.updateValues = values
        return { where: vi.fn(async () => undefined) }
      }),
    })),
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        returning: vi.fn(async () => [state.insertedFriendship]),
      })),
    })),
  }

  return {
    cancelFriendInvitationMock: vi.fn(),
    createFriendInvitationMock: vi.fn(),
    dbMock,
    getSessionMock: vi.fn(),
    sendSmsMock: vi.fn(),
    state,
  }
})

vi.mock('@/server/auth', () => ({
  normalizePhone: (phone: string) => {
    const digits = phone.replace(/\D/g, '')
    if (digits.length === 10) return `+1${digits}`
    if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
    return phone.startsWith('+') ? phone : `+${digits}`
  },
  isUsPhoneNumber: (phone: string) =>
    /^\+1\d{10}$/.test(
      phone.replace(/\D/g, '').length === 10
        ? `+1${phone.replace(/\D/g, '')}`
        : phone.replace(/\D/g, '').length === 11 &&
            phone.replace(/\D/g, '').startsWith('1')
          ? `+${phone.replace(/\D/g, '')}`
          : phone.startsWith('+')
            ? phone
            : `+${phone.replace(/\D/g, '')}`
    ),
}))

vi.mock('@/server/auth/session', () => ({
  getSession: getSessionMock,
}))

vi.mock('@/server/db', () => ({
  db: dbMock,
  activityItems: { id: 'activityItems.id' },
  friendInvitations: { id: 'friendInvitations.id' },
  friendships: {
    id: 'friendships.id',
    userAId: 'friendships.userAId',
    userBId: 'friendships.userBId',
    status: 'friendships.status',
    requestedByUserId: 'friendships.requestedByUserId',
  },
  users: {
    id: 'users.id',
    phoneNumber: 'users.phoneNumber',
  },
}))

vi.mock('@/server/friends/invitations', () => ({
  cancelFriendInvitation: cancelFriendInvitationMock,
  createFriendInvitation: createFriendInvitationMock,
  listOutgoingFriendInvitations: vi.fn(async () => []),
}))

vi.mock('@/server/sms', () => ({
  sendSms: sendSmsMock,
}))

import {
  POST,
  buildFriendInvitationMessage,
  validateCreateFriendInvitationBody,
} from '@/app/api/friend-invitations/route'
import { sendSms } from '@/server/sms'

const expiresAt = new Date('2026-05-20T12:00:00.000Z')

function jsonRequest(body: unknown) {
  return new Request('https://joshing.example/api/friend-invitations', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function mockInvitation(overrides: Record<string, unknown> = {}) {
  createFriendInvitationMock.mockResolvedValueOnce({
    id: 'inv-1',
    token: 'token-1',
    inviteeDisplayName: 'Sara',
    inviteePhone: '+17345551234',
    personalMessage: null,
    expiresAt,
    ...overrides,
  })
}

describe('POST /api/friend-invitations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getSessionMock.mockResolvedValue({ userId: 'user-inviter' })
    state.existingUser = null
    state.existingFriendship = null
    state.insertedFriendship = { id: 'friendship-1', status: 'pending' }
    state.updateValues = undefined
    process.env.NEXT_PUBLIC_APP_URL = 'https://joshing.example'
  })

  it('creates invite with 0 interests and returns copyable message', async () => {
    mockInvitation()

    const response = await POST(
      jsonRequest({ inviteeDisplayName: ' Sara ', phone: '7345551234' })
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(createFriendInvitationMock).toHaveBeenCalledWith({
      inviterUserId: 'user-inviter',
      inviteePhone: '+17345551234',
      inviteeDisplayName: 'Sara',
      preSeededInterests: [],
    })
    expect(body).toEqual(
      expect.objectContaining({
        id: 'inv-1',
        inviteUrl: 'https://joshing.example/invite/token-1',
        message:
          'Hey — come play Joshing with me. No app to download — just tap this: https://joshing.example/invite/token-1',
        inviteeDisplayName: 'Sara',
        inviteePhone: '+17345551234',
        suggestedInterests: [],
        expiresAt: expiresAt.toISOString(),
      })
    )
  })

  it('creates invite with 1 interest', async () => {
    mockInvitation()

    const response = await POST(
      jsonRequest({
        inviteeDisplayName: 'Sara',
        phone: '7345551234',
        suggestedInterests: [' Sondheim '],
      })
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(createFriendInvitationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        preSeededInterests: ['Sondheim'],
      })
    )
    expect(body.message).toBe(
      'Hey — come play Joshing with me. I added something I think you might like: Sondheim. No app to download — just tap this: https://joshing.example/invite/token-1'
    )
  })

  it('creates invite with 2 interests', async () => {
    mockInvitation()

    const response = await POST(
      jsonRequest({
        inviteeDisplayName: 'Sara',
        phone: '1 (734) 555-1234',
        suggestedInterests: ['Sondheim', 'Mrs. Dalloway'],
      })
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(createFriendInvitationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        inviteePhone: '+17345551234',
        preSeededInterests: ['Sondheim', 'Mrs. Dalloway'],
      })
    )
    expect(body.message).toBe(
      'Hey — come play Joshing with me. I added a couple areas I think you might like: Sondheim and Mrs. Dalloway. No app to download — just tap this: https://joshing.example/invite/token-1'
    )
  })

  it('creates invite with 3 trimmed and deduped interests', async () => {
    mockInvitation()

    const response = await POST(
      jsonRequest({
        inviteeDisplayName: 'Sara',
        phone: '7345551234',
        suggestedInterests: [
          'Sondheim',
          'Mrs. Dalloway',
          '1980s Saturday morning cartoons',
          'sondheim',
          '  ',
        ],
      })
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(createFriendInvitationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        preSeededInterests: [
          'Sondheim',
          'Mrs. Dalloway',
          '1980s Saturday morning cartoons',
        ],
      })
    )
    expect(body.message).toBe(
      'Hey — come play Joshing with me. I added a few areas I think you might like: Sondheim, Mrs. Dalloway, and 1980s Saturday morning cartoons. No app to download — just tap this: https://joshing.example/invite/token-1'
    )
  })

  it('fails safely when the normalized phone belongs to the inviter', async () => {
    state.existingUser = { id: 'user-inviter' }

    const response = await POST(
      jsonRequest({
        inviteeDisplayName: 'Sara',
        phone: '(734) 555-1234',
        suggestedInterests: [],
      })
    )
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body).toEqual(expect.objectContaining({ error: 'self_invite' }))
    expect(createFriendInvitationMock).not.toHaveBeenCalled()
    expect(dbMock.insert).not.toHaveBeenCalled()
  })

  it('creates a pending friendship request for an existing user instead of a signup invite', async () => {
    state.existingUser = { id: 'user-invitee' }

    const response = await POST(
      jsonRequest({
        inviteeDisplayName: 'Sara',
        phone: '7345551234',
        suggestedInterests: ['Poetry'],
      })
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(createFriendInvitationMock).not.toHaveBeenCalled()
    expect(dbMock.insert).toHaveBeenCalled()
    expect(body).toEqual(
      expect.objectContaining({
        type: 'friendship_request',
        state: 'created',
        invitationId: null,
        inviteUrl: null,
        suggestedInterests: ['Poetry'],
      })
    )
    expect(body.friendshipRequest).toEqual(
      expect.objectContaining({
        id: 'friendship-1',
        status: 'pending',
        state: 'created',
        inviteeUserId: 'user-invitee',
      })
    )
  })

  it('returns already-friends state without creating a duplicate friendship request', async () => {
    state.existingUser = { id: 'user-invitee' }
    state.existingFriendship = {
      id: 'friendship-active',
      status: 'active',
      requestedByUserId: 'user-inviter',
    }

    const response = await POST(
      jsonRequest({ inviteeDisplayName: 'Sara', phone: '7345551234' })
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(createFriendInvitationMock).not.toHaveBeenCalled()
    expect(dbMock.insert).not.toHaveBeenCalled()
    expect(body.state).toBe('already_friends')
    expect(body.friendshipRequest).toEqual(
      expect.objectContaining({
        id: 'friendship-active',
        status: 'active',
        state: 'already_friends',
      })
    )
  })

  it('prevents duplicate pending requests by returning the existing pending state', async () => {
    state.existingUser = { id: 'user-invitee' }
    state.existingFriendship = {
      id: 'friendship-pending',
      status: 'pending',
      requestedByUserId: 'user-inviter',
    }

    const response = await POST(
      jsonRequest({ inviteeDisplayName: 'Sara', phone: '7345551234' })
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(dbMock.insert).not.toHaveBeenCalled()
    expect(body.state).toBe('pending_existing')
  })

  it('handles reverse pending requests without creating a duplicate friendship request', async () => {
    state.existingUser = { id: 'user-invitee' }
    state.existingFriendship = {
      id: 'friendship-reverse',
      status: 'pending',
      requestedByUserId: 'user-invitee',
    }

    const response = await POST(
      jsonRequest({ inviteeDisplayName: 'Sara', phone: '7345551234' })
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(dbMock.insert).not.toHaveBeenCalled()
    expect(body.state).toBe('reverse_pending')
  })

  it('rejects 4 interests', async () => {
    const response = await POST(
      jsonRequest({
        inviteeDisplayName: 'Sara',
        phone: '7345551234',
        suggestedInterests: ['A', 'B', 'C', 'D'],
      })
    )

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual(
      expect.objectContaining({ error: 'too_many_suggested_interests' })
    )
    expect(createFriendInvitationMock).not.toHaveBeenCalled()
  })

  it('rejects invalid phone', async () => {
    const response = await POST(
      jsonRequest({ inviteeDisplayName: 'Sara', phone: '123' })
    )

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual(
      expect.objectContaining({ error: 'invalid_phone' })
    )
    expect(createFriendInvitationMock).not.toHaveBeenCalled()
  })

  it('rejects missing name', async () => {
    const response = await POST(jsonRequest({ phone: '7345551234' }))

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual(
      expect.objectContaining({ error: 'missing_invitee_display_name' })
    )
    expect(createFriendInvitationMock).not.toHaveBeenCalled()
  })

  it('prevents duplicate active pending invites by returning the reused invitation', async () => {
    mockInvitation({ id: 'inv-existing', token: 'existing-token' })

    const response = await POST(
      jsonRequest({ inviteeDisplayName: 'Sara', phone: '7345551234' })
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.id).toBe('inv-existing')
    expect(body.inviteUrl).toBe('https://joshing.example/invite/existing-token')
  })

  it('does not call Twilio/sendSms', async () => {
    mockInvitation()

    await POST(jsonRequest({ inviteeDisplayName: 'Sara', phone: '7345551234' }))

    expect(sendSms).not.toHaveBeenCalled()
    expect(sendSmsMock).not.toHaveBeenCalled()
  })
})

describe('friend invitation validation and message QA contract', () => {
  it.each([
    {
      interests: [],
      expected:
        'Hey — come play Joshing with me. No app to download — just tap this: https://joshing.example/invite/token-1',
    },
    {
      interests: ['Jazz'],
      expected:
        'Hey — come play Joshing with me. I added something I think you might like: Jazz. No app to download — just tap this: https://joshing.example/invite/token-1',
    },
    {
      interests: ['Jazz', 'Poetry'],
      expected:
        'Hey — come play Joshing with me. I added a couple areas I think you might like: Jazz and Poetry. No app to download — just tap this: https://joshing.example/invite/token-1',
    },
    {
      interests: ['Jazz', 'Poetry', 'Film'],
      expected:
        'Hey — come play Joshing with me. I added a few areas I think you might like: Jazz, Poetry, and Film. No app to download — just tap this: https://joshing.example/invite/token-1',
    },
  ])(
    'formats copy for $interests.length suggested interests without leaderboard or score language',
    ({ interests, expected }) => {
      const message = buildFriendInvitationMessage({
        inviteUrl: 'https://joshing.example/invite/token-1',
        suggestedInterests: interests,
      })

      expect(message).toBe(expected)
      expect(message).not.toMatch(
        /leaderboard|ranking|rank|score|points?|percent|%|timer|hurry|urgent/i
      )
    }
  )

  it('returns a valid invite URL and normalized phone for supported US phone formats', async () => {
    mockInvitation()

    const response = await POST(
      jsonRequest({
        inviteeDisplayName: 'Sara',
        phone: '+1 734.555.1234',
        suggestedInterests: ['Jazz'],
      })
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(() => new URL(body.inviteUrl)).not.toThrow()
    expect(new URL(body.inviteUrl).pathname).toBe('/invite/token-1')
    expect(body.inviteePhone).toBe('+17345551234')
  })

  it('validates supported interest counts and rejects the fourth unique interest before persistence', () => {
    for (const suggestedInterests of [[], ['A'], ['A', 'B'], ['A', 'B', 'C']]) {
      expect(
        validateCreateFriendInvitationBody({
          inviteeDisplayName: 'Sara',
          phone: '7345551234',
          suggestedInterests,
        })
      ).toEqual(expect.objectContaining({ ok: true }))
    }

    expect(
      validateCreateFriendInvitationBody({
        inviteeDisplayName: 'Sara',
        phone: '7345551234',
        suggestedInterests: ['A', 'B', 'C', 'D'],
      })
    ).toEqual(
      expect.objectContaining({
        ok: false,
        error: 'too_many_suggested_interests',
      })
    )
  })
})
