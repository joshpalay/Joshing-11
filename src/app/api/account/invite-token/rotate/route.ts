import { NextResponse } from 'next/server'

import { getSession } from '@/server/auth/session'
import {
  buildInviteUrl,
  getBaseUrl,
  rotateInviteToken,
} from '@/server/friends/user-invite-token'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const result = await rotateInviteToken(session.userId)
  if (!result) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (!result.handle) {
    return NextResponse.json(
      {
        error: 'handle_required',
        message: 'Set a handle in your profile before generating an invite link.',
      },
      { status: 409 },
    )
  }

  const url = buildInviteUrl(getBaseUrl(request), result.handle, result.token)
  return NextResponse.json({ token: result.token, url })
}
