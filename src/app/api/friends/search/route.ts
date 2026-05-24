import { NextResponse } from 'next/server'
import { z } from 'zod'

import { getSession } from '@/server/auth/session'
import { searchFriendByHandleOrPhone } from '@/server/db/queries/friend-search'

export const dynamic = 'force-dynamic'

const querySchema = z.object({
  q: z.string().trim().min(1).max(80),
})

export async function GET(request: Request) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const url = new URL(request.url)
  const parsed = querySchema.safeParse({ q: url.searchParams.get('q') ?? '' })
  if (!parsed.success) {
    return NextResponse.json({ match: null })
  }

  const match = await searchFriendByHandleOrPhone(session.userId, parsed.data.q)
  return NextResponse.json({ match })
}
