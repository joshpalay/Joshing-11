import { eq } from 'drizzle-orm'
import { NextResponse } from 'next/server'

import { verifyOtp } from '@/server/auth'
import { createSession } from '@/server/auth/session'
import { db, users } from '@/server/db'
import {
  acceptFriendInvitation,
  getValidInvitationForPhone,
  INVITATION_ACCEPTANCE_ERROR_MESSAGE,
  INVITE_REQUIRED_MESSAGE,
} from '@/server/friends/invitations'

type VerifyOtpBody = {
  phone?: unknown
  code?: unknown
  invitationToken?: unknown
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
  const [created] = await db
    .insert(users)
    .values({ phoneNumber })
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

      await createSession(existingUser.id, { invitationAccepted: true })

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

    // New-user path: invitation is a hard precondition.
    if (!hasUsableToken) {
      return inviteRequiredRejection()
    }

    // Pre-validate the invitation read-only so we don't provision a user
    // for a bad token.
    const candidateInvitation = await getValidInvitationForPhone({
      token: invitationToken,
      verifiedPhone: normalizedPhone,
    })

    if (!candidateInvitation) {
      return invitationRejection()
    }

    const user = await provisionUserForPhone(normalizedPhone)

    const invitation = await acceptFriendInvitation({
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

    await createSession(user.id, { invitationAccepted: true })

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
