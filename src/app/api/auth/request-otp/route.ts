import { NextResponse } from 'next/server';

import { isUsPhoneNumber, normalizePhone } from '@/server/auth/phone';

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

    return NextResponse.json({ ok: true, phone });
  } catch (error) {
    console.error('[auth/request-otp] failed', error);
    return NextResponse.json(
      { error: 'server_error', message: 'Unable to send code.' },
      { status: 500 },
    );
  }
}
