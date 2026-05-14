import { NextResponse } from 'next/server'

import { getSession } from '@/server/auth/session'
import { logTelemetry, type TelemetryEventName } from '@/server/telemetry'

export const dynamic = 'force-dynamic'

const CLIENT_TELEMETRY_EVENTS = new Set<TelemetryEventName>([
  'add_friend_started',
  'add_friend_message_copied',
  'add_friend_sms_handoff_opened',
  'friend_invite_auth_started',
])

type TelemetryBody = {
  event?: unknown
  metadata?: unknown
}

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
  const body = (await request.json().catch(() => null)) as TelemetryBody | null
  const event = typeof body?.event === 'string' ? body.event : ''

  if (!CLIENT_TELEMETRY_EVENTS.has(event as TelemetryEventName)) {
    return NextResponse.json(
      { error: 'invalid_event', message: 'Unsupported telemetry event.' },
      { status: 400 }
    )
  }

  const session = await getSession()
  logTelemetry(event as TelemetryEventName, {
    ...parseMetadata(body?.metadata),
    user_id: session?.userId ?? null,
  })

  return NextResponse.json({ ok: true })
}
