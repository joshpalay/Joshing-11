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
import { buildOtpMessage, sendSms } from '@/server/sms';

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
      const delivery = await sendSms(prefill.inviteePhone, buildOtpMessage(code), 'otp');

      if (process.env.NODE_ENV === 'production' && !delivery.ok) {
        return NextResponse.json(
          { error: 'sms_delivery_failed', message: 'Unable to send code. Please try again.' },
          { status: 502 },
        );
      }

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
        // Phone-first invite path (D-AUTH-INVITE-PHONE-FIRST §6.4): when a
        // FriendInvitation token rode along, an edited number with no claim of
        // its own is a benign correction, not an intrusion. Return a
        // distinguishable signal so the client can render the warm
        // "use the invited number" dead-end instead of a generic invite-only
        // error. The gate is NOT loosened — no OTP is sent and the request is
        // still rejected; only the label differs.
        if (parsed.data.invitationToken) {
          return NextResponse.json(
            { error: 'invite_phone_unclaimed', message: INVITE_REQUIRED_MESSAGE },
            { status: 403 },
          );
        }
        return NextResponse.json(
          { error: 'invite_required', message: INVITE_REQUIRED_MESSAGE },
          { status: 403 },
        );
      }
    }

    const { code } = await requestOtp(phone);
    const delivery = await sendSms(phone, buildOtpMessage(code), 'otp', existingUser?.id);

    if (process.env.NODE_ENV === 'production' && !delivery.ok) {
      return NextResponse.json(
        { error: 'sms_delivery_failed', message: 'Unable to send code. Please try again.' },
        { status: 502 },
      );
    }

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
