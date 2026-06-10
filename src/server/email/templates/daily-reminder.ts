export type DailyReminderTemplateParams = {
  dailyUrl: string;
  /**
   * A no-spoiler teaser drawn from the user's freshly built queue: the first
   * slot's question_text (+ optional domain label). Safe to show because a
   * newly built slot carries no reveal_canonical_answer yet. When absent (empty
   * or short queue), the email gracefully falls back to the generic nudge.
   */
  teaser?: { questionText: string; domain?: string | null } | null;
};

// The daily "your five for today" nudge, sent from the daily-assignments cron
// to opted-in + verified users right after the 17:00 UTC reset. Mirrors the SMS
// copy ("Your five for today") and the Ink-on-Cream styling of verify-email.ts,
// and previews today's first question to make the open worth it.
export function buildDailyReminderTemplate(params: DailyReminderTemplateParams): {
  subject: string;
  html: string;
  text: string;
} {
  const { dailyUrl, teaser } = params;

  const teaserText = teaser?.questionText?.trim() || null;
  const teaserDomain = teaser?.domain?.trim() || null;

  const subject = teaserText
    ? `Today’s five: ${truncate(teaserText, 60)}`
    : 'Your five for today';

  const text = [
    'Your five for today are ready.',
    '',
    teaserText
      ? `First up${teaserDomain ? ` (${teaserDomain})` : ''}: ${teaserText}`
      : 'Five fresh questions, picked for what you know and what you’re curious about.',
    '',
    `Play today’s five: ${dailyUrl}`,
    '',
    'You can turn these reminders off any time from your profile settings.',
  ].join('\n');

  const teaserBlock = teaserText
    ? `<tr>
              <td style="padding-bottom:24px;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f7f5f0;border:1px solid #e5e1d8;border-radius:10px;padding:18px 20px;">
                  ${
                    teaserDomain
                      ? `<tr><td style="font-size:11px;letter-spacing:0.06em;text-transform:uppercase;color:#8a857b;padding-bottom:8px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">First up · ${escapeHtml(teaserDomain)}</td></tr>`
                      : `<tr><td style="font-size:11px;letter-spacing:0.06em;text-transform:uppercase;color:#8a857b;padding-bottom:8px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">First up</td></tr>`
                  }
                  <tr><td style="font-size:17px;line-height:1.5;color:#1f1d1a;">${escapeHtml(teaserText)}</td></tr>
                </table>
              </td>
            </tr>`
    : `<tr>
              <td style="font-size:15px;line-height:1.55;padding-bottom:24px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
                Five fresh questions are waiting — picked for what you know and what you’re curious about.
              </td>
            </tr>`;

  const html = `<!doctype html>
<html lang="en">
  <body style="margin:0;padding:0;background:#f7f5f0;font-family:Georgia,'Times New Roman',serif;color:#1f1d1a;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f7f5f0;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:520px;background:#ffffff;border:1px solid #e5e1d8;border-radius:12px;padding:32px;">
            <tr>
              <td style="font-size:24px;font-weight:700;padding-bottom:16px;">Your five for today</td>
            </tr>
            ${teaserBlock}
            <tr>
              <td align="left" style="padding-bottom:24px;">
                <a href="${dailyUrl}" style="display:inline-block;background:#111111;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:8px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:14px;font-weight:600;">
                  Play today’s five
                </a>
              </td>
            </tr>
            <tr>
              <td style="font-size:13px;color:#6b6760;line-height:1.55;padding-bottom:8px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
                Or paste this link into your browser:
              </td>
            </tr>
            <tr>
              <td style="font-size:12px;color:#6b6760;word-break:break-all;font-family:ui-monospace,Menlo,Consolas,monospace;padding-bottom:24px;">
                ${dailyUrl}
              </td>
            </tr>
            <tr>
              <td style="font-size:12px;color:#8a857b;line-height:1.55;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
                You can turn these reminders off any time from your profile settings.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  return { subject, html, text };
}

function truncate(value: string, max: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1).trimEnd()}…`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
