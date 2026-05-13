import { beforeEach, describe, expect, it, vi } from 'vitest'

type Invitation = {
  id: string
  inviterUserId: string
  inviteePhone: string
  inviteeUserId: string | null
  acceptedAt: Date | null
  expiresAt: Date
}

const { dbMock, state } = vi.hoisted(() => {
  const state = {
    invitation: undefined as Invitation | undefined,
    updateReturnsClaim: true,
    friendshipValues: [] as unknown[],
  }

  function makeInsertBuilder() {
    return {
      values: vi.fn((values: unknown) => {
        state.friendshipValues.push(values)
        return {
          onConflictDoUpdate: vi.fn(async () => undefined),
        }
      }),
    }
  }

  const tx = {
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => ({
          returning: vi.fn(async () =>
            state.updateReturnsClaim
              ? [{ id: state.invitation?.id ?? 'inv-1' }]
              : []
          ),
        })),
      })),
    })),
    insert: vi.fn(() => makeInsertBuilder()),
  }

  const dbMock = {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(async () =>
            state.invitation ? [state.invitation] : []
          ),
        })),
      })),
    })),
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
    inviteeUserId: 'friendInvitations.inviteeUserId',
  },
}))

vi.mock('@/server/db/schema', () => ({
  friendships: {
    userAId: 'friendships.userAId',
    userBId: 'friendships.userBId',
  },
}))

import { acceptFriendInvitation } from '@/server/friends/invitations'

const now = new Date('2026-05-13T12:00:00.000Z')
const matchingPhone = '+15551234567'

function setInvitation(overrides: Partial<Invitation> = {}) {
  state.invitation = {
    id: 'inv-1',
    inviterUserId: 'user-inviter',
    inviteePhone: matchingPhone,
    inviteeUserId: null,
    acceptedAt: null,
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
