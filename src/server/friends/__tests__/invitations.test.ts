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
    inviterName: 'Alex Inviter' as string | null,
  }

  function makeSelectBuilder(selection?: Record<string, unknown>) {
    const isLandingSelect = Boolean(selection && 'inviterName' in selection)
    const rows = () => {
      if (!state.invitation) return []
      if (!isLandingSelect) return [state.invitation]

      // Joined select (landing + prefill both leftJoin users). Superset of
      // both selections; the real query only reads the columns it selected, so
      // extra fields here are harmless.
      return [
        {
          acceptedAt: state.invitation.acceptedAt,
          cancelledAt: state.invitation.cancelledAt,
          expiresAt: state.invitation.expiresAt,
          preSeededInterests: state.invitation.preSeededInterests,
          inviteePhone: state.invitation.inviteePhone,
          inviterName: state.inviterName,
        },
      ]
    }
    const limited = {
      limit: vi.fn(async () => rows()),
    }
    const whereable = {
      where: vi.fn(() => ({
        ...limited,
        orderBy: vi.fn(() => limited),
      })),
    }
    return {
      from: vi.fn(() => ({
        ...whereable,
        leftJoin: vi.fn(() => whereable),
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
                if (!state.updateReturnsClaim || !state.invitation) return []
                state.invitation = { ...state.invitation, ...values }
                return [{ id: state.invitation.id }]
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
    select: vi.fn((selection?: Record<string, unknown>) =>
      makeSelectBuilder(selection)
    ),
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
  users: {
    id: 'users.id',
    displayName: 'users.displayName',
  },
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
  // upsertInvitationFriendship imports `follows` from @/server/db. Mirror the
  // columns it touches so the conflict-upsert builds.
  follows: {
    followerId: 'follows.followerId',
    followeeId: 'follows.followeeId',
  },
}))

// The one-time inviter feed backfill (B-HomeSeed-1) fires inside
// acceptFriendInvitation; it has its own dedicated test, so stub it here to keep
// these tests focused on the acceptance logic.
vi.mock('@/server/feed/backfill-inviter-feed', () => ({
  backfillInviterFeedItems: vi.fn(async () => ({ created: 0 })),
}))

import {
  acceptFriendInvitation,
  cancelFriendInvitation,
  createFriendInvitation,
  getFriendInvitationLandingByToken,
  getInvitationByToken,
  getInvitePrefillByToken,
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
    expect(state.invitation).toEqual(
      expect.objectContaining({
        acceptedAt: now,
        inviteeUserId: 'user-invitee',
      })
    )
    expect(dbMock.transaction).toHaveBeenCalledTimes(1)
    // Invitation creates a mutual follow: two approved edges, both directions.
    expect(state.friendshipValues).toEqual([
      expect.objectContaining({
        followerId: 'user-inviter',
        followeeId: 'user-invitee',
        state: 'approved',
        approvedAt: now,
      }),
      expect.objectContaining({
        followerId: 'user-invitee',
        followeeId: 'user-inviter',
        state: 'approved',
        approvedAt: now,
      }),
    ])
  })

  it("accepts Jaime's 000000-verified matching phone once and rejects wrong-phone or reused claims without duplicate friendship rows", async () => {
    setInvitation({
      inviterUserId: 'user-josh',
      inviteeDisplayName: 'Jaime',
      inviteePhone: '+17345550002',
      token: 'jaime-token',
    })

    await expect(
      acceptFriendInvitation({
        token: 'jaime-token',
        inviteeUserId: 'user-jaime-wrong-phone',
        verifiedPhone: '+17345559999',
        now,
      })
    ).resolves.toEqual({ accepted: false, reason: 'phone_mismatch' })
    expect(state.friendshipValues).toHaveLength(0)

    await expect(
      acceptFriendInvitation({
        token: 'jaime-token',
        inviteeUserId: 'user-jaime',
        verifiedPhone: '+17345550002',
        now,
      })
    ).resolves.toEqual({ accepted: true })
    expect(state.invitation).toEqual(
      expect.objectContaining({
        acceptedAt: now,
        inviteeUserId: 'user-jaime',
      })
    )
    expect(state.friendshipValues).toEqual([
      expect.objectContaining({
        followerId: 'user-josh',
        followeeId: 'user-jaime',
        state: 'approved',
        approvedAt: now,
      }),
      expect.objectContaining({
        followerId: 'user-jaime',
        followeeId: 'user-josh',
        state: 'approved',
        approvedAt: now,
      }),
    ])

    await expect(
      acceptFriendInvitation({
        token: 'jaime-token',
        inviteeUserId: 'user-jaime',
        verifiedPhone: '+17345550002',
        now,
      })
    ).resolves.toEqual({ accepted: false, reason: 'accepted' })
    // The already-accepted re-attempt writes no further edges: still exactly
    // the two approved edges from the single successful acceptance.
    expect(
      state.friendshipValues.filter(
        (edge) => (edge as { state?: string }).state === 'approved'
      )
    ).toHaveLength(2)
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

  it('rejects invalid or missing tokens without claiming an invitation', async () => {
    await expect(
      acceptFriendInvitation({
        token: 'not-a-real-token',
        inviteeUserId: 'user-invitee',
        verifiedPhone: matchingPhone,
        now,
      })
    ).resolves.toEqual({ accepted: false, reason: 'missing' })
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
    state.inviterName = 'Alex Inviter'
  })

  it('returns a safe valid landing state with inviter display name and suggested interest chips', async () => {
    setInvitation({
      preSeededInterests: [
        ' Jazz ',
        { label: 'Poetry' },
        'jazz',
        'Film',
        'Extra ignored',
      ],
    })

    // F1.5: pre-seeded interest labels MUST NOT appear in the public
    // landing payload. They are still stored on the invitation row and
    // surfaced to the recipient post-OTP via getPreSeededInterestsForUser.
    await expect(
      getFriendInvitationLandingByToken('valid-token', now)
    ).resolves.toEqual({
      status: 'valid',
      inviterName: 'Alex Inviter',
    })
  })

  it('returns an expired landing state with no leaked interest labels', async () => {
    setInvitation({
      expiresAt: new Date('2026-05-12T12:00:00.000Z'),
      preSeededInterests: ['Jazz'],
    })

    await expect(
      getFriendInvitationLandingByToken('expired-token', now)
    ).resolves.toEqual({
      status: 'expired',
      inviterName: 'Alex Inviter',
    })
  })

  it('returns an already accepted landing state that can route safely to login', async () => {
    setInvitation({ acceptedAt: new Date('2026-05-13T11:00:00.000Z') })

    await expect(
      getFriendInvitationLandingByToken('accepted-token', now)
    ).resolves.toEqual({
      status: 'accepted',
      inviterName: 'Alex Inviter',
    })
  })

  it('returns a generic invalid landing state for missing, cancelled, or blank tokens', async () => {
    await expect(getFriendInvitationLandingByToken('', now)).resolves.toEqual({
      status: 'invalid',
      inviterName: 'Someone',
      inviterUserId: null,
      inviterAvatarColor: null,
    })

    setInvitation({ cancelledAt: new Date('2026-05-13T11:00:00.000Z') })
    await expect(
      getFriendInvitationLandingByToken('cancelled-token', now)
    ).resolves.toEqual({
      status: 'invalid',
      inviterName: 'Someone',
      inviterUserId: null,
      inviterAvatarColor: null,
    })
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

  it('resolves a valid pending invite to inviter name, raw phone, and masked phone', async () => {
    setInvitation({ inviteePhone: '+17345556819' })

    await expect(getInvitePrefillByToken('valid-token', now)).resolves.toEqual({
      inviterName: 'Alex Inviter',
      inviterUserId: 'friend-invite',
      inviteePhone: '+17345556819',
      maskedPhone: '•••-•••-6819',
    })
  })

  it('falls back to "Someone" when the inviter has no display name', async () => {
    state.inviterName = null
    setInvitation({ inviteePhone: '+17345556819' })

    await expect(getInvitePrefillByToken('valid-token', now)).resolves.toEqual(
      expect.objectContaining({ inviterName: 'Someone' })
    )
  })

  it('returns null for blank, accepted, cancelled, or expired invites', async () => {
    await expect(getInvitePrefillByToken('', now)).resolves.toBeNull()

    setInvitation({ acceptedAt: new Date('2026-05-13T11:00:00.000Z') })
    await expect(getInvitePrefillByToken('accepted-token', now)).resolves.toBeNull()

    setInvitation({ cancelledAt: new Date('2026-05-13T11:00:00.000Z') })
    await expect(
      getInvitePrefillByToken('cancelled-token', now)
    ).resolves.toBeNull()

    setInvitation({ expiresAt: new Date('2026-05-12T12:00:00.000Z') })
    await expect(getInvitePrefillByToken('expired-token', now)).resolves.toBeNull()
  })

  it('returns null when the invite has no recipient phone', async () => {
    setInvitation({ inviteePhone: '' })
    await expect(getInvitePrefillByToken('valid-token', now)).resolves.toBeNull()
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
