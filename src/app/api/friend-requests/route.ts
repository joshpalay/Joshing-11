import { NextResponse } from 'next/server'
import { z } from 'zod'

import { getSession } from '@/server/auth/session'
import { getRelationship } from '@/server/db/queries/friend-requests'
import { getUserById } from '@/server/db/queries/users'
import { createOrReusePendingFriendshipRequest } from '@/server/friends/friendships'
import { logTelemetry } from '@/server/telemetry'

export const dynamic = 'force-dynamic'

const bodySchema = z.object({
  inviteeUserId: z.string().min(1),
  personalNote: z.string().trim().max(160).optional(),
})

// B-FRIENDS-SAFETY-01 Phase 3 — rate limiting, same shape as the search
// route's in-memory sliding window (src/app/api/friends/search/route.ts,
// D-FRIEND-SEARCH-PRIVACY-01 Decision A1): an unbounded POST here lets one
// account fan out friend requests to an arbitrary number of people. Two
// windows — a tight daily one and a looser weekly one that catches a slow
// drip that never trips the daily cap. Both env-tunable.
// NOTE: in-memory means per-instance — on multi-instance serverless the
// effective ceiling scales with instance count. This is the documented
// Phase-1 posture; a durable (Redis/KV-backed) limiter is the Phase-2
// infrastructure upgrade under D-FRIEND-SEARCH-PRIVACY-01, not attempted here.
// F9 (2026-09-10 audit) — same guard as friends/search/route.ts's intEnv: a
// misconfigured limit env var (unparseable, empty, zero, negative) used to
// become NaN/0 and silently pass every `>=` check below, disabling the cap
// rather than failing closed.
function intEnv(name: string, fallback: number): number {
  const raw = process.env[name]
  if (raw === undefined || raw.trim() === '') return fallback
  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

const FRIEND_REQUEST_DAILY_WINDOW_MS = 1000 * 60 * 60 * 24
const FRIEND_REQUEST_WEEKLY_WINDOW_MS = FRIEND_REQUEST_DAILY_WINDOW_MS * 7
const FRIEND_REQUEST_PER_ACCOUNT_DAILY_LIMIT = intEnv('FRIEND_REQUEST_PER_ACCOUNT_DAILY_LIMIT', 20)
const FRIEND_REQUEST_PER_ACCOUNT_WEEKLY_LIMIT = intEnv('FRIEND_REQUEST_PER_ACCOUNT_WEEKLY_LIMIT', 60)

// One sliding-window array per account, kept pruned to the LONGER (weekly)
// window — the daily count is derived by re-filtering that same array to the
// shorter window, so one store serves both checks.
const friendRequestAttemptsByAccount = new Map<string, number[]>()

function pruneWindow(values: number[], nowMs: number, windowMs: number): number[] {
  return values.filter((value) => nowMs - value < windowMs)
}

function retryAfterFor(values: number[], nowMs: number, windowMs: number): number {
  const oldest = values.length ? Math.min(...values) : nowMs
  return Math.max(1, Math.ceil((oldest + windowMs - nowMs) / 1000))
}

type RateLimitVerdict = { reason: 'daily_window' | 'weekly_window'; retryAfterSeconds: number }

function checkFriendRequestRateLimit(userId: string, now = new Date()): RateLimitVerdict | null {
  if (process.env.FRIEND_REQUEST_THROTTLE_DISABLED === '1') return null

  const nowMs = now.getTime()
  const weeklyAttempts = pruneWindow(
    friendRequestAttemptsByAccount.get(userId) ?? [],
    nowMs,
    FRIEND_REQUEST_WEEKLY_WINDOW_MS
  )
  const dailyAttempts = weeklyAttempts.filter((t) => nowMs - t < FRIEND_REQUEST_DAILY_WINDOW_MS)

  if (dailyAttempts.length >= FRIEND_REQUEST_PER_ACCOUNT_DAILY_LIMIT) {
    return {
      reason: 'daily_window',
      retryAfterSeconds: retryAfterFor(dailyAttempts, nowMs, FRIEND_REQUEST_DAILY_WINDOW_MS),
    }
  }
  if (weeklyAttempts.length >= FRIEND_REQUEST_PER_ACCOUNT_WEEKLY_LIMIT) {
    return {
      reason: 'weekly_window',
      retryAfterSeconds: retryAfterFor(weeklyAttempts, nowMs, FRIEND_REQUEST_WEEKLY_WINDOW_MS),
    }
  }
  return null
}

function recordFriendRequestAttempt(userId: string, now = new Date()): void {
  const nowMs = now.getTime()
  const weeklyAttempts = pruneWindow(
    friendRequestAttemptsByAccount.get(userId) ?? [],
    nowMs,
    FRIEND_REQUEST_WEEKLY_WINDOW_MS
  )
  weeklyAttempts.push(nowMs)
  friendRequestAttemptsByAccount.set(userId, weeklyAttempts)
}

export function resetFriendRequestRateLimitForTests(): void {
  friendRequestAttemptsByAccount.clear()
}

export async function POST(request: Request) {
  const session = await getSession()
  if (!session)
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const limited = checkFriendRequestRateLimit(session.userId)
  if (limited) {
    // F9 abuse signal — count and coarse reason only, no identifiers.
    logTelemetry('friend_request_rate_limited', { reason: limited.reason })
    return NextResponse.json(
      { error: 'rate_limited', reason: limited.reason },
      { status: 429, headers: { 'Retry-After': String(limited.retryAfterSeconds) } }
    )
  }

  const json = await request.json().catch(() => null)
  const parsed = bodySchema.safeParse(json)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid_body', message: 'Missing or invalid request body.' },
      { status: 400 }
    )
  }

  const { inviteeUserId, personalNote } = parsed.data
  if (inviteeUserId === session.userId) {
    return NextResponse.json(
      { error: 'self_request', message: 'You cannot friend yourself.' },
      { status: 400 }
    )
  }

  // Count only attempts that actually run a lookup against another real
  // account — invalid input and a self-request short-circuit above without
  // consuming the budget (matching the search route's philosophy: they leak
  // nothing about another user).
  recordFriendRequestAttempt(session.userId)

  const invitee = await getUserById(inviteeUserId)
  if (!invitee) {
    return NextResponse.json(
      { error: 'not_found', message: 'No such user.' },
      { status: 404 }
    )
  }

  const now = new Date()
  const relationship = await getRelationship(session.userId, inviteeUserId)

  // A blocked pair must not be distinguishable from a nonexistent user --
  // reuse the same not_found response rather than a new error code.
  if (relationship.isBlocked) {
    return NextResponse.json(
      { error: 'not_found', message: 'No such user.' },
      { status: 404 }
    )
  }

  // Already following (mutual or one-directional) — nothing to do.
  if (relationship.state === 'friends' || relationship.state === 'following') {
    return NextResponse.json(
      { error: 'already_following', message: 'You’re already connected to this person.' },
      { status: 409 }
    )
  }
  if (relationship.state === 'pending_outbound') {
    return NextResponse.json(
      {
        error: 'already_pending',
        message: 'You already sent this person a friend request.',
      },
      { status: 409 }
    )
  }
  if (relationship.state === 'pending_inbound') {
    return NextResponse.json(
      {
        error: 'inbound_exists',
        message: 'They sent you a friend request — accept it instead.',
        friendshipId: relationship.friendshipId,
      },
      { status: 409 }
    )
  }

  // 'follows_you' and 'none' fall through: the viewer may follow / follow back.
  const { friendship, state } = await createOrReusePendingFriendshipRequest({
    inviterUserId: session.userId,
    inviteeUserId,
    personalNote,
    now,
  })

  logTelemetry('friend_request_from_profile', {
    inviter_user_id: session.userId,
    invitee_user_id: inviteeUserId,
    friendship_id: friendship.id,
    state,
    has_personal_note: Boolean(personalNote),
  })

  return NextResponse.json({
    ok: true,
    state,
    friendship: { id: friendship.id, status: friendship.state },
  })
}
