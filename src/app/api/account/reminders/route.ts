import { NextResponse } from 'next/server';
import { z } from 'zod';

import { isBypassTestPhone } from '@/server/auth';
import { getSession } from '@/server/auth/session';
import {
  getReminderState,
  restoreSmsReminderConsent,
  updateReminderPreferences,
} from '@/server/db/queries/account';
import { sendVerificationEmail } from '@/server/email/send-verification';
import { SMS_CONSENT_SOURCES } from '@/server/reminders/acquisition';
import { buildSmsOptInConfirmationMessage, sendSms } from '@/server/sms';

export const dynamic = 'force-dynamic';

const bodySchema = z
  .object({
    smsOptIn: z.enum(['opted_in', 'opted_out']).optional(),
    smsConsentSource: z.enum(SMS_CONSENT_SOURCES).optional(),
    emailOptIn: z.enum(['opted_in', 'opted_out']).optional(),
    pendingEmail: z.string().trim().email().optional(),
    dismissed: z.literal(true).optional(),
    // The one post-onboarding acquisition surface stamps itself seen as soon as
    // it is displayed, retiring further contextual asks while leaving Settings.
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
  )
  .refine(
    (b) => b.smsOptIn !== 'opted_in' || b.smsConsentSource !== undefined,
    'SMS opt-in source is required',
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

  let smsConfirmationSent = false;
  if (result.ok && parsed.data.smsOptIn === 'opted_in' && priorState?.smsOptIn !== 'opted_in') {
    // Allowlisted test numbers (AUTH_OTP_BYPASS_PHONE) skip the real send —
    // same test accounts that bypass the OTP text also need to reach
    // opted_in without a live Twilio delivery to an undeliverable number.
    const sendResult = isBypassTestPhone(result.state.phoneNumber)
      ? ({ ok: true } as const)
      : await sendSms(
          result.state.phoneNumber,
          buildSmsOptInConfirmationMessage(),
          'sms_opt_in_confirmation',
          session.userId,
        );
    if (!sendResult.ok) {
      const rollback = priorState
        ? await restoreSmsReminderConsent(session.userId, priorState)
        : null;
      console.warn(
        '[reminders] SMS opt-in confirmation failed; prior consent state restored:',
        sendResult.reason,
      );
      return NextResponse.json(
        {
          error: 'sms_confirmation_failed',
          message: "We couldn't send the confirmation text, so SMS reminders stayed off.",
          state: rollback,
        },
        { status: 502 },
      );
    }
    smsConfirmationSent = true;
  }

  let finalState = result.ok ? result.state : null;
  if (
    result.ok &&
    parsed.data.smsOptIn === 'opted_in' &&
    parsed.data.smsConsentSource !== 'profile_web_form'
  ) {
    const completed = await updateReminderPreferences(session.userId, {
      dismissed: true,
      interstitialSeen: true,
    });
    if (completed.ok) finalState = completed.state;
  }

  // Auto-fire the verification email when pendingEmail actually changed.
  // Best-effort: failure is logged but never blocks the save. The UI can
  // also call POST /api/account/email/verify/send to retry / resend.
  let verificationEmailSent = false;
  if (
    result.ok &&
    parsed.data.pendingEmail &&
    parsed.data.pendingEmail !== priorState?.pendingEmail
  ) {
    const sendResult = await sendVerificationEmail(session.userId);
    verificationEmailSent = sendResult.ok;
    if (!sendResult.ok) {
      console.warn('[reminders] verification email auto-send failed:', sendResult.reason);
    }
  }

  return NextResponse.json({
    state: finalState,
    verificationEmailSent,
    smsConfirmationSent,
  });
}
