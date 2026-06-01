import { NextResponse } from 'next/server';

import { getSession } from '@/server/auth/session';
import { logTelemetry } from '@/server/telemetry';
import { acceptPendingFriendshipRequest } from '@/server/friends/friendships';

export const dynamic = 'force-dynamic';

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ friendshipId: string }> },
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { friendshipId } = await params;
  const friendship = await acceptPendingFriendshipRequest({
    friendshipId,
    userId: session.userId,
  });

  if (!friendship) {
    return NextResponse.json(
      { error: 'not_found', message: 'No pending friend request was found.' },
      { status: 404 },
    );
  }

  logTelemetry('friend_request_accepted', {
    friendship_id: friendship.id,
    user_id: session.userId,
  });

  return NextResponse.json({
    ok: true,
    friendship: { id: friendship.id, status: friendship.status },
  });
}
