import { NextResponse } from 'next/server';

import { getSession } from '@/server/auth/session';
import { sendVerificationEmail } from '@/server/email/send-verification';

export const dynamic = 'force-dynamic';

export async function POST() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const result = await sendVerificationEmail(session.userId);

  if (result.ok) {
    return NextResponse.json({ ok: true });
  }

  if (result.reason === 'no_pending_email') {
    return NextResponse.json(
      { error: 'no_pending_email', message: 'Add an email address first.' },
      { status: 400 },
    );
  }

  if (result.reason === 'rate_limited') {
    return NextResponse.json(
      {
        error: 'rate_limited',
        message: 'Please wait a moment before requesting another email.',
        retryAfterMs: result.retryAfterMs,
      },
      { status: 429 },
    );
  }

  return NextResponse.json(
    {
      error: 'send_failed',
      message: "We couldn't send the confirmation email. Try again in a minute.",
    },
    { status: 502 },
  );
}
