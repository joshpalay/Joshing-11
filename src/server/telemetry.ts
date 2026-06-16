import { createHash } from 'crypto'

export type TelemetryEventName =
  | 'add_friend_started'
  | 'add_friend_invite_created'
  | 'add_friend_invite_cancelled'
  | 'add_friend_invite_deleted'
  | 'add_friend_invite_rate_limited'
  | 'add_friend_message_copied'
  | 'add_friend_sms_handoff_opened'
  | 'friend_invite_link_opened'
  | 'friend_invite_auth_started'
  | 'friend_invite_accepted'
  | 'friend_invite_phone_mismatch_rejected'
  | 'friend_onboarding_interests_accepted_all'
  | 'friend_onboarding_interests_partial'
  | 'friend_onboarding_interests_skipped'
  | 'friend_request_existing_user_created'
  | 'friend_request_reinvite_after_ignore_limited'
  | 'friend_request_accepted'
  | 'friend_request_ignored'
  | 'friend_request_from_profile'
  | 'friend_request_cancelled'
  | 'friendship_removed'

type TelemetryValue = string | number | boolean | null | undefined
export type TelemetryMetadata = Record<string, TelemetryValue>

const SENSITIVE_KEY_PATTERN = /phone|token|message|interest(s)?$/i

export function hashTelemetryValue(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 16)
}

function sanitizeMetadata(metadata: TelemetryMetadata): TelemetryMetadata {
  return Object.fromEntries(
    Object.entries(metadata).filter(([key, value]) => {
      if (value === undefined) return false
      return !SENSITIVE_KEY_PATTERN.test(key)
    })
  )
}

export function logTelemetry(
  event: TelemetryEventName,
  metadata: TelemetryMetadata = {}
): void {
  console.info(`[telemetry] ${event}`, {
    event,
    ...sanitizeMetadata(metadata),
  })
}

// --- Latency / performance telemetry --------------------------------------
// A separate channel from product events. Emitted as `[latency] <metric>` so
// production runtime logs can be filtered into a per-metric p50/p95 table —
// the measurement PERF-FINDINGS-01 §0 / B-PERF-04 flagged as missing (the
// project had numeric §12.6 latency targets but no way to observe them). Both
// server timings (queue generation) and client RUM (/daily perceived load)
// funnel through here so they share one log shape.
export type LatencyMetric =
  | 'daily_queue_generated' // server: a full Daily Five build (the slow path)
  | 'daily_queue_prewarm' // server: background pre-warm after login/onboarding
  | 'daily_load' // client RUM: /daily mount → first question on screen

export function logLatency(
  metric: LatencyMetric,
  ms: number,
  metadata: TelemetryMetadata = {}
): void {
  console.info(`[latency] ${metric}`, {
    metric,
    ms: Math.max(0, Math.round(ms)),
    ...sanitizeMetadata(metadata),
  })
}
