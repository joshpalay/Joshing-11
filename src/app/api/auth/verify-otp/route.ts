import { eq } from 'drizzle-orm'
import { NextResponse } from 'next/server'

import { verifyOtp } from '@/server/auth'
import { createSession } from '@/server/auth/session'
import { db, users } from '@/server/db'
import {
  acceptFriendInvitation,
  INVITATION_ACCEPTANCE_ERROR_MESSAGE,
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

async function getOrCreateUserForLogin(phoneNumber: string): Promise<AuthUser> {
  const selection = {
    id: users.id,
    phoneNumber: users.phoneNumber,
    displayName: users.displayName,
    timezone: users.timezone,
  }

  const [createdUser] = await db
    .insert(users)
    .values({ phoneNumber })
    .onConflictDoNothing({ target: users.phoneNumber })
    .returning(selection)

  if (createdUser) return createdUser

  const [existingUser] = await db
    .select(selection)
    .from(users)
    .where(eq(users.phoneNumber, phoneNumber))
    .limit(1)

  if (!existingUser) {
    throw new Error('Unable to find or create user for verified phone number.')
  }

  return existingUser
}

export async function POST(request: Request) {
  try {
    const body = (await request
      .json()
      .catch(() => null)) as VerifyOtpBody | null
    const phone = typeof body?.phone === 'string' ? body.phone.trim() : ''
    const code = typeof body?.code === 'string' ? body.code.trim() : ''
    const hasInvitationToken =
      body?.invitationToken !== undefined && body?.invitationToken !== null
    const invitationToken =
      typeof body?.invitationToken === 'string'
        ? body.invitationToken.trim()
        : ''

    if (!phone || !code) {
      return NextResponse.json(
        { error: 'invalid_request', message: 'phone and code are required' },
        { status: 400 }
      )
    }

    const normalizedPhone = await verifyOtp(phone, code)

    if (!normalizedPhone) {
      return NextResponse.json(
        { error: 'invalid_code', message: 'Code invalid or expired' },
        { status: 401 }
      )
    }

    if (hasInvitationToken && !invitationToken) {
      return NextResponse.json(
        {
          error: 'invalid_invitation',
          message: INVITATION_ACCEPTANCE_ERROR_MESSAGE,
        },
        { status: 400 }
      )
    }

    const user = await getOrCreateUserForLogin(normalizedPhone)

    const invitation = hasInvitationToken
      ? await acceptFriendInvitation({
          token: invitationToken,
          inviteeUserId: user.id,
          verifiedPhone: normalizedPhone,
        })
      : { accepted: false }

    if (hasInvitationToken && !invitation.accepted) {
      return NextResponse.json(
        {
          error: 'invalid_invitation',
          message: INVITATION_ACCEPTANCE_ERROR_MESSAGE,
        },
        { status: 400 }
      )
    }

    await createSession(user.id)

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
