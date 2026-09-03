import { NextResponse } from 'next/server'

import { getSession } from '@/server/auth/session'
import {
  buildInviteUrl,
  getBaseUrl,
  getInviteLinkSeedTopics,
  getOrCreateInviteToken,
} from '@/server/friends/user-invite-token'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const result = await getOrCreateInviteToken(session.userId)
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
  // The RESOLVED topic count (curated set, or the automatic declared-interests
  // fallback) — what the link actually carries right now, not just what's
  // curated. Used by InviteSomeoneNew's "N topics" line (Stage 3); userId lets
  // that line link to the caller's own settings page without a second fetch.
  const topicCount = (await getInviteLinkSeedTopics(session.userId)).length
  return NextResponse.json({ token: result.token, url, userId: session.userId, topicCount })
}
