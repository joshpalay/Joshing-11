import { NextResponse } from 'next/server'
import { z } from 'zod'

import { getSession } from '@/server/auth/session'
import { searchFriendByHandleOrPhone } from '@/server/db/queries/friend-search'
import { logTelemetry } from '@/server/telemetry'

export const dynamic = 'force-dynamic'

const querySchema = z.object({
  q: z.string().trim().min(1).max(80),
})

// D-FRIEND-SEARCH-PRIVACY-01, Decision A1 — rate limiting.
// The search route resolves a phone/handle to a profile, so unbounded calls
// are an enumeration engine (walk a number range, harvest match vs match:null).
// We cap with an in-memory sliding window (the same shape as the invite
// throttle in src/app/api/friend-invitations/route.ts) on TWO dimensions:
//   - per-account: the primary limit on a legitimate session.
//   - per-IP: catches the account-rotation bypass (mint accounts / rotate
//     sessions to sidestep the per-account cap).
// Per-IP is intentionally looser than per-account because carrier CGNAT and
// office NAT put many legitimate users behind one address; an 8/min per-IP cap
// would false-positive shared egress. Both windows are env-tunable.
// NOTE: in-memory means per-instance — on multi-instance serverless the
// effective ceiling scales with instance count. This is the documented Phase-1
// posture; a durable (Redis/KV-backed) limiter is the Phase-2 upgrade.
// F9 (2026-09-10 audit) — a misconfigured limit env var (unparseable, empty,
// zero, negative) used to become NaN/0 and silently pass every `>=` check
// below, disabling the cap rather than failing closed. intEnv guards that:
// anything that doesn't parse to a positive integer falls back to the
// documented default instead of opening the gate.
function intEnv(name: string, fallback: number): number {
  const raw = process.env[name]
  if (raw === undefined || raw.trim() === '') return fallback
  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

const SEARCH_WINDOW_MS = 1000 * 60
const SEARCH_PER_ACCOUNT_WINDOW = intEnv('FRIEND_SEARCH_PER_ACCOUNT_LIMIT', 8)
const SEARCH_PER_IP_WINDOW = intEnv('FRIEND_SEARCH_PER_IP_LIMIT', 40)

const searchAttemptsByAccount = new Map<string, number[]>()
const searchAttemptsByIp = new Map<string, number[]>()

function pruneWindow(values: number[], nowMs: number, windowMs: number) {
  return values.filter((value) => nowMs - value < windowMs)
}

// F9 (2026-09-10 audit) — TRUST ASSUMPTION, documented rather than silently
// relied on: this reads the FIRST entry of x-forwarded-for as the client IP.
// That is only safe if Vercel's edge is the sole ingress AND Vercel itself
// sets/overwrites x-forwarded-for rather than appending to a client-supplied
// value — if a proxy chain instead APPENDS the observed peer to the end
// (the common X-Forwarded-For convention), the first entry is attacker-
// controlled and this becomes a per-IP-limit bypass (spoof a fresh fake
// first hop on every request). This repo's current deployment target is
// Vercel-only (CLAUDE.md), which is consistent with the "Vercel sets it"
// assumption, but that has NOT been independently verified against live
// platform behavior here — flagged in the F9 report for owner sign-off
// rather than silently trusted or silently "fixed" by guessing the other
// index is safer. Do not put another CDN/proxy in front of this app without
// re-checking this assumption. x-real-ip is the fallback. 'unknown' means no
// forwarding header was present — we then skip the per-IP dimension entirely
// rather than lumping every header-less request into one shared bucket
// (which would throttle legitimate users on the per-account limit's behalf).
function clientIpFrom(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for')
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim()
    if (first) return first
  }
  return request.headers.get('x-real-ip')?.trim() || 'unknown'
}

type RateLimitVerdict = { reason: 'account_window' | 'ip_window'; retryAfterSeconds: number }

function retryAfterFor(values: number[], nowMs: number): number {
  const oldest = values.length ? Math.min(...values) : nowMs
  return Math.max(1, Math.ceil((oldest + SEARCH_WINDOW_MS - nowMs) / 1000))
}

function checkSearchRateLimit(
  userId: string,
  ip: string,
  now = new Date()
): RateLimitVerdict | null {
  if (process.env.FRIEND_SEARCH_THROTTLE_DISABLED === '1') return null

  const nowMs = now.getTime()
  const accountAttempts = pruneWindow(
    searchAttemptsByAccount.get(userId) ?? [],
    nowMs,
    SEARCH_WINDOW_MS
  )
  if (accountAttempts.length >= SEARCH_PER_ACCOUNT_WINDOW) {
    return { reason: 'account_window', retryAfterSeconds: retryAfterFor(accountAttempts, nowMs) }
  }

  if (ip !== 'unknown') {
    const ipAttempts = pruneWindow(
      searchAttemptsByIp.get(ip) ?? [],
      nowMs,
      SEARCH_WINDOW_MS
    )
    if (ipAttempts.length >= SEARCH_PER_IP_WINDOW) {
      return { reason: 'ip_window', retryAfterSeconds: retryAfterFor(ipAttempts, nowMs) }
    }
  }

  return null
}

function recordSearchAttempt(userId: string, ip: string, now = new Date()) {
  const nowMs = now.getTime()
  const accountAttempts = pruneWindow(
    searchAttemptsByAccount.get(userId) ?? [],
    nowMs,
    SEARCH_WINDOW_MS
  )
  accountAttempts.push(nowMs)
  searchAttemptsByAccount.set(userId, accountAttempts)

  if (ip !== 'unknown') {
    const ipAttempts = pruneWindow(
      searchAttemptsByIp.get(ip) ?? [],
      nowMs,
      SEARCH_WINDOW_MS
    )
    ipAttempts.push(nowMs)
    searchAttemptsByIp.set(ip, ipAttempts)
  }
}

export function resetFriendSearchRateLimitForTests() {
  searchAttemptsByAccount.clear()
  searchAttemptsByIp.clear()
}

export async function GET(request: Request) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const ip = clientIpFrom(request)
  const limited = checkSearchRateLimit(session.userId, ip)
  if (limited) {
    // F9 abuse signal — count and coarse reason only. No query value, no
    // account id beyond what's already implicit in normal request logging.
    logTelemetry('friend_search_rate_limited', { reason: limited.reason })
    return NextResponse.json(
      { error: 'rate_limited', reason: limited.reason },
      {
        status: 429,
        headers: { 'Retry-After': String(limited.retryAfterSeconds) },
      }
    )
  }

  const url = new URL(request.url)
  const parsed = querySchema.safeParse({ q: url.searchParams.get('q') ?? '' })
  if (!parsed.success) {
    return NextResponse.json({ match: null })
  }

  // Count only attempts that actually run a lookup (a valid query). Invalid
  // input short-circuits above without consuming the budget — it leaks nothing.
  recordSearchAttempt(session.userId, ip)

  const match = await searchFriendByHandleOrPhone(session.userId, parsed.data.q)
  // F9 abuse signal — outcome only (match found or not). Never the query
  // string, never the resolved user's handle/phone/id.
  logTelemetry('friend_search_performed', { outcome: match ? 'match' : 'no_match' })
  return NextResponse.json({ match })
}
