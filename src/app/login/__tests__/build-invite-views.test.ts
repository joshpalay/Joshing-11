import { describe, expect, it } from 'vitest'

import { buildLoginInviteViews } from '@/app/login/build-invite-views'

describe('buildLoginInviteViews', () => {
  it('returns both null when neither a prefill nor a link resolution exists', () => {
    const result = buildLoginInviteViews(null, null)
    expect(result).toEqual({ invitePrefill: null, inviteContext: null })
  })

  it('the named (FriendInvitation) prefill builds both invitePrefill and a topic-free inviteContext', () => {
    const prefill = {
      inviterName: 'Alex Inviter',
      inviterUserId: 'inviter-1',
      inviterAvatarColor: '#abc',
      inviteePhone: '+17345550123',
    }

    const result = buildLoginInviteViews(prefill, null)

    expect(result.invitePrefill).toEqual(prefill)
    expect(result.inviteContext).toEqual({
      inviterName: 'Alex Inviter',
      inviterUserId: 'inviter-1',
      inviterAvatarColor: '#abc',
    })
    // Boundary-level check per the Stage 4 audit's rule ("Do not touch the
    // named path"): the named path never carries topics.
    expect(result.inviteContext).not.toHaveProperty('topics')
  })

  it('the per-user invite-link resolution builds only inviteContext, with its seedTopics as topics', () => {
    const userInviteResolution = {
      inviterDisplayName: 'Jaime Rivera',
      inviterHandle: 'jaime',
      inviterUserId: 'inviter-2',
      inviterAvatarColor: '#def',
      seedTopics: ['Jazz', 'Poetry'],
    }

    const result = buildLoginInviteViews(null, userInviteResolution)

    expect(result.invitePrefill).toBeNull()
    expect(result.inviteContext).toEqual({
      inviterName: 'Jaime Rivera',
      inviterUserId: 'inviter-2',
      inviterAvatarColor: '#def',
      topics: ['Jazz', 'Poetry'],
    })
  })

  it('falls back to "@handle" when the link inviter has no display name', () => {
    const userInviteResolution = {
      inviterDisplayName: null,
      inviterHandle: 'jaime',
      inviterUserId: 'inviter-2',
      inviterAvatarColor: null,
      seedTopics: [],
    }

    const result = buildLoginInviteViews(null, userInviteResolution)

    expect(result.inviteContext?.inviterName).toBe('@jaime')
    expect(result.inviteContext?.topics).toEqual([])
  })

  it('the named prefill wins over a simultaneous link resolution', () => {
    const prefill = {
      inviterName: 'Alex Inviter',
      inviterUserId: 'inviter-1',
      inviterAvatarColor: null,
      inviteePhone: '+17345550123',
    }
    const userInviteResolution = {
      inviterDisplayName: 'Jaime Rivera',
      inviterHandle: 'jaime',
      inviterUserId: 'inviter-2',
      inviterAvatarColor: null,
      seedTopics: ['Jazz'],
    }

    const result = buildLoginInviteViews(prefill, userInviteResolution)

    expect(result.invitePrefill?.inviterUserId).toBe('inviter-1')
    expect(result.inviteContext?.inviterUserId).toBe('inviter-1')
    expect(result.inviteContext).not.toHaveProperty('topics')
  })
})
