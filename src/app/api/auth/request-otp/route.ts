import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { isUsPhoneNumber, normalizePhone, requestOtp } from '@/server/auth';
import { db, users } from '@/server/db';
import {
  hasValidPendingInvitationForPhone,
  INVITE_REQUIRED_MESSAGE,
} from '@/server/friends/invitations';

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as { phone?: unknown } | null;
    const rawPhone = typeof body?.phone === 'string' ? body.phone.trim() : '';

    if (!rawPhone) {
      return NextResponse.json(
        { error: 'invalid_request', message: 'phone is required' },
        { status: 400 },
      );
    }

    if (!isUsPhoneNumber(rawPhone)) {
      return NextResponse.json(
        { error: 'invalid_phone', message: 'US phone number required' },
        { status: 400 },
      );
    }

    const phone = normalizePhone(rawPhone);

    const [existingUser] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.phoneNumber, phone))
      .limit(1);

    if (!existingUser) {
      const hasInvite = await hasValidPendingInvitationForPhone(phone);
      if (!hasInvite) {
        return NextResponse.json(
          { error: 'invite_required', message: INVITE_REQUIRED_MESSAGE },
          { status: 403 },
        );
      }
    }

    const { code } = await requestOtp(phone);

    return NextResponse.json({
      ok: true,
      phone,
      ...(process.env.NODE_ENV !== 'production' ? { debugCode: code } : {}),
    });
  } catch (error) {
    console.error('[auth/request-otp] failed', error);
    return NextResponse.json(
      { error: 'server_error', message: 'Unable to send code.' },
      { status: 500 },
    );
  }
}
