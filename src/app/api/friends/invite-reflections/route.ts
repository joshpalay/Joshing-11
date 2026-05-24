import { NextResponse } from 'next/server'

import { getSession } from '@/server/auth/session'
import { listInviteReflections } from '@/server/db/queries/friend-invitations'

export const dynamic = 'force-dynamic'

export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const reflections = await listInviteReflections(session.userId)
  return NextResponse.json({ reflections })
}
