import { eq } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { z } from 'zod'

import { getSession } from '@/server/auth/session'
import { db, users } from '@/server/db'
import { createInviteLink, listLiveInviteLinks } from '@/server/db/queries/invite-links'
import { buildInviteUrl, getBaseUrl } from '@/server/friends/user-invite-token'

export const dynamic = 'force-dynamic'

const CREATE_ERROR_COPY: Record<string, { status: number; message: string }> = {
  limit_reached: { status: 409, message: 'You already have 3 links. Delete one to make another.' },
  slot_taken: { status: 409, message: 'That topic already has a link. Delete it first to reuse the slot.' },
  invalid_slot: { status: 400, message: 'Choose a topic slot or no category.' },
}

async function requireHandle(userId: string, request: Request) {
  const [row] = await db.select({ handle: users.handle }).from(users).where(eq(users.id, userId)).limit(1)
  if (!row?.handle) return null
  const baseUrl = getBaseUrl(request)
  return { handle: row.handle, baseUrl }
}

// Lists the caller's live invite links, each with its share URL and current
// join count.
export async function GET(request: Request) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const identity = await requireHandle(session.userId, request)
  if (!identity) {
    return NextResponse.json(
      { error: 'handle_required', message: 'Set a handle in your profile before generating an invite link.' },
      { status: 409 },
    )
  }

  const links = await listLiveInviteLinks(session.userId)
  return NextResponse.json({
    links: links.map((link) => ({
      id: link.id,
      slot: link.slot,
      url: buildInviteUrl(identity.baseUrl, identity.handle, link.token),
      createdAt: link.createdAt.toISOString(),
      joinedCount: link.joinedCount,
    })),
  })
}

const bodySchema = z.object({
  slot: z.number().int().min(0).max(3),
})

// Creates a new live link tagged with `slot` (0 = untagged, 1-3 = a standing
// topic slot). Capped at 3 live links and at one live link per named slot —
// see createInviteLink.
export async function POST(request: Request) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const identity = await requireHandle(session.userId, request)
  if (!identity) {
    return NextResponse.json(
      { error: 'handle_required', message: 'Set a handle in your profile before generating an invite link.' },
      { status: 409 },
    )
  }

  const json = await request.json().catch(() => null)
  const parsed = bodySchema.safeParse(json)
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_body', message: 'A topic slot (0-3) is required.' }, { status: 400 })
  }

  const result = await createInviteLink(session.userId, parsed.data.slot)
  if (!result.ok) {
    const copy = CREATE_ERROR_COPY[result.error]
    return NextResponse.json({ error: result.error, message: copy.message }, { status: copy.status })
  }

  return NextResponse.json({
    link: {
      id: result.link.id,
      slot: result.link.slot,
      url: buildInviteUrl(identity.baseUrl, identity.handle, result.link.token),
      createdAt: result.link.createdAt.toISOString(),
      joinedCount: result.link.joinedCount,
    },
  })
}
