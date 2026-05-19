import { NextResponse } from 'next/server'
import { z } from 'zod'

import { getSession } from '@/server/auth/session'
import { getUserById } from '@/server/db/queries/users'
import { createOrReusePendingFriendshipRequest } from '@/server/friends/friendships'
import { logTelemetry } from '@/server/telemetry'

export const dynamic = 'force-dynamic'

const bodySchema = z.object({
  inviteeUserId: z.string().min(1),
})

export async function POST(request: Request) {
  const session = await getSession()
  if (!session)
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const json = await request.json().catch(() => null)
  const parsed = bodySchema.safeParse(json)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid_body', message: 'Missing inviteeUserId.' },
      { status: 400 }
    )
  }

  const { inviteeUserId } = parsed.data
  if (inviteeUserId === session.userId) {
    return NextResponse.json(
      { error: 'self_request', message: 'You cannot friend yourself.' },
      { status: 400 }
    )
  }

  const invitee = await getUserById(inviteeUserId)
  if (!invitee) {
    return NextResponse.json(
      { error: 'not_found', message: 'No such user.' },
      { status: 404 }
    )
  }

  const { friendship, state } = await createOrReusePendingFriendshipRequest({
    inviterUserId: session.userId,
    inviteeUserId,
  })

  logTelemetry('friend_request_from_profile', {
    inviter_user_id: session.userId,
    invitee_user_id: inviteeUserId,
    friendship_id: friendship.id,
    state,
  })

  return NextResponse.json({
    ok: true,
    state,
    friendship: { id: friendship.id, status: friendship.status },
  })
}
