import { NextResponse } from 'next/server'

import { getSession } from '@/server/auth/session'
import { getNewDiscoveryStatus } from '@/server/db/queries/contact-hashes'

export const dynamic = 'force-dynamic'

// Lightweight "is there anything new on Find Friends?" probe. Used by
// FriendsList to render the passive Invitations-tab row. The layout
// already loads this for the Nav dot, but the client component needs a
// fresh number after navigating in.
export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const status = await getNewDiscoveryStatus(session.userId)
  return NextResponse.json(status, {
    headers: { 'Cache-Control': 'max-age=60' },
  })
}
