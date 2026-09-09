import { describe, expect, it } from 'vitest';

import { buildLoginInviteViews } from '@/app/login/build-invite-views';

describe('buildLoginInviteViews', () => {
  it('returns both null when neither a prefill nor a link resolution exists', () => {
    const result = buildLoginInviteViews(null, null);
    expect(result).toEqual({ invitePrefill: null, inviteContext: null });
  });

  it('the named (FriendInvitation) prefill builds both invitePrefill and inviteContext', () => {
    const prefill = {
      inviterName: 'Alex Inviter',
      inviterUserId: 'inviter-1',
      inviterAvatarColor: '#abc',
      inviteePhone: '+17345550123',
    };

    const result = buildLoginInviteViews(prefill, null);

    expect(result.invitePrefill).toEqual(prefill);
    expect(result.inviteContext).toEqual({
      inviterName: 'Alex Inviter',
      inviterUserId: 'inviter-1',
      inviterAvatarColor: '#abc',
    });
  });

  it('the per-user invite-link resolution builds topic-free inviter context', () => {
    const userInviteResolution = {
      inviterDisplayName: 'Jaime Rivera',
      inviterHandle: 'jaime',
      inviterUserId: 'inviter-2',
      inviterAvatarColor: '#def',
      seedTopics: ['Jazz', 'Poetry'],
    };

    const result = buildLoginInviteViews(null, userInviteResolution);

    expect(result.invitePrefill).toBeNull();
    expect(result.inviteContext).toEqual({
      inviterName: 'Jaime Rivera',
      inviterUserId: 'inviter-2',
      inviterAvatarColor: '#def',
    });
  });

  it('uses a neutral fallback when the link inviter has no safe display name', () => {
    const userInviteResolution = {
      inviterDisplayName: null,
      inviterHandle: 'jaime',
      inviterUserId: 'inviter-2',
      inviterAvatarColor: null,
      seedTopics: [],
    };

    const result = buildLoginInviteViews(null, userInviteResolution);

    expect(result.inviteContext?.inviterName).toBe('A friend');
  });

  it('the named prefill wins over a simultaneous link resolution', () => {
    const prefill = {
      inviterName: 'Alex Inviter',
      inviterUserId: 'inviter-1',
      inviterAvatarColor: null,
      inviteePhone: '+17345550123',
    };
    const userInviteResolution = {
      inviterDisplayName: 'Jaime Rivera',
      inviterHandle: 'jaime',
      inviterUserId: 'inviter-2',
      inviterAvatarColor: null,
      seedTopics: ['Jazz'],
    };

    const result = buildLoginInviteViews(prefill, userInviteResolution);

    expect(result.invitePrefill?.inviterUserId).toBe('inviter-1');
    expect(result.inviteContext?.inviterUserId).toBe('inviter-1');
  });
});
