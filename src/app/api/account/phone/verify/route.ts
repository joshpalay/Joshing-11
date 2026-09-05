import { NextResponse } from 'next/server';
import { z } from 'zod';

import { requestOtp, verifyOtp } from '@/server/auth';
import { getSession } from '@/server/auth/session';
import { getReminderState, markPhoneVerified } from '@/server/db/queries/account';
import { buildOtpMessage, sendSms } from '@/server/sms';

const bodySchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('send') }),
  z.object({
    action: z.literal('confirm'),
    code: z
      .string()
      .trim()
      .regex(/^\d{6}$/),
  }),
]);

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid_request', message: 'Enter the 6-digit verification code.' },
      { status: 400 },
    );
  }

  const state = await getReminderState(session.userId);
  if (!state) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  if (state.phoneVerified) {
    return NextResponse.json({ ok: true, verified: true, state });
  }

  if (parsed.data.action === 'send') {
    const { code } = await requestOtp(state.phoneNumber);
    const delivery = await sendSms(
      state.phoneNumber,
      buildOtpMessage(code),
      'otp',
      session.userId,
    );

    if (process.env.NODE_ENV === 'production' && !delivery.ok) {
      return NextResponse.json(
        { error: 'sms_delivery_failed', message: 'Unable to send code. Please try again.' },
        { status: 502 },
      );
    }

    return NextResponse.json({
      ok: true,
      verified: false,
      ...(process.env.NODE_ENV !== 'production' ? { debugCode: code } : {}),
    });
  }

  const verifiedPhone = await verifyOtp(state.phoneNumber, parsed.data.code);
  if (verifiedPhone !== state.phoneNumber) {
    return NextResponse.json(
      { error: 'invalid_code', message: 'Code invalid or expired.' },
      { status: 401 },
    );
  }

  const updatedState = await markPhoneVerified(session.userId);
  if (!updatedState) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  return NextResponse.json({ ok: true, verified: true, state: updatedState });
}
