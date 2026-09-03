import { beforeEach, describe, expect, it, vi } from 'vitest'

const { state, writeActivityMock, dbMock, getInviterForUserMock, masteryEvents, activityItems } =
  vi.hoisted(() => {
    const state = {
      played: 0,
      inviter: null as {
        inviterUserId: string
        inviterName: string | null
        sourceId: string
        sourceType: 'friend_invitation' | 'follow'
      } | null,
      existingActivityRows: [] as Array<{ id: string }>,
    }

    // Sentinel table objects so the db mock can dispatch on which table a
    // select reads from.
    const masteryEvents = { __table: 'mastery' }
    const activityItems = { __table: 'activities' }

    const dbMock = {
      select: vi.fn(() => ({
        from: vi.fn((table: unknown) => {
          if (table === masteryEvents) {
            // Counting query: awaited directly off .where(), no .limit().
            return { where: vi.fn(async () => [{ played: state.played }]) }
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
      getInviterForUserMock: vi.fn(async () => state.inviter),
      masteryEvents,
      activityItems,
    }
  })

vi.mock('@/server/db', () => ({
  db: dbMock,
  masteryEvents,
  activityItems,
}))

vi.mock('@/server/activity/write-activity', () => ({ writeActivity: writeActivityMock }))
vi.mock('@/server/db/queries/friend-invitations', () => ({
  getInviterForUser: getInviterForUserMock,
}))

import { maybeNotifyInviterOfFirstFive } from '@/server/activity/invite-onboarding'

describe('maybeNotifyInviterOfFirstFive', () => {
  beforeEach(() => {
    state.played = 0
    state.inviter = null
    state.existingActivityRows = []
    writeActivityMock.mockClear()
    getInviterForUserMock.mockClear()
  })

  it('does nothing before the fifth play', async () => {
    state.played = 4
    state.inviter = {
      inviterUserId: 'inviter1',
      inviterName: null,
      sourceId: 'inv1',
      sourceType: 'friend_invitation',
    }

    await maybeNotifyInviterOfFirstFive('invitee1')

    expect(writeActivityMock).not.toHaveBeenCalled()
  })

  it('notifies the inviter on the exact fifth play (named invitation)', async () => {
    state.played = 5
    state.inviter = {
      inviterUserId: 'inviter1',
      inviterName: null,
      sourceId: 'inv1',
      sourceType: 'friend_invitation',
    }

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

  // Boundary-level coverage per Stage 1: a link-arrived user has no
  // FriendInvitation row — the resolver falls back to the Follow edge, and
  // this consumer must write the milestone against THAT id/type, not silently
  // skip the notification the way the pre-resolver code did.
  it('notifies the inviter on the exact fifth play (link-arrived, follow fallback)', async () => {
    state.played = 5
    state.inviter = {
      inviterUserId: 'inviter2',
      inviterName: 'Jaime',
      sourceId: 'follow-1',
      sourceType: 'follow',
    }

    await maybeNotifyInviterOfFirstFive('invitee2')

    expect(writeActivityMock).toHaveBeenCalledTimes(1)
    expect(writeActivityMock).toHaveBeenCalledWith({
      userId: 'inviter2',
      type: 'invited_friend_played_first_five',
      actorUserId: 'invitee2',
      referenceId: 'follow-1',
      referenceType: 'follow',
    })
  })

  it('does not re-fire past the fifth play', async () => {
    state.played = 6
    state.inviter = {
      inviterUserId: 'inviter1',
      inviterName: null,
      sourceId: 'inv1',
      sourceType: 'friend_invitation',
    }

    await maybeNotifyInviterOfFirstFive('invitee1')

    expect(writeActivityMock).not.toHaveBeenCalled()
  })

  it('does nothing when the user did not join via an invitation or invite link', async () => {
    state.played = 5
    state.inviter = null

    await maybeNotifyInviterOfFirstFive('invitee1')

    expect(writeActivityMock).not.toHaveBeenCalled()
  })

  it('is idempotent when the milestone activity already exists', async () => {
    state.played = 5
    state.inviter = {
      inviterUserId: 'inviter1',
      inviterName: null,
      sourceId: 'inv1',
      sourceType: 'friend_invitation',
    }
    state.existingActivityRows = [{ id: 'existing1' }]

    await maybeNotifyInviterOfFirstFive('invitee1')

    expect(writeActivityMock).not.toHaveBeenCalled()
  })
})
