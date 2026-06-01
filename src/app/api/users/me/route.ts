import { NextResponse } from 'next/server'
import { z } from 'zod'

import { getSession } from '@/server/auth/session'
import { setFollowPrivacy } from '@/server/db/queries/users'

export const dynamic = 'force-dynamic'

const bodySchema = z.object({
  followPrivacy: z.enum(['public', 'approval_required']),
})

// PATCH /api/users/me — update the current user's follow-privacy gate.
export async function PATCH(request: Request) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const json = await request.json().catch(() => null)
  const parsed = bodySchema.safeParse(json)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid_body', message: 'Missing or invalid request body.' },
      { status: 400 },
    )
  }

  const updated = await setFollowPrivacy(session.userId, parsed.data.followPrivacy)
  if (!updated) {
    return NextResponse.json({ error: 'not_found', message: 'No such user.' }, { status: 404 })
  }

  return NextResponse.json({ ok: true, followPrivacy: updated.followPrivacy })
}
