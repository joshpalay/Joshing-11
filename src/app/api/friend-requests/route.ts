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

const RECENTLY_SENT_WINDOW_MS = 30 * 24 * 60 * 60 * 1000

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
  const relationship = await getRelationship(session.userId, inviteeUserId, now)

  // Block detection: target has soft-removed the friendship. Return 404
  // (don't reveal the block) and don't write anything.
  if (relationship.isBlocked) {
    return NextResponse.json(
      { error: 'not_found', message: 'No such user.' },
      { status: 404 }
    )
  }

  if (relationship.state === 'friends') {
    return NextResponse.json(
      { error: 'already_friends', message: 'You are already friends.' },
      { status: 409 }
    )
  }
  if (relationship.state === 'pending_outbound') {
    return NextResponse.json(
      {
        error: 'already_pending',
        message: 'You already have a pending request with this person.',
      },
      { status: 409 }
    )
  }
  if (relationship.state === 'pending_inbound') {
    return NextResponse.json(
      {
        error: 'inbound_exists',
        message: 'They sent you a request — accept it instead.',
        friendshipId: relationship.friendshipId,
      },
      { status: 409 }
    )
  }
  if (relationship.state === 'recently_sent') {
    return NextResponse.json(
      {
        error: 'recently_sent',
        message: 'You sent this person a request recently. Try again later.',
        // Best-effort retry hint: 30 days from now is the latest the
        // cooldown could last. Callers don't need millisecond precision.
        retryAfter: new Date(now.getTime() + RECENTLY_SENT_WINDOW_MS).toISOString(),
      },
      { status: 429 }
    )
  }

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
    friendship: { id: friendship.id, status: friendship.status },
  })
}
