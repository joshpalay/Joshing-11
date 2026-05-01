import { NextResponse } from 'next/server';

import { requestOtp, isUsPhoneNumber, normalizePhone } from '@/server/auth/otp-store';
import { prisma } from '@/lib/prisma';
import { sendSms } from '@/server/sms';

const OTP_RATE_LIMIT_PER_HOUR = 3;

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
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const recentOtpCount = await prisma.smsLog.count({
      where: {
        phone_number: phone,
        message_type: 'otp',
        sent_at: { gte: oneHourAgo },
      },
    });

    if (recentOtpCount >= OTP_RATE_LIMIT_PER_HOUR) {
      return NextResponse.json(
        { error: 'rate_limited', message: 'Too many codes requested. Try again later.' },
        { status: 429 },
      );
    }

    const { code, normalizedPhone } = await requestOtp(phone);
    await sendSms(normalizedPhone, `Your Joshing code: ${code}`, 'otp');

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[auth/request-otp] failed', error);
    return NextResponse.json(
      { error: 'server_error', message: 'Unable to send code.' },
      { status: 500 },
    );
  }
}
