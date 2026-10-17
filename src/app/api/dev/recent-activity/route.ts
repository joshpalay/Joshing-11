import { NextResponse } from 'next/server'
import { z } from 'zod'

import { RECENT_ACTIVITY_COOKIE } from '@/lib/recent-activity-version'
import { isAdminUser } from '@/server/auth/admin'
import { getSession } from '@/server/auth/session'
import { getRecentActivityVersion } from '@/server/home/recent-activity-version'

export const dynamic = 'force-dynamic'
const schema = z.object({ version: z.enum(['current', 'shared']) }).strict()

export async function GET() {
  const session = await getSession()
  if (!session || !isAdminUser(session.userId)) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  return NextResponse.json({ version: await getRecentActivityVersion(session.userId) }, { headers: { 'Cache-Control': 'no-store' } })
}

export async function PATCH(request: Request) {
  const session = await getSession()
  if (!session || !isAdminUser(session.userId)) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 })
  const response = NextResponse.json({ version: parsed.data.version })
  response.cookies.set(RECENT_ACTIVITY_COOKIE, JSON.stringify({ userId: session.userId, version: parsed.data.version }), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 30 * 24 * 60 * 60,
  })
  return response
}
