import { NextRequest, NextResponse } from 'next/server';

import { isCronAuthorized } from '@/server/auth/cron';
import { getInvitationsNeedingReminder } from '@/server/friends/invitations';
import { writeActivity } from '@/server/activity/write-activity';

export const dynamic = 'force-dynamic';

// Daily nudge for the inviter: a FriendInvitation sent >= 30 days ago (the
// same TTL the invite itself lapses at) with no acceptance and no cancellation
// gets one 'friend_invitation_reminder' ActivityItem written to the inviter,
// surfaced on /activities as "{name} hasn't accepted your invite yet — Resend".
// getInvitationsNeedingReminder() already excludes invitations that have a
// prior reminder, so this is safe to run daily without re-notifying.
export async function GET(request: NextRequest) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const candidates = await getInvitationsNeedingReminder();

  await Promise.all(
    candidates.map((invitation) =>
      writeActivity({
        userId: invitation.inviterUserId,
        type: 'friend_invitation_reminder',
        referenceId: invitation.id,
        referenceType: 'friend_invitation',
      }),
    ),
  );

  return NextResponse.json({ ok: true, reminded: candidates.length });
}
