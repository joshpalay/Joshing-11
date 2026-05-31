import { beforeEach, describe, expect, it, vi } from 'vitest'

const { state, writeActivityMock, dbMock, masteryEvents, friendInvitations, activityItems } =
  vi.hoisted(() => {
    const state = {
      played: 0,
      invitationRows: [] as Array<{ id: string; inviterUserId: string }>,
      existingActivityRows: [] as Array<{ id: string }>,
    }

    // Sentinel table objects so the db mock can dispatch on which table a
    // select reads from.
    const masteryEvents = { __table: 'mastery' }
    const friendInvitations = { __table: 'invitations' }
    const activityItems = { __table: 'activities' }

    const dbMock = {
      select: vi.fn(() => ({
        from: vi.fn((table: unknown) => {
          if (table === masteryEvents) {
            // Counting query: awaited directly off .where(), no .limit().
            return { where: vi.fn(async () => [{ played: state.played }]) }
          }
          if (table === friendInvitations) {
            return {
              where: vi.fn(() => ({ limit: vi.fn(async () => state.invitationRows) })),
            }
          }
          return {
            where: vi.fn(() => ({ limit: vi.fn(async () => state.existingActivityRows) })),
          }
        }),
      })),
    }

    return {
      state,
      writeActivityMock: vi.fn(async () => {}),
      dbMock,
      masteryEvents,
      friendInvitations,
      activityItems,
    }
  })

vi.mock('@/server/db', () => ({
  db: dbMock,
  masteryEvents,
  friendInvitations,
  activityItems,
}))

vi.mock('@/server/activity/write-activity', () => ({ writeActivity: writeActivityMock }))

import { maybeNotifyInviterOfFirstFive } from '@/server/activity/invite-onboarding'

describe('maybeNotifyInviterOfFirstFive', () => {
  beforeEach(() => {
    state.played = 0
    state.invitationRows = []
    state.existingActivityRows = []
    writeActivityMock.mockClear()
  })

  it('does nothing before the fifth play', async () => {
    state.played = 4
    state.invitationRows = [{ id: 'inv1', inviterUserId: 'inviter1' }]

    await maybeNotifyInviterOfFirstFive('invitee1')

    expect(writeActivityMock).not.toHaveBeenCalled()
  })

  it('notifies the inviter on the exact fifth play', async () => {
    state.played = 5
    state.invitationRows = [{ id: 'inv1', inviterUserId: 'inviter1' }]

    await maybeNotifyInviterOfFirstFive('invitee1')

    expect(writeActivityMock).toHaveBeenCalledTimes(1)
    expect(writeActivityMock).toHaveBeenCalledWith({
      userId: 'inviter1',
      type: 'invited_friend_played_first_five',
      actorUserId: 'invitee1',
      referenceId: 'inv1',
      referenceType: 'friend_invitation',
    })
  })

  it('does not re-fire past the fifth play', async () => {
    state.played = 6
    state.invitationRows = [{ id: 'inv1', inviterUserId: 'inviter1' }]

    await maybeNotifyInviterOfFirstFive('invitee1')

    expect(writeActivityMock).not.toHaveBeenCalled()
  })

  it('does nothing when the user did not join via an invitation', async () => {
    state.played = 5
    state.invitationRows = []

    await maybeNotifyInviterOfFirstFive('invitee1')

    expect(writeActivityMock).not.toHaveBeenCalled()
  })

  it('is idempotent when the milestone activity already exists', async () => {
    state.played = 5
    state.invitationRows = [{ id: 'inv1', inviterUserId: 'inviter1' }]
    state.existingActivityRows = [{ id: 'existing1' }]

    await maybeNotifyInviterOfFirstFive('invitee1')

    expect(writeActivityMock).not.toHaveBeenCalled()
  })
})
