import type { WeeklyDigestSection } from '@/server/notifications/friend-news-copy';

import {
  CARD,
  CREAM,
  INK,
  INK_FAINT,
  INK_SOFT,
  NAVY,
  RULE,
  SANS,
  SERIF,
  bannerRow,
  divider,
  escapeHtml,
  eyebrow,
  resolveTriangleImageUrl,
} from './brand';

export type WeeklyFriendsTemplateParams = {
  /** Where the button goes — the friends/activity surface. */
  activityUrl: string;
  /** Non-empty; the caller skips the send when there is nothing to say. */
  sections: WeeklyDigestSection[];
  /** Turns off ONLY the weekly note (settings), keeping the daily email. */
  settingsUrl: string;
  /** Signed one-click unsubscribe from all Joshing email. */
  unsubscribeUrl?: string | null;
};

const SUBJECT = 'Your week with friends on Joshing';
const PREHEADER = 'Who played your questions, and what’s waiting for you.';
const FOOTER_LINE = 'A once-a-week note, only when your friends were up to something.';

// The Sunday "your week with friends" note, sent by the weekly-friends cron to
// confirmed addresses. Same editorial register as the daily reminder — a quiet
// letter, not a dashboard — and it only goes out when there is real news.
export function buildWeeklyFriendsTemplate(params: WeeklyFriendsTemplateParams): {
  subject: string;
  html: string;
  text: string;
} {
  const sections = params.sections
    .map((section) => ({
      heading: section.heading,
      lines: section.lines.map((line) => line.trim()).filter(Boolean),
    }))
    .filter((section) => section.lines.length > 0);
  const unsubUrl = params.unsubscribeUrl?.trim() || null;

  return {
    subject: SUBJECT,
    text: buildText({ ...params, sections, unsubUrl }),
    html: buildHtml({ ...params, sections, unsubUrl }),
  };
}

type BuildParams = {
  activityUrl: string;
  settingsUrl: string;
  sections: WeeklyDigestSection[];
  unsubUrl: string | null;
};

function buildText({ activityUrl, settingsUrl, sections, unsubUrl }: BuildParams): string {
  const lines: string[] = ['Joshing', '', 'Your week with friends', ''];
  for (const section of sections) {
    lines.push(section.heading.toUpperCase());
    for (const line of section.lines) lines.push(line);
    lines.push('');
  }
  lines.push(
    `See it all: ${activityUrl}`,
    '',
    FOOTER_LINE,
    `Only want the daily note? Turn this one off: ${settingsUrl}`,
  );
  if (unsubUrl) lines.push(`Stop all Joshing email: ${unsubUrl}`);
  return lines.join('\n');
}

function buildHtml({ activityUrl, settingsUrl, sections, unsubUrl }: BuildParams): string {
  const triangleImageUrl = resolveTriangleImageUrl(activityUrl);

  const body = sections
    .map(
      (section, index) => `${index > 0 ? divider() : ''}
                  ${eyebrow(section.heading)}
                  ${section.lines
                    .map(
                      (line) =>
                        `<tr><td style="font-family:${SERIF};font-size:17px;line-height:1.6;color:${INK};padding-bottom:6px;">${escapeHtml(line)}</td></tr>`,
                    )
                    .join('')}`,
    )
    .join('');

  return `<!doctype html>
<html lang="en">
  <body style="margin:0;padding:0;background:${CREAM};font-family:${SERIF};color:${INK};">
    <span style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;visibility:hidden;">${PREHEADER}</span>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:${CREAM};padding:40px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:480px;background:${CARD};border:1px solid ${RULE};border-radius:12px;">
            ${bannerRow(triangleImageUrl)}
            <tr>
              <td style="padding:32px;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                  <tr>
                    <td style="font-family:${SANS};font-size:13px;letter-spacing:0.04em;color:${INK_SOFT};padding-bottom:20px;">Joshing</td>
                  </tr>
                  <tr>
                    <td style="font-family:${SERIF};font-size:30px;line-height:1.25;font-weight:700;color:${INK};padding-bottom:26px;">Your week with friends</td>
                  </tr>
                  ${body}
                  ${divider()}
                  <tr>
                    <td style="padding-bottom:28px;">
                      <a href="${activityUrl}" style="display:inline-block;background:${NAVY};color:#ffffff;text-decoration:none;padding:13px 24px;border-radius:4px;font-family:${SANS};font-size:15px;font-weight:700;letter-spacing:0.04em;">See it all</a>
                    </td>
                  </tr>
                  <tr>
                    <td style="font-family:${SERIF};font-size:14px;line-height:1.6;color:${INK_SOFT};padding-bottom:10px;">${FOOTER_LINE}</td>
                  </tr>
                  <tr>
                    <td style="font-family:${SANS};font-size:12px;line-height:1.55;color:${INK_FAINT};">Only want the daily note? <a href="${settingsUrl}" style="color:${INK_FAINT};text-decoration:underline;">Turn this one off</a>${
                      unsubUrl
                        ? ` — or <a href="${unsubUrl}" style="color:${INK_FAINT};text-decoration:underline;">stop all Joshing email</a>.`
                        : '.'
                    }</td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}
