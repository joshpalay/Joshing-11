import { NextResponse } from 'next/server'

import { getSession } from '@/server/auth/session'
import { getUserById } from '@/server/db/queries/users'
import { blockUser, unblockUser } from '@/server/db/queries/user-blocks'
import { logTelemetry } from '@/server/telemetry'

export const dynamic = 'force-dynamic'

type RouteContext = {
  params: Promise<{ id: string }>
}

export async function POST(_request: Request, { params }: RouteContext) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { id: blockedId } = await params
  if (!blockedId) {
    return NextResponse.json(
      { error: 'missing_id', message: 'User id is required.' },
      { status: 400 }
    )
  }
  if (blockedId === session.userId) {
    return NextResponse.json(
      { error: 'self_block', message: 'You cannot block yourself.' },
      { status: 400 }
    )
  }

  const target = await getUserById(blockedId)
  if (!target) {
    return NextResponse.json(
      { error: 'not_found', message: 'No such user.' },
      { status: 404 }
    )
  }

  await blockUser(session.userId, blockedId)

  logTelemetry('user_blocked', {
    blocker_user_id: session.userId,
    blocked_user_id: blockedId,
  })

  return NextResponse.json({ ok: true })
}

export async function DELETE(_request: Request, { params }: RouteContext) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { id: blockedId } = await params
  if (!blockedId) {
    return NextResponse.json(
      { error: 'missing_id', message: 'User id is required.' },
      { status: 400 }
    )
  }

  await unblockUser(session.userId, blockedId)

  logTelemetry('user_unblocked', {
    blocker_user_id: session.userId,
    blocked_user_id: blockedId,
  })

  return NextResponse.json({ ok: true })
}
