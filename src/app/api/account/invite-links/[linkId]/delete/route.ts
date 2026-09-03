import { NextResponse } from 'next/server'

import { getSession } from '@/server/auth/session'
import { softDeleteInviteLink } from '@/server/db/queries/invite-links'

export const dynamic = 'force-dynamic'

// Soft-deletes a live link. The token stops resolving immediately, but never
// touches the Follow edge accepting it created — people who already joined
// through this link stay friends. See the comment on userInviteLinks in
// schema.ts.
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ linkId: string }> },
) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { linkId } = await params
  const deleted = await softDeleteInviteLink(session.userId, linkId)
  if (!deleted) {
    return NextResponse.json(
      { error: 'not_found', message: 'That link is already gone.' },
      { status: 404 },
    )
  }

  return NextResponse.json({ ok: true })
}
