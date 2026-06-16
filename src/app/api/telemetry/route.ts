import { NextResponse } from 'next/server'
import { z } from 'zod'

import { getSession } from '@/server/auth/session'
import {
  logLatency,
  logTelemetry,
  type LatencyMetric,
  type TelemetryEventName,
} from '@/server/telemetry'

export const dynamic = 'force-dynamic'

const CLIENT_TELEMETRY_EVENTS = [
  'add_friend_started',
  'add_friend_message_copied',
  'add_friend_sms_handoff_opened',
  'friend_invite_auth_started',
] as const satisfies readonly TelemetryEventName[]

// Latency metrics the client is allowed to report (RUM). Kept to an explicit
// allowlist so a public surface can't flood arbitrary latency channels.
const CLIENT_LATENCY_METRICS = ['daily_load'] as const satisfies readonly LatencyMetric[]

const bodySchema = z.object({
  event: z.enum(CLIENT_TELEMETRY_EVENTS),
  metadata: z.unknown().optional(),
})

const latencySchema = z.object({
  metric: z.enum(CLIENT_LATENCY_METRICS),
  // Bounded to the route's own ceiling so a bogus value can't skew aggregates.
  ms: z.number().int().nonnegative().max(600_000),
  metadata: z.unknown().optional(),
})

function parseMetadata(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}

  const metadata: Record<string, string | number | boolean | null> = {}
  for (const [key, rawValue] of Object.entries(value)) {
    if (!/^[a-zA-Z0-9_]{1,40}$/.test(key)) continue
    if (
      typeof rawValue === 'string' ||
      typeof rawValue === 'number' ||
      typeof rawValue === 'boolean' ||
      rawValue === null
    ) {
      metadata[key] = rawValue
    }
  }

  return metadata
}

export async function POST(request: Request) {
  const raw = await request.json().catch(() => null)

  // Latency (RUM) reports go through the latency channel; product events go
  // through the event channel. Try latency first since the two shapes are
  // disjoint (one has `metric`, the other `event`).
  const latency = latencySchema.safeParse(raw)
  if (latency.success) {
    const session = await getSession()
    logLatency(latency.data.metric, latency.data.ms, {
      ...parseMetadata(latency.data.metadata),
      user_id: session?.userId ?? null,
    })
    return NextResponse.json({ ok: true })
  }

  const parsed = bodySchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid_event', message: 'Unsupported telemetry event.' },
      { status: 400 }
    )
  }

  const session = await getSession()
  logTelemetry(parsed.data.event, {
    ...parseMetadata(parsed.data.metadata),
    user_id: session?.userId ?? null,
  })

  return NextResponse.json({ ok: true })
}
