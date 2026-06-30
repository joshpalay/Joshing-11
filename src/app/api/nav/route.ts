import { NextResponse } from 'next/server';

import { getSession } from '@/server/auth/session';
import { getUserOnboardingProfile } from '@/server/db/queries/users';
import { getIncomingFollowRequestCount } from '@/server/db/queries/friends';
import { getNewDiscoveryStatus } from '@/server/db/queries/contact-hashes';

export const dynamic = 'force-dynamic';

// Nav badge summary: the display name (for the account-initials avatar), the
// pending friend-request count (badged on the Friends tab, where requests are
// accepted/declined), and whether the Friends tab should also show its
// discovery dot. The nav bell links to /activities ("Lately") and carries no
// badge of its own. The root layout used to await these queries before
// streaming any HTML on every hard navigation; Nav now fetches them client-side
// after mount so the page shell streams immediately and the badges pop in
// slightly later. No request input, so there's nothing to Zod-validate (matches
// the sibling /api/friends/has-new-discovery probe).
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const [profile, friendRequestCount, discoveryStatus] = await Promise.all([
    getUserOnboardingProfile(session.userId),
    getIncomingFollowRequestCount(session.userId).catch(() => 0),
    getNewDiscoveryStatus(session.userId).catch(() => ({ hasNew: false, count: 0 })),
  ]);

  return NextResponse.json({
    userId: session.userId,
    displayName: profile?.displayName ?? null,
    friendRequestCount,
    friendsDotVisible: discoveryStatus.hasNew,
  });
}
