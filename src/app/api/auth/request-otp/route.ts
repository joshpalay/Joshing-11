import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { isUsPhoneNumber, normalizePhone, requestOtp } from '@/server/auth';
import { db, users } from '@/server/db';
import {
  getInvitePrefillByToken,
  hasValidPendingInvitationForPhone,
  INVITATION_ACCEPTANCE_ERROR_MESSAGE,
  INVITE_REQUIRED_MESSAGE,
} from '@/server/friends/invitations';
import { resolveInviteLink } from '@/server/friends/user-invite-token';

const bodySchema = z.object({
  // Optional: in the invite-prefill flow (useInvitePhone) the client sends no
  // phone — the recipient phone is resolved server-side from the invite token.
  phone: z.string().trim().min(1).optional(),
  // SMS friend-invitation token. When `useInvitePhone` is set, the recipient
  // phone is read from this invitation and the code is texted there — the raw
  // phone never crosses to the client (only a masked form is returned).
  invitationToken: z.string().trim().min(1).nullish(),
  useInvitePhone: z.boolean().optional(),
  // Per-user evergreen invite link (B-Friends-3). When a brand-new phone
  // arrives via /u/<handle>/<token>, the invitation is NOT phone-targeted, so
  // hasValidPendingInvitationForPhone() can't see it. The link itself is the
  // invitation credential — a valid {handle, token} satisfies the gate and
  // lets us send the OTP. verify-otp re-validates and forms the friendship.
  userInvite: z
    .object({
      handle: z.string().trim().min(1),
      token: z.string().trim().min(1),
    })
    .nullish(),
});

export async function POST(request: Request) {
  try {
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'invalid_request', message: 'phone is required' },
        { status: 400 },
      );
    }

    // Invite-prefill flow: resolve the recipient phone from the invite token
    // and text the code there. The valid+pending check inherently satisfies
    // the invite gate, so no phone or separate gate check is needed. We return
    // only a masked phone — the raw number never leaves the server.
    if (parsed.data.useInvitePhone && parsed.data.invitationToken) {
      const prefill = await getInvitePrefillByToken(parsed.data.invitationToken);
      if (!prefill) {
        return NextResponse.json(
          { error: 'invalid_invitation', message: INVITATION_ACCEPTANCE_ERROR_MESSAGE },
          { status: 400 },
        );
      }

      const { code } = await requestOtp(prefill.inviteePhone);

      return NextResponse.json({
        ok: true,
        maskedPhone: prefill.maskedPhone,
        ...(process.env.NODE_ENV !== 'production' ? { debugCode: code } : {}),
      });
    }

    const rawPhone = parsed.data.phone;

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
      const invitedByPhone = await hasValidPendingInvitationForPhone(phone);
      const userInvite = parsed.data.userInvite;
      const invitedByLink = userInvite
        ? Boolean(await resolveInviteLink(userInvite.handle, userInvite.token))
        : false;
      if (!invitedByPhone && !invitedByLink) {
        return NextResponse.json(
          { error: 'invite_required', message: INVITE_REQUIRED_MESSAGE },
          { status: 403 },
        );
      }
    }

    // TODO: when OTP goes live, send the code via SMS here
    // (sendSms(phone, ...) from '@/server/sms'). Today requestOtp() only
    // generates + stores the code; nothing texts it. In non-prod the code is
    // returned as debugCode below so the flow can be completed manually.
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
