import { NextResponse } from 'next/server'
import { z } from 'zod'

import { getSession } from '@/server/auth/session'
import { getRelationship } from '@/server/db/queries/friend-requests'
import { getUserById } from '@/server/db/queries/users'
import { createOrReusePendingFriendshipRequest } from '@/server/friends/friendships'
import { logTelemetry } from '@/server/telemetry'

export const dynamic = 'force-dynamic'

const bodySchema = z.object({
  inviteeUserId: z.string().min(1),
  personalNote: z.string().trim().max(160).optional(),
})

export async function POST(request: Request) {
  const session = await getSession()
  if (!session)
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const json = await request.json().catch(() => null)
  const parsed = bodySchema.safeParse(json)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid_body', message: 'Missing or invalid request body.' },
      { status: 400 }
    )
  }

  const { inviteeUserId, personalNote } = parsed.data
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

  const now = new Date()
  const relationship = await getRelationship(session.userId, inviteeUserId)

  // Already following (mutual or one-directional) — nothing to do.
  if (relationship.state === 'friends' || relationship.state === 'following') {
    return NextResponse.json(
      { error: 'already_following', message: 'You already follow this person.' },
      { status: 409 }
    )
  }
  if (relationship.state === 'pending_outbound') {
    return NextResponse.json(
      {
        error: 'already_pending',
        message: 'You already requested to follow this person.',
      },
      { status: 409 }
    )
  }
  if (relationship.state === 'pending_inbound') {
    return NextResponse.json(
      {
        error: 'inbound_exists',
        message: 'They requested to follow you — approve it instead.',
        friendshipId: relationship.friendshipId,
      },
      { status: 409 }
    )
  }

  // 'follows_you' and 'none' fall through: the viewer may follow / follow back.
  const { friendship, state } = await createOrReusePendingFriendshipRequest({
    inviterUserId: session.userId,
    inviteeUserId,
    personalNote,
    now,
  })

  logTelemetry('friend_request_from_profile', {
    inviter_user_id: session.userId,
    invitee_user_id: inviteeUserId,
    friendship_id: friendship.id,
    state,
    has_personal_note: Boolean(personalNote),
  })

  return NextResponse.json({
    ok: true,
    state,
    friendship: { id: friendship.id, status: friendship.state },
  })
}
