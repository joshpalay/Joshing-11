/**
 * Email sending utility using Resend.
 * Mirrors the env-guard / try-catch / log pattern from src/server/sms.ts:
 * never throws out of the helper, always returns ok/error so callers
 * can decide whether to surface the failure to the user.
 *
 * In dev (no RESEND_API_KEY), logs the message to stdout instead of
 * sending. EMAIL_FROM must be a sender verified in your Resend domain.
 */

export type SendEmailParams = {
  to: string;
  subject: string;
  html: string;
  text: string;
  // Optional extra SMTP headers, forwarded to Resend verbatim. Used to set
  // List-Unsubscribe / List-Unsubscribe-Post (RFC 8058 one-click) on bulk
  // reminder emails.
  headers?: Record<string, string>;
};

export type SendEmailResult =
  | { ok: true; id: string | null }
  | { ok: false; reason: 'missing_config' | 'provider_error'; message: string };

export async function sendEmail(params: SendEmailParams): Promise<SendEmailResult> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;

  if (!apiKey || !from) {
    console.warn(
      '[email] RESEND_API_KEY or EMAIL_FROM missing — falling back to console log:',
      { to: params.to, subject: params.subject },
    );
    console.log('[email][text]', params.text);
    return { ok: false, reason: 'missing_config', message: 'Email provider not configured.' };
  }

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: params.to,
        subject: params.subject,
        html: params.html,
        text: params.text,
        ...(params.headers ? { headers: params.headers } : {}),
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      console.error('[email] Resend error:', response.status, body);
      return {
        ok: false,
        reason: 'provider_error',
        message: `Resend returned ${response.status}`,
      };
    }

    const json = (await response.json().catch(() => null)) as { id?: string } | null;
    return { ok: true, id: json?.id ?? null };
  } catch (err) {
    console.error('[email] Network error sending email:', err);
    return {
      ok: false,
      reason: 'provider_error',
      message: err instanceof Error ? err.message : 'unknown error',
    };
  }
}
