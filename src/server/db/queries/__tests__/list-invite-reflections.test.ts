import { beforeEach, describe, expect, it, vi } from 'vitest'

const { dbMock, getRelationshipsMock, state } = vi.hoisted(() => {
  const state = {
    rows: [] as Array<{
      invitation_id: string
      invitee_user_id: string
      handle: string | null
      display_name: string | null
      avatar_color: string | null
      joined_at: Date
      invited_at: Date
      accepted_at: Date | null
    }>,
  }

  const dbMock = {
    execute: vi.fn(async () => ({ rows: state.rows })),
  }

  return {
    dbMock,
    getRelationshipsMock: vi.fn(),
    state,
  }
})

vi.mock('@/server/db', () => ({ db: dbMock }))
vi.mock('@/server/db/queries/friend-requests', () => ({
  getRelationships: getRelationshipsMock,
}))

import { listInviteReflections } from '@/server/db/queries/friend-invitations'

function row(inviteeUserId: string, overrides: Partial<(typeof state.rows)[number]> = {}) {
  return {
    invitation_id: `inv-${inviteeUserId}`,
    invitee_user_id: inviteeUserId,
    handle: inviteeUserId,
    display_name: `Display ${inviteeUserId}`,
    avatar_color: null,
    joined_at: new Date('2026-08-01T00:00:00.000Z'),
    invited_at: new Date('2026-07-01T00:00:00.000Z'),
    accepted_at: new Date('2026-08-01T00:00:00.000Z'),
    ...overrides,
  }
}

// Regression test for the Stage 5 fix: the SQL's NOT EXISTS against the
// legacy "Friendship" table only catches pre-follow-model connections — the
// follow model has never written a Friendship row, so a same-day mutual
// follow used to sail straight through and still get listed as "not yet
// friended." The post-fetch relationship.state === 'friends' check closes
// that gap using the same getRelationships the isBlocked filter already read.
describe('listInviteReflections', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    state.rows = []
  })

  it('excludes an invitee who is already mutual friends via the follows model', async () => {
    state.rows = [row('invitee-friends'), row('invitee-none')]
    getRelationshipsMock.mockResolvedValueOnce(
      new Map([
        ['invitee-friends', { state: 'friends', friendshipId: 'f1', formedAt: new Date(), isBlocked: false }],
        ['invitee-none', { state: 'none', friendshipId: null, formedAt: null, isBlocked: false }],
      ]),
    )

    const result = await listInviteReflections('viewer-1')

    expect(result.map((r) => r.inviteeUserId)).toEqual(['invitee-none'])
  })

  it('keeps a one-directional or pending relationship (only fully mutual is excluded)', async () => {
    state.rows = [row('invitee-following'), row('invitee-pending-out')]
    getRelationshipsMock.mockResolvedValueOnce(
      new Map([
        ['invitee-following', { state: 'following', friendshipId: 'f1', formedAt: new Date(), isBlocked: false }],
        ['invitee-pending-out', { state: 'pending_outbound', friendshipId: 'f2', formedAt: null, isBlocked: false }],
      ]),
    )

    const result = await listInviteReflections('viewer-1')

    expect(result.map((r) => r.inviteeUserId).sort()).toEqual(
      ['invitee-following', 'invitee-pending-out'].sort(),
    )
  })

  it('still excludes blocked rows regardless of relationship state', async () => {
    state.rows = [row('invitee-blocked')]
    getRelationshipsMock.mockResolvedValueOnce(
      new Map([['invitee-blocked', { state: 'none', friendshipId: null, formedAt: null, isBlocked: true }]]),
    )

    const result = await listInviteReflections('viewer-1')

    expect(result).toEqual([])
  })

  it('returns [] without calling getRelationships when there are no SQL rows', async () => {
    state.rows = []

    const result = await listInviteReflections('viewer-1')

    expect(result).toEqual([])
    expect(getRelationshipsMock).not.toHaveBeenCalled()
  })
})
