import { beforeEach, describe, expect, it, vi } from 'vitest'

const { dbMock, state } = vi.hoisted(() => {
  const state = {
    row: undefined as
      | {
          preSeededInterests: unknown
          inviterName: string | null
          inviteeDisplayName: string | null
        }
      | undefined,
  }

  const limited = {
    limit: vi.fn(async () => (state.row ? [state.row] : [])),
  }
  const ordered = {
    orderBy: vi.fn(() => limited),
  }
  const whereable = {
    where: vi.fn(() => ordered),
  }
  const joinable = {
    leftJoin: vi.fn(() => whereable),
  }

  const dbMock = {
    select: vi.fn(() => ({
      from: vi.fn(() => joinable),
    })),
  }

  return { dbMock, state }
})

vi.mock('@/server/db', () => ({
  db: dbMock,
  declaredInterests: {},
  friendInvitations: {
    preSeededInterests: 'friendInvitations.preSeededInterests',
    inviterUserId: 'friendInvitations.inviterUserId',
    inviteeUserId: 'friendInvitations.inviteeUserId',
    inviteeDisplayName: 'friendInvitations.inviteeDisplayName',
    acceptedAt: 'friendInvitations.acceptedAt',
  },
  users: {
    id: 'users.id',
    displayName: 'users.displayName',
  },
}))

import { getPreSeededInterestsForUser } from '@/server/db/queries/users'

describe('getPreSeededInterestsForUser', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    state.row = undefined
  })

  it('loads inviter display name with accepted invite interests', async () => {
    state.row = {
      inviterName: '  Alex   Inviter  ',
      inviteeDisplayName: '  Morgan   Lee  ',
      preSeededInterests: [{ label: ' Sondheim ', broadCategory: 'Theater' }],
    }

    await expect(getPreSeededInterestsForUser('user-invitee')).resolves.toEqual({
      inviterName: 'Alex Inviter',
      inviteeDisplayName: 'Morgan Lee',
      interests: [{ label: 'Sondheim', description: null, broadCategory: 'Theater' }],
    })
  })

  it('returns a null inviter name when unavailable so UI can use friend fallback', async () => {
    state.row = {
      inviterName: '   ',
      inviteeDisplayName: null,
      preSeededInterests: ['Jazz'],
    }

    await expect(getPreSeededInterestsForUser('user-invitee')).resolves.toEqual({
      inviterName: null,
      inviteeDisplayName: null,
      interests: [{ label: 'Jazz' }],
    })
  })

  it('keeps non-invite onboarding empty', async () => {
    await expect(getPreSeededInterestsForUser('user-no-invite')).resolves.toEqual({
      inviterName: null,
      inviteeDisplayName: null,
      interests: [],
    })
  })
})
