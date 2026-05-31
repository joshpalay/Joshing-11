import assert from 'node:assert/strict';

import {
  FIRST_FIVE_PLAY_SURFACES,
  FIRST_FIVE_THRESHOLD,
  INVITED_FRIEND_FIRST_FIVE_TYPE,
  firstFiveActivityToWrite,
} from '../src/server/activity/invite-onboarding-policy.ts';

const invitation = { id: 'inv-1', inviterUserId: 'inviter-1' };

// Before the fifth play: the inviter is not notified yet.
assert.equal(
  firstFiveActivityToWrite({
    inviteeUserId: 'friend-1',
    playedCount: FIRST_FIVE_THRESHOLD - 1,
    invitation,
    alreadyNotified: false,
  }),
  null,
);

// Exactly the fifth play: notify the inviter, crediting the invited friend.
assert.deepEqual(
  firstFiveActivityToWrite({
    inviteeUserId: 'friend-1',
    playedCount: FIRST_FIVE_THRESHOLD,
    invitation,
    alreadyNotified: false,
  }),
  {
    userId: 'inviter-1',
    type: INVITED_FRIEND_FIRST_FIVE_TYPE,
    actorUserId: 'friend-1',
    referenceId: 'inv-1',
    referenceType: 'friend_invitation',
  },
);

// Past the threshold: only the exact crossing fires, never later answers.
assert.equal(
  firstFiveActivityToWrite({
    inviteeUserId: 'friend-1',
    playedCount: FIRST_FIVE_THRESHOLD + 1,
    invitation,
    alreadyNotified: false,
  }),
  null,
);

// Organic signup (no accepted invitation): nothing to notify.
assert.equal(
  firstFiveActivityToWrite({
    inviteeUserId: 'friend-1',
    playedCount: FIRST_FIVE_THRESHOLD,
    invitation: null,
    alreadyNotified: false,
  }),
  null,
);

// Already notified for this invitation: idempotent, no duplicate.
assert.equal(
  firstFiveActivityToWrite({
    inviteeUserId: 'friend-1',
    playedCount: FIRST_FIVE_THRESHOLD,
    invitation,
    alreadyNotified: true,
  }),
  null,
);

// The milestone counts the two surfaces a new user actually plays through.
assert.deepEqual([...FIRST_FIVE_PLAY_SURFACES], ['daily', 'joshing_game']);

console.log('invite-first-five.smoke: ok');
