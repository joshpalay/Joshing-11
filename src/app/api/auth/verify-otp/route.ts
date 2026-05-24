import { randomUUID } from 'node:crypto'

import { eq } from 'drizzle-orm'
import { NextResponse } from 'next/server'

import { colorForUser } from '@/components/feed/visual'
import { verifyOtp } from '@/server/auth'
import { createSession } from '@/server/auth/session'
import { db, users } from '@/server/db'
import {
  acceptFriendInvitation,
  getValidInvitationForPhone,
  INVITATION_ACCEPTANCE_ERROR_MESSAGE,
  INVITE_REQUIRED_MESSAGE,
} from '@/server/friends/invitations'
import { acceptUserInviteLink } from '@/server/friends/user-invite-token'

type VerifyOtpBody = {
  phone?: unknown
  code?: unknown
  invitationToken?: unknown
  userInvite?: unknown
}

function parseUserInvite(value: unknown): { handle: string; token: string } | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as { handle?: unknown; token?: unknown }
  const handle = typeof candidate.handle === 'string' ? candidate.handle.trim() : ''
  const token = typeof candidate.token === 'string' ? candidate.token.trim() : ''
  if (!handle || !token) return null
  return { handle, token }
}

type AuthUser = {
  id: string
  phoneNumber: string
  displayName: string | null
  timezone: string
}

const USER_SELECTION = {
  id: users.id,
  phoneNumber: users.phoneNumber,
  displayName: users.displayName,
  timezone: users.timezone,
}

async function findUserByPhone(
  phoneNumber: string
): Promise<AuthUser | null> {
  const [existing] = await db
    .select(USER_SELECTION)
    .from(users)
    .where(eq(users.phoneNumber, phoneNumber))
    .limit(1)

  return existing ?? null
}

async function provisionUserForPhone(
  phoneNumber: string
): Promise<AuthUser> {
  // Pre-generate the id so we can persist a deterministic avatar_color in the
  // same insert (colorForUser hashes the id). Without this, avatar_color
  // would be NULL until the next signup backfill.
  const id = randomUUID()
  const [created] = await db
    .insert(users)
    .values({ id, phoneNumber, avatarColor: colorForUser(id) })
    .onConflictDoNothing({ target: users.phoneNumber })
    .returning(USER_SELECTION)

  if (created) return created

  // Conflict: another request created the user between findUserByPhone and now.
  const existing = await findUserByPhone(phoneNumber)
  if (!existing) {
    throw new Error('Unable to find or create user for verified phone number.')
  }
  return existing
}

function invitationRejection() {
  return NextResponse.json(
    {
      error: 'invalid_invitation',
      message: INVITATION_ACCEPTANCE_ERROR_MESSAGE,
    },
    { status: 400 }
  )
}

function inviteRequiredRejection() {
  return NextResponse.json(
    {
      error: 'invite_required',
      message: INVITE_REQUIRED_MESSAGE,
    },
    { status: 403 }
  )
}

export async function POST(request: Request) {
  try {
    const body = (await request
      .json()
      .catch(() => null)) as VerifyOtpBody | null
    const phone = typeof body?.phone === 'string' ? body.phone.trim() : ''
    const code = typeof body?.code === 'string' ? body.code.trim() : ''
    const tokenProvided =
      body?.invitationToken !== undefined && body?.invitationToken !== null
    const invitationToken =
      typeof body?.invitationToken === 'string'
        ? body.invitationToken.trim()
        : ''
    const hasUsableToken = tokenProvided && invitationToken.length > 0
    const userInvite = parseUserInvite(body?.userInvite)

    if (!phone || !code) {
      return NextResponse.json(
        { error: 'invalid_request', message: 'phone and code are required' },
        { status: 400 }
      )
    }

    // A token field was supplied but it's empty/whitespace — reject before
    // anything else. This closes the `{"invitationToken": ""}` bypass.
    if (tokenProvided && !hasUsableToken) {
      return invitationRejection()
    }

    const normalizedPhone = await verifyOtp(phone, code)

    if (!normalizedPhone) {
      return NextResponse.json(
        { error: 'invalid_code', message: 'Code invalid or expired' },
        { status: 401 }
      )
    }

    const existingUser = await findUserByPhone(normalizedPhone)

    // Re-login path: any existing user can re-authenticate after OTP. The
    // invitation gate only applies to new-account creation below. This is
    // intentional policy (2026-05-16): accounts created before the invitation
    // gate was added are grandfathered — they re-authenticate freely. Only
    // brand-new accounts must arrive via an accepted friend invitation.
    if (existingUser) {
      let invitationResult: { accepted: boolean } = { accepted: false }

      if (hasUsableToken) {
        invitationResult = await acceptFriendInvitation({
          token: invitationToken,
          inviteeUserId: existingUser.id,
          verifiedPhone: normalizedPhone,
        })
      }

      // Per-user invite-link flow (B-Friends-3): when the visitor arrived
      // via /invite/<handle>/<token>, create the active friendship now.
      // Silent on failure — the worst case is the user logs in without
      // the new friendship, which they can fix via Add Friend.
      if (userInvite) {
        await acceptUserInviteLink({
          handle: userInvite.handle,
          token: userInvite.token,
          inviteeUserId: existingUser.id,
        })
      }

      await createSession(existingUser.id, {
        invitationAccepted: true,
        onboardingComplete: false,
      })

      return NextResponse.json({
        user: {
          id: existingUser.id,
          phone_number: existingUser.phoneNumber,
          display_name: existingUser.displayName,
          timezone: existingUser.timezone,
          onboardingComplete: false,
        },
        invitation: invitationResult,
      })
    }

    // New-user path: an invitation is a hard precondition. Either a
    // FriendInvitation token (SMS-style) or a per-user invite link
    // (B-Friends-3) satisfies the gate.
    if (!hasUsableToken && !userInvite) {
      return inviteRequiredRejection()
    }

    // Pre-validate the FriendInvitation read-only so we don't provision a
    // user for a bad token. Only required when no per-user invite link is
    // present — userInvite alone is a sufficient gate.
    if (hasUsableToken) {
      const candidateInvitation = await getValidInvitationForPhone({
        token: invitationToken,
        verifiedPhone: normalizedPhone,
      })

      if (!candidateInvitation) {
        return invitationRejection()
      }
    }

    const user = await provisionUserForPhone(normalizedPhone)

    let invitation: { accepted: boolean } = { accepted: false }

    if (hasUsableToken) {
      invitation = await acceptFriendInvitation({
        token: invitationToken,
        inviteeUserId: user.id,
        verifiedPhone: normalizedPhone,
      })

      if (!invitation.accepted) {
        // Race condition: the invitation was claimed between our pre-validate
        // and accept. The user row already exists but has no accepted
        // invitation — future logins will hit the orphan-rejection branch
        // above, so the access surface is closed.
        return invitationRejection()
      }
    } else if (userInvite) {
      // Per-user invite link path: create the active friendship now. If
      // the link is bad we still let the user through — they're already
      // provisioned, and a missing friendship is recoverable.
      invitation = await acceptUserInviteLink({
        handle: userInvite.handle,
        token: userInvite.token,
        inviteeUserId: user.id,
      })
    }

    await createSession(user.id, {
      invitationAccepted: true,
      onboardingComplete: false,
    })

    return NextResponse.json({
      user: {
        id: user.id,
        phone_number: user.phoneNumber,
        display_name: user.displayName,
        timezone: user.timezone,
        onboardingComplete: false,
      },
      invitation,
    })
  } catch (error) {
    console.error('[auth/verify-otp] failed', error)
    return NextResponse.json(
      { error: 'server_error', message: 'Unable to verify code.' },
      { status: 500 }
    )
  }
}
