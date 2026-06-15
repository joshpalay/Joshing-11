export type DailyReminderTemplateParams = {
  /** Daily Five route — the primary "Play today's five" action. */
  dailyUrl: string;
  /** Daily Five setup route — the quiet "Update your interests" secondary link. */
  interestsUrl: string;
  /**
   * Today's five topic/domain labels, already de-duplicated and ordered (see
   * topicsForReminder). Rendered as plain editorial lines under TODAY. Empty →
   * the template falls back to a single "Today's five are ready." line.
   */
  topics: string[];
  /**
   * Up to three quiet, people-first activity sentences (see formatActivityForEmail).
   * When empty/absent the MEANWHILE section is omitted entirely — no placeholder.
   */
  activity?: string[] | null;
  /**
   * Optional no-spoiler teaser for the small "A glimpse" section: the first
   * slot's question_text (+ optional domain). Safe to show because a freshly
   * built slot carries no reveal yet. Absent → the section is omitted.
   */
  teaser?: { questionText: string; domain?: string | null } | null;
  /**
   * Signed, session-less unsubscribe URL (see unsubscribe-token.ts). Rendered
   * as the footer one-click opt-out and mirrored into the List-Unsubscribe
   * header by the caller. Falls back to "turn off in profile settings" copy
   * when absent (e.g. a preview send without a real recipient).
   */
  unsubscribeUrl?: string | null;
};

// Brand palette — mirrors the design-system tokens in src/app/globals.css.
// Email HTML can't read CSS custom properties (no :root in mail clients), so
// the token values are inlined here. Keep these in lockstep with globals.css:
//   CREAM      → --brand-cream-page (#fcf8f2)   app page surface
//   CARD       → --brand-card       (#fdfcfb)   content card surface
//   INK        → --brand-ink        (#0a1f3d)   primary text / headings (navy)
//   INK_SOFT   → --brand-ink-700    (#3a4a5f)   secondary text
//   INK_FAINT  → --brand-ink-400    (#8a8a8a)   muted / fine print
//   RULE       → --brand-border     (#e9e2d2)   warm hairline border/divider
//   NAVY       → --brand-navy       (#1f3a5a)   primary button (== --btn-primary-bg)
//   ORANGE     → --brand-orange     (#d15e36)   accent links
const CREAM = '#fcf8f2';
const CARD = '#fdfcfb';
const INK = '#0a1f3d';
const INK_SOFT = '#3a4a5f';
const INK_FAINT = '#8a8a8a';
const RULE = '#e9e2d2';
const NAVY = '#1f3a5a';
const ORANGE = '#d15e36';

const SERIF = "Georgia,'Times New Roman',serif";
const SANS = "'Montserrat',-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";

// The brand triangle motif (public/images/Variant4.png) is a tileable pattern;
// rendered as a repeating banner band atop the card, it echoes the login
// screens' TriangleBackground without relying on a full-bleed cover crop.
const TRIANGLE_IMAGE_PATH = '/images/Variant4.png';

// Rotated daily so a recipient doesn't read the same subject line every morning,
// but deterministic on the UTC date so a single send (the cron may replay) is
// stable. Drops the old question-in-subject behavior.
const SUBJECTS = [
  'Your Daily Five is ready',
  'Today’s five are waiting',
  'Five questions for today',
  'Your Daily Five',
] as const;

const PREHEADER = 'Five questions from the knowledge you share.';
const FOOTER_LINE = 'Joshing is about the knowledge that connects people.';

// The daily "Your Daily Five" nudge, sent from the daily-assignments cron to
// opted-in + verified users right after the 17:00 UTC reset. A quiet editorial
// note — typography-led, no large question card — not a marketing newsletter.
export function buildDailyReminderTemplate(params: DailyReminderTemplateParams): {
  subject: string;
  html: string;
  text: string;
} {
  const { dailyUrl, interestsUrl, topics, activity, teaser, unsubscribeUrl } = params;
  const unsubUrl = unsubscribeUrl?.trim() || null;

  const cleanTopics = topics.map((t) => t.trim()).filter(Boolean);
  const cleanActivity = (activity ?? []).map((a) => a.trim()).filter(Boolean).slice(0, 3);
  const teaserText = teaser?.questionText?.trim() || null;

  const subject = SUBJECTS[epochDay() % SUBJECTS.length];

  return {
    subject,
    text: buildText({ dailyUrl, interestsUrl, topics: cleanTopics, activity: cleanActivity, teaserText, unsubUrl }),
    html: buildHtml({ dailyUrl, interestsUrl, topics: cleanTopics, activity: cleanActivity, teaserText, unsubUrl }),
  };
}

function buildText(params: {
  dailyUrl: string;
  interestsUrl: string;
  topics: string[];
  activity: string[];
  teaserText: string | null;
  unsubUrl: string | null;
}): string {
  const { dailyUrl, interestsUrl, topics, activity, teaserText, unsubUrl } = params;
  const lines: string[] = [
    'Joshing',
    '',
    'Your Daily Five',
    'Five questions from the knowledge you share.',
    '',
    `Play today’s five: ${dailyUrl}`,
    '',
    'TODAY',
  ];

  if (topics.length > 0) {
    for (const topic of topics) lines.push(topic);
  } else {
    lines.push('Today’s five are ready.');
  }
  lines.push('', `Not quite your mix? Update your interests: ${interestsUrl}`);

  if (activity.length > 0) {
    lines.push('', 'MEANWHILE');
    for (const item of activity) lines.push(item);
  }

  if (teaserText) {
    lines.push('', 'A GLIMPSE', `“${truncate(teaserText, 100)}”`, 'One of today’s five.');
  }

  lines.push(
    '',
    `Play today’s five: ${dailyUrl}`,
    '',
    FOOTER_LINE,
    unsubUrl
      ? `Don’t want these? Unsubscribe: ${unsubUrl}`
      : 'You can turn these reminders off any time from your profile settings.',
  );

  return lines.join('\n');
}

function buildHtml(params: {
  dailyUrl: string;
  interestsUrl: string;
  topics: string[];
  activity: string[];
  teaserText: string | null;
  unsubUrl: string | null;
}): string {
  const { dailyUrl, interestsUrl, topics, activity, teaserText, unsubUrl } = params;

  const triangleImageUrl = resolveTriangleImageUrl(dailyUrl);

  const topicsBlock =
    topics.length > 0
      ? topics
          .map(
            (topic) =>
              `<tr><td style="font-family:${SERIF};font-size:19px;line-height:1.7;color:${INK};">${escapeHtml(topic)}</td></tr>`,
          )
          .join('')
      : `<tr><td style="font-family:${SERIF};font-size:19px;line-height:1.7;color:${INK};">Today’s five are ready.</td></tr>`;

  const meanwhileSection =
    activity.length > 0
      ? `${divider()}
            ${eyebrow('Meanwhile')}
            ${activity
              .map(
                (item) =>
                  `<tr><td style="font-family:${SERIF};font-size:16px;line-height:1.6;color:${INK};padding-bottom:6px;">${escapeHtml(item)}</td></tr>`,
              )
              .join('')}`
      : '';

  const glimpseSection = teaserText
    ? `${divider()}
            ${eyebrow('A glimpse')}
            <tr><td style="font-family:${SERIF};font-size:18px;line-height:1.6;color:${INK};font-style:italic;padding-bottom:6px;">“${escapeHtml(truncate(teaserText, 100))}”</td></tr>
            <tr><td style="font-family:${SANS};font-size:12px;color:${INK_FAINT};">One of today’s five.</td></tr>`
    : '';

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
                    <td style="font-family:${SERIF};font-size:30px;line-height:1.25;font-weight:700;color:${INK};padding-bottom:10px;">Your Daily Five</td>
                  </tr>
                  <tr>
                    <td style="font-family:${SERIF};font-size:17px;line-height:1.5;color:${INK_SOFT};padding-bottom:26px;">Five questions from the knowledge you share.</td>
                  </tr>
                  ${ctaRow(dailyUrl)}
                  ${divider()}
                  ${eyebrow('Today')}
                  ${topicsBlock}
                  <tr>
                    <td style="padding-top:16px;">
                      <a href="${interestsUrl}" style="font-family:${SANS};font-size:13px;font-weight:600;letter-spacing:0.02em;color:${ORANGE};text-decoration:underline;">Not quite your mix? Update your interests →</a>
                    </td>
                  </tr>
                  ${meanwhileSection}
                  ${glimpseSection}
                  ${divider()}
                  ${ctaRow(dailyUrl)}
                  <tr>
                    <td style="font-family:${SERIF};font-size:14px;line-height:1.6;color:${INK_SOFT};padding-top:8px;padding-bottom:10px;">${FOOTER_LINE}</td>
                  </tr>
                  <tr>
                    <td style="font-family:${SANS};font-size:12px;line-height:1.55;color:${INK_FAINT};">${
                      unsubUrl
                        ? `Don’t want these emails? <a href="${unsubUrl}" style="color:${INK_FAINT};text-decoration:underline;">Unsubscribe</a> — or manage reminders in your profile settings.`
                        : 'You can turn these reminders off any time from your profile settings.'
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

// Mirrors the login screens' primary button (SUBMIT_CLASS in LoginPanel.tsx):
// brand-navy fill, 4px radius, bold, 0.04em tracking, white label.
function ctaRow(dailyUrl: string): string {
  return `<tr>
              <td style="padding-bottom:28px;">
                <a href="${dailyUrl}" style="display:inline-block;background:${NAVY};color:#ffffff;text-decoration:none;padding:13px 24px;border-radius:4px;font-family:${SANS};font-size:15px;font-weight:700;letter-spacing:0.04em;">Play today’s five</a>
              </td>
            </tr>`;
}

// The triangle-motif header band. The artwork is tileable, so a repeating
// background on a fixed-height cell reads as a clean strip across the card top.
// Clients that drop background images (notably Outlook desktop) fall back to a
// solid brand-navy band — still on-brand. Omitted when no absolute URL resolves.
function bannerRow(imageUrl: string | null): string {
  if (!imageUrl) return '';
  return `<tr>
              <td height="96" style="height:96px;background-color:${NAVY};background-image:url('${imageUrl}');background-repeat:repeat;background-position:center top;border-radius:12px 12px 0 0;font-size:0;line-height:0;mso-line-height-rule:exactly;" aria-hidden="true">&nbsp;</td>
            </tr>`;
}

function divider(): string {
  return `<tr><td style="padding:24px 0;"><div style="height:1px;line-height:1px;font-size:0;background:${RULE};">&nbsp;</div></td></tr>`;
}

// Build an absolute URL for the triangle artwork from the (absolute) dailyUrl's
// origin. Email clients require absolute asset URLs; if dailyUrl isn't a valid
// absolute URL the banner is skipped rather than emitting a broken image.
function resolveTriangleImageUrl(dailyUrl: string): string | null {
  try {
    return new URL(TRIANGLE_IMAGE_PATH, dailyUrl).toString();
  } catch {
    return null;
  }
}

function eyebrow(label: string): string {
  return `<tr><td style="font-family:${SANS};font-size:11px;letter-spacing:0.14em;text-transform:uppercase;color:${INK_FAINT};padding-bottom:14px;">${escapeHtml(label)}</td></tr>`;
}

// UTC epoch-day index — stable within a calendar day, increments daily, so the
// subject rotation is deterministic per send but varies morning to morning.
function epochDay(): number {
  return Math.floor(Date.now() / 86_400_000);
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
