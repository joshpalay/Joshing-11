import { beforeEach, describe, expect, it, vi } from 'vitest'

type Invitation = {
  id: string
  inviterUserId: string
  inviteePhone: string
  inviteeUserId: string | null
  inviteeDisplayName: string | null
  preSeededInterests: unknown
  personalMessage: string | null
  token: string
  sentAt: Date
  acceptedAt: Date | null
  cancelledAt: Date | null
  expiresAt: Date
}

const { dbMock, state } = vi.hoisted(() => {
  const state = {
    invitation: undefined as Invitation | undefined,
    updateReturnsClaim: true,
    friendshipValues: [] as unknown[],
    invitationValues: undefined as Record<string, unknown> | undefined,
    updateValues: undefined as Record<string, unknown> | undefined,
  }

  function makeSelectBuilder() {
    const limited = {
      limit: vi.fn(async () => (state.invitation ? [state.invitation] : [])),
    }
    return {
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          ...limited,
          orderBy: vi.fn(() => limited),
        })),
      })),
    }
  }

  function makeUpdateBuilder({ claimOnly = false } = {}) {
    return {
      set: vi.fn((values: Record<string, unknown>) => {
        state.updateValues = values
        return {
          where: vi.fn(() => ({
            returning: vi.fn(async () => {
              if (claimOnly) {
                return state.updateReturnsClaim
                  ? [{ id: state.invitation?.id ?? 'inv-1' }]
                  : []
              }

              if (!state.invitation) return []
              state.invitation = { ...state.invitation, ...values }
              return [state.invitation]
            }),
          })),
        }
      }),
    }
  }

  function makeInsertBuilder({ friendshipOnly = false } = {}) {
    return {
      values: vi.fn((values: Record<string, unknown>) => {
        if (friendshipOnly) {
          state.friendshipValues.push(values)
          return {
            onConflictDoUpdate: vi.fn(async () => undefined),
          }
        }

        state.invitationValues = values
        const created = {
          id: 'inv-created',
          inviteeUserId: null,
          acceptedAt: null,
          cancelledAt: null,
          ...values,
        } as Invitation
        state.invitation = created
        return {
          returning: vi.fn(async () => [created]),
        }
      }),
    }
  }

  const tx = {
    update: vi.fn(() => makeUpdateBuilder({ claimOnly: true })),
    insert: vi.fn(() => makeInsertBuilder({ friendshipOnly: true })),
  }

  const dbMock = {
    select: vi.fn(() => makeSelectBuilder()),
    update: vi.fn(() => makeUpdateBuilder()),
    insert: vi.fn(() => makeInsertBuilder()),
    transaction: vi.fn(async (callback: (tx: typeof tx) => unknown) =>
      callback(tx)
    ),
    tx,
  }

  return { dbMock, state }
})

vi.mock('@/server/db', () => ({
  db: dbMock,
  friendInvitations: {
    id: 'friendInvitations.id',
    token: 'friendInvitations.token',
    acceptedAt: 'friendInvitations.acceptedAt',
    inviteePhone: 'friendInvitations.inviteePhone',
    inviteeDisplayName: 'friendInvitations.inviteeDisplayName',
    inviterUserId: 'friendInvitations.inviterUserId',
    sentAt: 'friendInvitations.sentAt',
    cancelledAt: 'friendInvitations.cancelledAt',
    expiresAt: 'friendInvitations.expiresAt',
    preSeededInterests: 'friendInvitations.preSeededInterests',
    personalMessage: 'friendInvitations.personalMessage',
    inviteeUserId: 'friendInvitations.inviteeUserId',
  },
}))

vi.mock('@/server/db/schema', () => ({
  friendships: {
    userAId: 'friendships.userAId',
    userBId: 'friendships.userBId',
  },
}))

import {
  acceptFriendInvitation,
  cancelFriendInvitation,
  createFriendInvitation,
  getInvitationByToken,
  getPendingInvitationForPhone,
} from '@/server/friends/invitations'
import { parsePreSeededInterests } from '@/server/db/queries/users'

const now = new Date('2026-05-13T12:00:00.000Z')
const matchingPhone = '+15551234567'

function setInvitation(overrides: Partial<Invitation> = {}) {
  state.invitation = {
    id: 'inv-1',
    inviterUserId: 'user-inviter',
    inviteePhone: matchingPhone,
    inviteeDisplayName: 'Morgan',
    preSeededInterests: null,
    personalMessage: null,
    token: 'valid-token',
    sentAt: new Date('2026-05-13T11:30:00.000Z'),
    inviteeUserId: null,
    acceptedAt: null,
    cancelledAt: null,
    expiresAt: new Date('2026-05-14T12:00:00.000Z'),
    ...overrides,
  }
}

describe('acceptFriendInvitation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    state.invitation = undefined
    state.updateReturnsClaim = true
    state.friendshipValues = []
    state.invitationValues = undefined
    state.updateValues = undefined
  })

  it('accepts a valid token for the matching verified phone and creates an invitation friendship', async () => {
    setInvitation()

    const result = await acceptFriendInvitation({
      token: 'valid-token',
      inviteeUserId: 'user-invitee',
      verifiedPhone: matchingPhone,
      now,
    })

    expect(result).toEqual({ accepted: true })
    expect(dbMock.transaction).toHaveBeenCalledTimes(1)
    expect(state.friendshipValues).toEqual([
      expect.objectContaining({
        userAId: 'user-invitee',
        userBId: 'user-inviter',
        status: 'active',
        requestedByUserId: 'user-inviter',
        formedVia: 'invitation',
        formedAt: now,
        removedAt: null,
        removedByUserId: null,
      }),
    ])
  })

  it('rejects a valid token when the verified phone does not match the invitation phone', async () => {
    setInvitation()

    const result = await acceptFriendInvitation({
      token: 'valid-token',
      inviteeUserId: 'user-invitee',
      verifiedPhone: '+15557654321',
      now,
    })

    expect(result).toEqual({ accepted: false, reason: 'phone_mismatch' })
    expect(dbMock.transaction).not.toHaveBeenCalled()
    expect(state.friendshipValues).toEqual([])
  })

  it('rejects expired invitations', async () => {
    setInvitation({ expiresAt: new Date('2026-05-12T12:00:00.000Z') })

    await expect(
      acceptFriendInvitation({
        token: 'expired-token',
        inviteeUserId: 'user-invitee',
        verifiedPhone: matchingPhone,
        now,
      })
    ).resolves.toEqual({ accepted: false, reason: 'expired' })
    expect(state.friendshipValues).toEqual([])
  })

  it('rejects invitations at the exact expiration instant', async () => {
    setInvitation({ expiresAt: now })

    await expect(
      acceptFriendInvitation({
        token: 'expired-token',
        inviteeUserId: 'user-invitee',
        verifiedPhone: matchingPhone,
        now,
      })
    ).resolves.toEqual({ accepted: false, reason: 'expired' })
    expect(dbMock.transaction).not.toHaveBeenCalled()
    expect(state.friendshipValues).toEqual([])
  })

  it('rejects already accepted invitations', async () => {
    setInvitation({ acceptedAt: new Date('2026-05-13T11:00:00.000Z') })

    await expect(
      acceptFriendInvitation({
        token: 'accepted-token',
        inviteeUserId: 'user-invitee',
        verifiedPhone: matchingPhone,
        now,
      })
    ).resolves.toEqual({ accepted: false, reason: 'accepted' })
    expect(state.friendshipValues).toEqual([])
  })

  it('rejects self-invites', async () => {
    setInvitation({ inviterUserId: 'same-user' })

    await expect(
      acceptFriendInvitation({
        token: 'self-token',
        inviteeUserId: 'same-user',
        verifiedPhone: matchingPhone,
        now,
      })
    ).resolves.toEqual({ accepted: false, reason: 'self' })
    expect(state.friendshipValues).toEqual([])
  })

  it('does not create a friendship when the invitation claim update fails', async () => {
    setInvitation()
    state.updateReturnsClaim = false

    await expect(
      acceptFriendInvitation({
        token: 'raced-token',
        inviteeUserId: 'user-invitee',
        verifiedPhone: matchingPhone,
        now,
      })
    ).resolves.toEqual({ accepted: false, reason: 'claim_failed' })
    expect(state.friendshipValues).toEqual([])
  })
})

describe('friend invitation helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    state.invitation = undefined
    state.updateReturnsClaim = true
    state.friendshipValues = []
    state.invitationValues = undefined
    state.updateValues = undefined
  })

  it('creates an Add Friend invitation with invitee display name, phone, and suggested interests', async () => {
    const preSeededInterests = [{ label: 'Jazz', broadCategory: 'music' }]

    const invitation = await createFriendInvitation({
      inviterUserId: 'user-inviter',
      inviteePhone: matchingPhone,
      inviteeDisplayName: '  Morgan   Lee ',
      preSeededInterests,
      personalMessage: 'Join me?',
      now,
    })

    expect(invitation).toEqual(
      expect.objectContaining({
        inviteePhone: matchingPhone,
        inviteeDisplayName: 'Morgan Lee',
        preSeededInterests,
        personalMessage: 'Join me?',
      })
    )
    expect(state.invitationValues).toEqual(
      expect.objectContaining({
        inviterUserId: 'user-inviter',
        inviteePhone: matchingPhone,
        inviteeDisplayName: 'Morgan Lee',
        preSeededInterests,
        sentAt: now,
      })
    )
    expect(typeof state.invitationValues?.token).toBe('string')
  })

  it('uses the inviteePhone lookup helper for pending invitations', async () => {
    setInvitation({ inviteeDisplayName: 'Morgan' })

    await expect(
      getPendingInvitationForPhone({
        inviterUserId: 'user-inviter',
        inviteePhone: matchingPhone,
        now,
      })
    ).resolves.toEqual(expect.objectContaining({ inviteePhone: matchingPhone }))

    expect(dbMock.select).toHaveBeenCalledTimes(1)
  })

  it('updates an existing pending invite instead of creating a duplicate', async () => {
    setInvitation({ preSeededInterests: [{ label: 'Jazz' }] })

    const invitation = await createFriendInvitation({
      inviterUserId: 'user-inviter',
      inviteePhone: matchingPhone,
      inviteeDisplayName: 'Morgan Updated',
      preSeededInterests: [{ label: 'Poetry' }],
      now,
    })

    expect(dbMock.insert).not.toHaveBeenCalled()
    expect(invitation).toEqual(
      expect.objectContaining({
        id: 'inv-1',
        inviteeDisplayName: 'Morgan Updated',
        preSeededInterests: [{ label: 'Poetry' }],
      })
    )
  })

  it('keeps existing invitation rows readable when display name is absent', async () => {
    setInvitation({ inviteeDisplayName: null })

    await expect(getInvitationByToken('valid-token')).resolves.toEqual(
      expect.objectContaining({
        id: 'inv-1',
        inviteeDisplayName: null,
      })
    )
  })

  it('can cancel a pending invitation when cancellation is supported', async () => {
    setInvitation()

    await expect(
      cancelFriendInvitation({
        invitationId: 'inv-1',
        inviterUserId: 'user-inviter',
        now,
      })
    ).resolves.toEqual(expect.objectContaining({ cancelledAt: now }))
  })

  it('still parses existing onboarding pre-seeded interests', () => {
    expect(
      parsePreSeededInterests([
        'Film',
        { label: 'Jazz', description: 'Blue Note', broad_category: 'music' },
        { label: 'Poetry', broadCategory: 'literature' },
      ])
    ).toEqual([
      { label: 'Film' },
      { label: 'Jazz', description: 'Blue Note', broadCategory: 'music' },
      { label: 'Poetry', description: null, broadCategory: 'literature' },
    ])
  })
})
