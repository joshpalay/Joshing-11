import { NextResponse } from 'next/server'
import { z } from 'zod'

import { isTooBroadInterest } from '@/lib/knowledge/interest-specificity'
import { getSession } from '@/server/auth/session'
import {
  getCuratedInviteSeedTopics,
  getInviteLinkSeedTopics,
  setCuratedInviteSeedTopics,
} from '@/server/friends/user-invite-token'

export const dynamic = 'force-dynamic'

const SEED_TOPIC_CAP = 3

const bodySchema = z.object({
  topics: z.array(z.string().trim().min(1).max(80)).max(SEED_TOPIC_CAP),
})

// Returns the RESOLVED set — curated if the caller has one, otherwise the
// automatic fallback (getInviteLinkSeedTopics) — so the Friends page's link
// creation panel always shows what an untagged link actually carries right
// now, prefilled and ready to swap. The first edit (any add/remove) persists
// that resolution as an explicit curated set via PATCH below.
export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const topics = await getInviteLinkSeedTopics(session.userId)
  return NextResponse.json({ topics })
}

// Overwrites the curated invite-link topic set. Each topic is validated with
// the same isTooBroadInterest check onboarding runs when consuming these
// topics — reject the whole save on a too-broad entry rather than silently
// dropping it, so the editor can point at exactly what to fix.
export async function PATCH(request: Request) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const json = await request.json().catch(() => null)
  const parsed = bodySchema.safeParse(json)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid_body', message: `Up to ${SEED_TOPIC_CAP} short topics, please.` },
      { status: 400 },
    )
  }

  const tooBroad = parsed.data.topics.find((topic) => isTooBroadInterest(topic))
  if (tooBroad) {
    return NextResponse.json(
      {
        error: 'too_broad',
        message: `"${tooBroad}" is too broad — try something more specific.`,
      },
      { status: 400 },
    )
  }

  await setCuratedInviteSeedTopics(session.userId, parsed.data.topics)
  const curated = await getCuratedInviteSeedTopics(session.userId)
  return NextResponse.json({ topics: curated.map((label) => ({ label })) })
}
