import { eq } from 'drizzle-orm';

import { db, users } from '@/server/db';
import { createVerificationToken } from '@/server/db/queries/email-verification';

import { sendEmail } from './client';
import { buildVerifyEmailTemplate } from './templates/verify-email';

export type SendVerificationEmailResult =
  | { ok: true }
  | { ok: false; reason: 'no_pending_email' | 'rate_limited' | 'send_failed'; retryAfterMs?: number };

function appBaseUrl(): string {
  const fromEnv = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (fromEnv) return fromEnv.replace(/\/+$/, '');
  return 'http://localhost:3000';
}

// Best-effort: mints a verification token for the user's current
// pendingEmail and sends the confirm-link email. Never throws — returns
// a discriminated union so the caller can decide whether to surface the
// failure. Used by both:
//   - POST /api/account/email/verify/send (explicit resend)
//   - PATCH /api/account/reminders (auto-trigger on pendingEmail change)
export async function sendVerificationEmail(
  userId: string,
): Promise<SendVerificationEmailResult> {
  const [row] = await db
    .select({ pendingEmail: users.pendingEmail })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!row?.pendingEmail) {
    return { ok: false, reason: 'no_pending_email' };
  }

  const tokenResult = await createVerificationToken(userId, row.pendingEmail);
  if (!tokenResult.ok) {
    return { ok: false, reason: 'rate_limited', retryAfterMs: tokenResult.retryAfterMs };
  }

  const verifyUrl = `${appBaseUrl()}/verify-email?token=${tokenResult.token}`;
  const template = buildVerifyEmailTemplate({ verifyUrl });

  const sendResult = await sendEmail({
    to: row.pendingEmail,
    subject: template.subject,
    html: template.html,
    text: template.text,
  });

  if (!sendResult.ok) {
    return { ok: false, reason: 'send_failed' };
  }

  return { ok: true };
}
