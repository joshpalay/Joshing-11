import { NextResponse } from 'next/server'
import { z } from 'zod'

import { getSession } from '@/server/auth/session'
import { searchFriendByHandleOrPhone } from '@/server/db/queries/friend-search'

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
const SEARCH_WINDOW_MS = 1000 * 60
const SEARCH_PER_ACCOUNT_WINDOW = Number(
  process.env.FRIEND_SEARCH_PER_ACCOUNT_LIMIT ?? 8
)
const SEARCH_PER_IP_WINDOW = Number(
  process.env.FRIEND_SEARCH_PER_IP_LIMIT ?? 40
)

const searchAttemptsByAccount = new Map<string, number[]>()
const searchAttemptsByIp = new Map<string, number[]>()

function pruneWindow(values: number[], nowMs: number, windowMs: number) {
  return values.filter((value) => nowMs - value < windowMs)
}

// First hop of x-forwarded-for is the client on Vercel; x-real-ip is the
// fallback. 'unknown' means no forwarding header was present — we then skip the
// per-IP dimension entirely rather than lumping every header-less request into
// one shared bucket (which would throttle legitimate users on the per-account
// limit's behalf).
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
  return NextResponse.json({ match })
}
