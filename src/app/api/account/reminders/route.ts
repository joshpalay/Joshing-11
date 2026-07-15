import { NextResponse } from 'next/server';
import { z } from 'zod';

import { getSession } from '@/server/auth/session';
import {
  getReminderState,
  updateReminderPreferences,
} from '@/server/db/queries/account';
import { sendVerificationEmail } from '@/server/email/send-verification';

export const dynamic = 'force-dynamic';

const bodySchema = z
  .object({
    smsOptIn: z.enum(['opted_in', 'opted_out']).optional(),
    emailOptIn: z.enum(['opted_in', 'opted_out']).optional(),
    pendingEmail: z.string().trim().email().optional(),
    dismissed: z.literal(true).optional(),
    // D-REMINDER-INTERSTITIAL-01: the one-time interstitial marks itself seen on
    // both outcomes. May arrive alone (skip) or alongside pendingEmail/emailOptIn
    // (sign-up) in a single PATCH. Stamps the interstitial column only, never the
    // inline card's dismissed column (Decision D).
    interstitialSeen: z.literal(true).optional(),
  })
  .refine(
    (b) =>
      b.smsOptIn !== undefined ||
      b.emailOptIn !== undefined ||
      b.pendingEmail !== undefined ||
      b.dismissed === true ||
      b.interstitialSeen === true,
    'must specify at least one change',
  );

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const state = await getReminderState(session.userId);
  if (!state) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  return NextResponse.json({ state });
}

export async function PATCH(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const json = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid_body', message: 'No reminder changes provided.' },
      { status: 400 },
    );
  }

  const priorState = await getReminderState(session.userId);

  const result = await updateReminderPreferences(session.userId, parsed.data);
  if (!result.ok) {
    if (result.reason === 'not_found') {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
    if (result.reason === 'email_not_verified') {
      return NextResponse.json(
        {
          error: 'email_not_verified',
          message: 'Verify your email before enabling email reminders.',
        },
        { status: 409 },
      );
    }
    if (result.reason === 'phone_not_verified') {
      return NextResponse.json(
        {
          error: 'phone_not_verified',
          message: 'Verify your phone number before enabling SMS reminders.',
        },
        { status: 409 },
      );
    }
  }

  // Auto-fire the verification email when pendingEmail actually changed.
  // Best-effort: failure is logged but never blocks the save. The UI can
  // also call POST /api/account/email/verify/send to retry / resend.
  let verificationEmailSent = false;
  if (
    result.ok
    && parsed.data.pendingEmail
    && parsed.data.pendingEmail !== priorState?.pendingEmail
  ) {
    const sendResult = await sendVerificationEmail(session.userId);
    verificationEmailSent = sendResult.ok;
    if (!sendResult.ok) {
      console.warn(
        '[reminders] verification email auto-send failed:',
        sendResult.reason,
      );
    }
  }

  return NextResponse.json({
    state: result.ok ? result.state : null,
    verificationEmailSent,
  });
}
