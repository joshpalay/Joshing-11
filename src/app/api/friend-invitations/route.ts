import { eq } from 'drizzle-orm'
import { NextResponse } from 'next/server'

import { isUsPhoneNumber, normalizePhone } from '@/server/auth'
import { getSession } from '@/server/auth/session'
import { db, friendInvitations, users } from '@/server/db'
import {
  cancelFriendInvitation,
  createFriendInvitation,
  listOutgoingFriendInvitations,
  type OutgoingFriendInvitation,
} from '@/server/friends/invitations'
import { createOrReusePendingFriendshipRequest } from '@/server/friends/friendships'
import { logTelemetry } from '@/server/telemetry'

export const dynamic = 'force-dynamic'

const MAX_INVITEE_DISPLAY_NAME_LENGTH = 60
const MAX_SUGGESTED_INTERESTS = 3
const MAX_SUGGESTED_INTEREST_LENGTH = 60
const INVITES_PER_USER_WINDOW = 12
const INVITES_PER_PHONE_WINDOW = 4
const INVITE_WINDOW_MS = 1000 * 60 * 60
const SAME_PHONE_COOLDOWN_MS = 1000 * 60 * 10
const CANCELLED_PHONE_COOLDOWN_MS = 1000 * 60 * 20
const IGNORED_PHONE_COOLDOWN_MS = 1000 * 60 * 60 * 24

const inviteAttemptsByUser = new Map<string, number[]>()
const inviteAttemptsByPhone = new Map<string, number[]>()
const recentInviteByUserPhone = new Map<string, number>()
const cancelledInviteCooldowns = new Map<string, number>()
const ignoredRequestCooldowns = new Map<string, number>()

const ABUSIVE_WORDS = ['fuck', 'shit', 'bitch', 'cunt', 'slur']
const SPAMMY_PATTERN = /(https?:\/\/|www\.|<[^>]+>|script|javascript:)/i
const CONTROL_CHAR_PATTERN = /[\u0000-\u001f\u007f-\u009f]/

function pruneWindow(values: number[], nowMs: number, windowMs: number) {
  return values.filter((value) => nowMs - value < windowMs)
}

function rateLimitKey(userId: string, phone: string) {
  return `${userId}:${phone}`
}

function checkInviteRateLimit(userId: string, phone: string, now = new Date()) {
  if (process.env.INVITE_THROTTLE_DISABLED === '1') return null

  const nowMs = now.getTime()
  const userAttempts = pruneWindow(
    inviteAttemptsByUser.get(userId) ?? [],
    nowMs,
    INVITE_WINDOW_MS
  )
  const phoneAttempts = pruneWindow(
    inviteAttemptsByPhone.get(phone) ?? [],
    nowMs,
    INVITE_WINDOW_MS
  )
  const userPhoneKey = rateLimitKey(userId, phone)
  const lastSamePhoneAttempt = recentInviteByUserPhone.get(userPhoneKey) ?? 0
  const cancelledUntil = cancelledInviteCooldowns.get(userPhoneKey) ?? 0
  const ignoredUntil = ignoredRequestCooldowns.get(userPhoneKey) ?? 0

  if (userAttempts.length >= INVITES_PER_USER_WINDOW) return 'user_window'
  if (phoneAttempts.length >= INVITES_PER_PHONE_WINDOW) return 'phone_window'
  if (nowMs - lastSamePhoneAttempt < SAME_PHONE_COOLDOWN_MS) {
    return 'same_phone_cooldown'
  }
  if (cancelledUntil > nowMs) return 'cancelled_cooldown'
  if (ignoredUntil > nowMs) return 'ignored_cooldown'

  return null
}

function recordInviteAttempt(userId: string, phone: string, now = new Date()) {
  const nowMs = now.getTime()
  const userAttempts = pruneWindow(
    inviteAttemptsByUser.get(userId) ?? [],
    nowMs,
    INVITE_WINDOW_MS
  )
  const phoneAttempts = pruneWindow(
    inviteAttemptsByPhone.get(phone) ?? [],
    nowMs,
    INVITE_WINDOW_MS
  )

  userAttempts.push(nowMs)
  phoneAttempts.push(nowMs)
  inviteAttemptsByUser.set(userId, userAttempts)
  inviteAttemptsByPhone.set(phone, phoneAttempts)
  recentInviteByUserPhone.set(rateLimitKey(userId, phone), nowMs)
}

function rememberCancelledInvite(
  userId: string,
  phone: string,
  now = new Date()
) {
  cancelledInviteCooldowns.set(
    rateLimitKey(userId, phone),
    now.getTime() + CANCELLED_PHONE_COOLDOWN_MS
  )
}

export function rememberIgnoredFriendRequest(
  requesterUserId: string,
  inviteeUserId: string,
  now = new Date()
) {
  ignoredRequestCooldowns.set(
    rateLimitKey(requesterUserId, inviteeUserId),
    now.getTime() + IGNORED_PHONE_COOLDOWN_MS
  )
}

export function resetFriendInvitationRateLimitForTests() {
  inviteAttemptsByUser.clear()
  inviteAttemptsByPhone.clear()
  recentInviteByUserPhone.clear()
  cancelledInviteCooldowns.clear()
  ignoredRequestCooldowns.clear()
}

function containsAbusiveText(value: string) {
  const lower = value.toLocaleLowerCase('en-US')
  return ABUSIVE_WORDS.some((word) => lower.includes(word))
}

function hasGiantUnicodeSpam(value: string) {
  const symbols = Array.from(value).filter((char) =>
    /[^\p{L}\p{N}\p{P}\p{Zs}]/u.test(char)
  )
  return symbols.length > 6 || /(.)\1{8,}/u.test(value)
}

function textLooksUnsafe(value: string) {
  return (
    CONTROL_CHAR_PATTERN.test(value) ||
    SPAMMY_PATTERN.test(value) ||
    containsAbusiveText(value) ||
    hasGiantUnicodeSpam(value)
  )
}

type CreateFriendInvitationBody = {
  inviteeDisplayName: string
  phone: string
  suggestedInterests: string[]
}

type ValidationResult =
  | { ok: true; value: CreateFriendInvitationBody }
  | { ok: false; status: number; error: string; message: string }

function getBaseUrl(request: Request): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_URL
  if (configured) return configured.replace(/\/$/, '')

  // On Vercel, prefer the project's stable production hostname over the
  // request host so invites created from a preview deployment still link
  // to production. VERCEL_PROJECT_PRODUCTION_URL is auto-injected on every
  // deployment and contains the hostname only (no scheme).
  const vercelProd = process.env.VERCEL_PROJECT_PRODUCTION_URL
  if (vercelProd) return `https://${vercelProd.replace(/\/$/, '')}`

  const host =
    request.headers.get('x-forwarded-host') ?? request.headers.get('host')
  const protocol = request.headers.get('x-forwarded-proto') ?? 'https'
  return host ? `${protocol}://${host}` : new URL(request.url).origin
}

function normalizeText(value: string): string {
  return value.trim().replace(/\s+/g, ' ')
}

export function validateCreateFriendInvitationBody(
  body: unknown
): ValidationResult {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return {
      ok: false,
      status: 400,
      error: 'invalid_request',
      message: 'Request body is required.',
    }
  }

  const record = body as Record<string, unknown>
  const inviteeDisplayName =
    typeof record.inviteeDisplayName === 'string'
      ? normalizeText(record.inviteeDisplayName)
      : ''

  if (!inviteeDisplayName) {
    return {
      ok: false,
      status: 400,
      error: 'missing_invitee_display_name',
      message: 'inviteeDisplayName is required.',
    }
  }

  if (
    inviteeDisplayName.length > MAX_INVITEE_DISPLAY_NAME_LENGTH ||
    textLooksUnsafe(inviteeDisplayName)
  ) {
    return {
      ok: false,
      status: 400,
      error: 'invalid_invitee_display_name',
      message: `Use a real display name, ${MAX_INVITEE_DISPLAY_NAME_LENGTH} characters or fewer.`,
    }
  }

  const rawPhone = typeof record.phone === 'string' ? record.phone.trim() : ''
  if (!rawPhone || !isUsPhoneNumber(rawPhone)) {
    return {
      ok: false,
      status: 400,
      error: 'invalid_phone',
      message: 'US phone number required.',
    }
  }

  if (
    record.suggestedInterests !== undefined &&
    (!Array.isArray(record.suggestedInterests) ||
      !record.suggestedInterests.every(
        (interest) => typeof interest === 'string'
      ))
  ) {
    return {
      ok: false,
      status: 400,
      error: 'invalid_suggested_interests',
      message: 'suggestedInterests must be an array of strings.',
    }
  }

  const seen = new Set<string>()
  const suggestedInterests: string[] = []
  for (const interest of (record.suggestedInterests ?? []) as string[]) {
    const normalizedInterest = normalizeText(interest)
    if (!normalizedInterest) continue

    if (
      normalizedInterest.length > MAX_SUGGESTED_INTEREST_LENGTH ||
      textLooksUnsafe(normalizedInterest)
    ) {
      return {
        ok: false,
        status: 400,
        error: 'invalid_suggested_interests',
        message: `Each idea should be a short, friendly phrase (${MAX_SUGGESTED_INTEREST_LENGTH} characters or fewer).`,
      }
    }

    const dedupeKey = normalizedInterest.toLocaleLowerCase('en-US')
    if (seen.has(dedupeKey)) continue

    seen.add(dedupeKey)
    suggestedInterests.push(normalizedInterest)
  }

  if (suggestedInterests.length > MAX_SUGGESTED_INTERESTS) {
    return {
      ok: false,
      status: 400,
      error: 'too_many_suggested_interests',
      message: `suggestedInterests must contain ${MAX_SUGGESTED_INTERESTS} or fewer values.`,
    }
  }

  return {
    ok: true,
    value: {
      inviteeDisplayName,
      phone: normalizePhone(rawPhone),
      suggestedInterests,
    },
  }
}

function interestPhrase(suggestedInterests: string[]) {
  if (suggestedInterests.length === 1) return suggestedInterests[0]
  if (suggestedInterests.length === 2) {
    return `${suggestedInterests[0]} and ${suggestedInterests[1]}`
  }
  if (suggestedInterests.length === 3) {
    return `${suggestedInterests[0]}, ${suggestedInterests[1]}, and ${suggestedInterests[2]}`
  }
  return null
}

export function buildFriendInvitationMessage({
  inviteUrl,
  suggestedInterests,
}: {
  inviteUrl: string
  suggestedInterests: string[]
}): string {
  const ideas = interestPhrase(suggestedInterests)
  const ideaCopy = ideas
    ? ` I added a few ideas that made me think of you — ${ideas}. Keep, edit, or ignore them.`
    : ''

  return `Hey — I thought you’d like this corner of Joshing.${ideaCopy} No app to download — just tap this: ${inviteUrl}`
}

export function buildExistingUserFriendInvitationMessage({
  inviteUrl,
  suggestedInterests,
}: {
  inviteUrl: string
  suggestedInterests: string[]
}): string {
  const ideas = interestPhrase(suggestedInterests)
  const ideaCopy = ideas
    ? ` I added a few areas I think overlap with your world — ${ideas}. Keep, edit, or ignore them.`
    : ''

  return `Hey — I thought you’d like this corner of Joshing.${ideaCopy} Tap this when you have a minute: ${inviteUrl}`
}

function maskPhoneNumber(phone: string): string {
  const digits = phone.replace(/\D/g, '')
  const local =
    digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits

  if (local.length === 10) {
    return `(${local.slice(0, 3)}) •••-${local.slice(6)}`
  }

  return phone.length > 4 ? `••••${phone.slice(-4)}` : '••••'
}

function serializeOutgoingInvitation(
  invitation: OutgoingFriendInvitation,
  request: Request
) {
  const inviteUrl =
    invitation.status === 'pending'
      ? `${getBaseUrl(request)}/invite/${invitation.token}`
      : null
  const message = inviteUrl
    ? buildFriendInvitationMessage({
        inviteUrl,
        suggestedInterests: invitation.suggestedInterests,
      })
    : null

  return {
    id: invitation.id,
    inviteeDisplayName: invitation.inviteeDisplayName ?? 'Friend',
    inviteeUserId:
      invitation.status === 'accepted' ? invitation.inviteeUserId ?? null : null,
    inviteePhoneMasked: maskPhoneNumber(invitation.inviteePhone),
    inviteePhoneForActions:
      invitation.status === 'pending' || invitation.status === 'expired'
        ? invitation.inviteePhone
        : null,
    suggestedInterests: invitation.suggestedInterests,
    status: invitation.status,
    sentAt: invitation.sentAt.toISOString(),
    acceptedAt: invitation.acceptedAt?.toISOString() ?? null,
    cancelledAt: invitation.cancelledAt?.toISOString() ?? null,
    expiresAt: invitation.expiresAt.toISOString(),
    message,
  }
}

async function getUserByPhone(phone: string) {
  const [user] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.phoneNumber, phone))
    .limit(1)

  return user ?? null
}

export async function GET(request: Request) {
  const session = await getSession()
  if (!session)
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  try {
    const invitations = await listOutgoingFriendInvitations({
      inviterUserId: session.userId,
    })

    return NextResponse.json({
      ok: true,
      invitations: invitations.map((invitation) =>
        serializeOutgoingInvitation(invitation, request)
      ),
    })
  } catch (error) {
    console.error('[friend-invitations] list failed', error)
    return NextResponse.json(
      { error: 'server_error', message: 'Unable to load friend invitations.' },
      { status: 500 }
    )
  }
}

export async function DELETE(request: Request) {
  const session = await getSession()
  if (!session)
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = (await request.json().catch(() => null)) as Record<
    string,
    unknown
  > | null
  const invitationId =
    typeof body?.invitationId === 'string' ? body.invitationId.trim() : ''

  if (!invitationId) {
    return NextResponse.json(
      { error: 'missing_invitation_id', message: 'invitationId is required.' },
      { status: 400 }
    )
  }

  try {
    const invitation = await cancelFriendInvitation({
      invitationId,
      inviterUserId: session.userId,
    })

    if (!invitation) {
      return NextResponse.json(
        { error: 'not_found', message: 'Pending invitation was not found.' },
        { status: 404 }
      )
    }

    rememberCancelledInvite(session.userId, invitation.inviteePhone)
    logTelemetry('add_friend_invite_cancelled', {
      inviter_user_id: session.userId,
      invitation_id: invitation.id,
    })

    return NextResponse.json({
      ok: true,
      invitationId: invitation.id,
      status: 'cancelled',
    })
  } catch (error) {
    console.error('[friend-invitations] cancel failed', error)
    return NextResponse.json(
      { error: 'server_error', message: 'Unable to cancel friend invitation.' },
      { status: 500 }
    )
  }
}

export async function POST(request: Request) {
  const session = await getSession()
  if (!session)
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const parsed = validateCreateFriendInvitationBody(
    await request.json().catch(() => null)
  )
  if (!parsed.ok) {
    return NextResponse.json(
      { error: parsed.error, message: parsed.message },
      { status: parsed.status }
    )
  }

  try {
    const { inviteeDisplayName, phone, suggestedInterests } = parsed.value
    const rateLimitReason = checkInviteRateLimit(session.userId, phone)
    if (rateLimitReason) {
      logTelemetry('add_friend_invite_rate_limited', {
        inviter_user_id: session.userId,
        invitee_phone_hash: phone.slice(-4),
        reason: rateLimitReason,
      })
      return NextResponse.json(
        {
          error: 'invite_cooldown',
          message:
            'Give this invite a little breathing room before trying again.',
        },
        { status: 429 }
      )
    }

    const existingUser = await getUserByPhone(phone)

    if (existingUser) {
      if (existingUser.id === session.userId) {
        return NextResponse.json(
          { error: 'self_invite', message: 'You cannot invite yourself.' },
          { status: 400 }
        )
      }

      const ignoredCooldownReason = checkInviteRateLimit(
        session.userId,
        existingUser.id
      )
      if (ignoredCooldownReason === 'ignored_cooldown') {
        logTelemetry('friend_request_reinvite_after_ignore_limited', {
          inviter_user_id: session.userId,
          invitee_user_id: existingUser.id,
        })
        return NextResponse.json(
          {
            error: 'invite_cooldown',
            message:
              'Give this invite a little breathing room before trying again.',
          },
          { status: 429 }
        )
      }

      const { friendship: friendshipRequest, state } =
        await createOrReusePendingFriendshipRequest({
          inviterUserId: session.userId,
          inviteeUserId: existingUser.id,
          suggestedInterests,
        })

      const inviteUrl = `${getBaseUrl(request)}/activities#friendship-${encodeURIComponent(friendshipRequest.id)}`
      const message = buildExistingUserFriendInvitationMessage({
        inviteUrl,
        suggestedInterests,
      })

      recordInviteAttempt(session.userId, phone)
      recordInviteAttempt(session.userId, existingUser.id)

      logTelemetry('friend_request_existing_user_created', {
        inviter_user_id: session.userId,
        invitee_user_id: existingUser.id,
        friendship_id: friendshipRequest.id,
        state,
        suggested_interest_count: suggestedInterests.length,
      })

      return NextResponse.json({
        ok: true,
        type: 'friendship_request',
        state,
        id: friendshipRequest.id,
        invitationId: null,
        inviteUrl,
        message,
        inviteeDisplayName,
        inviteePhone: phone,
        suggestedInterests,
        expiresAt: null,
        friendshipRequest: {
          id: friendshipRequest.id,
          status: friendshipRequest.status,
          state,
          inviteeUserId: existingUser.id,
        },
      })
    }

    const invitation = await createFriendInvitation({
      inviterUserId: session.userId,
      inviteePhone: phone,
      inviteeDisplayName,
      preSeededInterests: suggestedInterests,
    })

    const inviteUrl = `${getBaseUrl(request)}/invite/${invitation.token}`
    const message = buildFriendInvitationMessage({
      inviteUrl,
      suggestedInterests,
    })

    recordInviteAttempt(session.userId, phone)

    logTelemetry('add_friend_invite_created', {
      inviter_user_id: session.userId,
      invitation_id: invitation.id,
      suggested_interest_count: suggestedInterests.length,
    })

    if (invitation.personalMessage !== message) {
      await db
        .update(friendInvitations)
        .set({ personalMessage: message })
        .where(eq(friendInvitations.id, invitation.id))
    }

    return NextResponse.json({
      ok: true,
      type: 'friend_invitation',
      id: invitation.id,
      invitationId: invitation.id,
      inviteUrl,
      message,
      inviteeDisplayName: invitation.inviteeDisplayName ?? inviteeDisplayName,
      inviteePhone: invitation.inviteePhone,
      suggestedInterests,
      expiresAt: invitation.expiresAt.toISOString(),
    })
  } catch (error) {
    console.error('[friend-invitations] create failed', error)
    return NextResponse.json(
      { error: 'server_error', message: 'Unable to create friend invitation.' },
      { status: 500 }
    )
  }
}
