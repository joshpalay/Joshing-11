import { and, eq, isNull, or } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { createSession } from '@/server/auth/session';
import { isUsPhoneNumber, normalizePhone } from '@/server/auth/phone';
import { getUserByPhone, createUser, updateUser } from '@/server/db/queries/users';
import { db, friendInvitations, friendships } from '@/server/db';

const TEMPORARY_OTP_CODE = '000000';

type VerifyOtpBody = {
  phone?: unknown;
  code?: unknown;
  invitationToken?: unknown;
};

function friendshipPair(a: string, b: string) {
  return a < b ? { userAId: a, userBId: b } : { userAId: b, userBId: a };
}

async function acceptInvitation(token: string, inviteeUserId: string) {
  const [invitation] = await db
    .select()
    .from(friendInvitations)
    .where(eq(friendInvitations.token, token))
    .limit(1);

  if (!invitation || invitation.acceptedAt || invitation.expiresAt < new Date()) {
    return { accepted: false };
  }

  if (invitation.inviterUserId === inviteeUserId) {
    return { accepted: false };
  }

  const pair = friendshipPair(invitation.inviterUserId, inviteeUserId);
  const now = new Date();

  await db.transaction(async (tx) => {
    await tx
      .update(friendInvitations)
      .set({ acceptedAt: now, inviteeUserId })
      .where(
        and(
          eq(friendInvitations.id, invitation.id),
          or(eq(friendInvitations.inviteeUserId, inviteeUserId), isNull(friendInvitations.inviteeUserId)),
        ),
      );

    await tx
      .insert(friendships)
      .values({
        ...pair,
        status: 'active',
        requestedByUserId: invitation.inviterUserId,
        formedVia: 'invitation',
        formedAt: now,
        removedAt: null,
        removedByUserId: null,
      })
      .onConflictDoUpdate({
        target: [friendships.userAId, friendships.userBId],
        set: {
          status: 'active',
          requestedByUserId: invitation.inviterUserId,
          formedVia: 'invitation',
          formedAt: now,
          removedAt: null,
          removedByUserId: null,
        },
      });
  });

  return { accepted: true };
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as VerifyOtpBody | null;
    const phone = typeof body?.phone === 'string' ? body.phone.trim() : '';
    const code = typeof body?.code === 'string' ? body.code.trim() : '';
    const invitationToken =
      typeof body?.invitationToken === 'string' ? body.invitationToken.trim() : '';

    if (!phone || !code) {
      return NextResponse.json(
        { error: 'invalid_request', message: 'phone and code are required' },
        { status: 400 },
      );
    }

    if (!isUsPhoneNumber(phone)) {
      return NextResponse.json(
        { error: 'invalid_phone', message: 'US phone number required' },
        { status: 400 },
      );
    }

    if (code !== TEMPORARY_OTP_CODE) {
      return NextResponse.json(
        { error: 'invalid_code', message: 'Code invalid or expired' },
        { status: 401 },
      );
    }

    const normalizedPhone = normalizePhone(phone);
    const existingUser = await getUserByPhone(normalizedPhone);
    const user = existingUser
      ? await updateUser(existingUser.id, { phoneVerified: true })
      : await createUser(normalizedPhone);

    await createSession(user.id);

    const invitation = invitationToken
      ? await acceptInvitation(invitationToken, user.id)
      : { accepted: false };

    return NextResponse.json({
      user: {
        id: user.id,
        phone_number: user.phoneNumber,
        display_name: user.displayName,
        timezone: user.timezone,
        onboardingComplete: 'onboardingComplete' in user ? user.onboardingComplete : false,
      },
      invitation,
    });
  } catch (error) {
    console.error('[auth/verify-otp] failed', error);
    return NextResponse.json(
      { error: 'server_error', message: 'Unable to verify code.' },
      { status: 500 },
    );
  }
}
