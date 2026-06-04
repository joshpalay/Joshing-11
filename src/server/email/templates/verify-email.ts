export type VerifyEmailTemplateParams = {
  verifyUrl: string;
};

export function buildVerifyEmailTemplate(params: VerifyEmailTemplateParams): {
  subject: string;
  html: string;
  text: string;
} {
  const { verifyUrl } = params;

  const subject = 'Confirm your email for Joshing reminders';

  const text = [
    'Confirm your email for Joshing',
    '',
    'Tap the link below to confirm this address. The link expires in 24 hours.',
    '',
    verifyUrl,
    '',
    "If you didn't ask to receive Joshing reminders at this address, you can ignore this email.",
  ].join('\n');

  const html = `<!doctype html>
<html lang="en">
  <body style="margin:0;padding:0;background:#f7f5f0;font-family:Georgia,'Times New Roman',serif;color:#1f1d1a;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f7f5f0;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:520px;background:#ffffff;border:1px solid #e5e1d8;border-radius:12px;padding:32px;">
            <tr>
              <td style="font-size:24px;font-weight:700;padding-bottom:16px;">Confirm your email</td>
            </tr>
            <tr>
              <td style="font-size:15px;line-height:1.55;padding-bottom:24px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
                Tap the button below to confirm this address so we can send you Joshing reminders. The link expires in 24 hours.
              </td>
            </tr>
            <tr>
              <td align="left" style="padding-bottom:24px;">
                <a href="${verifyUrl}" style="display:inline-block;background:#111111;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:8px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:14px;font-weight:600;">
                  Confirm email
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
                ${verifyUrl}
              </td>
            </tr>
            <tr>
              <td style="font-size:12px;color:#8a857b;line-height:1.55;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
                If you didn't ask to receive Joshing reminders at this address, you can safely ignore this email.
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
