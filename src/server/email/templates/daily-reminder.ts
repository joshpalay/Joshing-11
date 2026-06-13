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
};

// Ink-on-Cream palette (mirrors verify-email.ts and the in-app design system).
const CREAM = '#f7f5f0';
const INK = '#1f1d1a';
const INK_SOFT = '#6b6760';
const INK_FAINT = '#8a857b';
const RULE = '#e5e1d8';
const BUTTON = '#111111';

const SERIF = "Georgia,'Times New Roman',serif";
const SANS = "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";

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
  const { dailyUrl, interestsUrl, topics, activity, teaser } = params;

  const cleanTopics = topics.map((t) => t.trim()).filter(Boolean);
  const cleanActivity = (activity ?? []).map((a) => a.trim()).filter(Boolean).slice(0, 3);
  const teaserText = teaser?.questionText?.trim() || null;

  const subject = SUBJECTS[epochDay() % SUBJECTS.length];

  return {
    subject,
    text: buildText({ dailyUrl, interestsUrl, topics: cleanTopics, activity: cleanActivity, teaserText }),
    html: buildHtml({ dailyUrl, interestsUrl, topics: cleanTopics, activity: cleanActivity, teaserText }),
  };
}

function buildText(params: {
  dailyUrl: string;
  interestsUrl: string;
  topics: string[];
  activity: string[];
  teaserText: string | null;
}): string {
  const { dailyUrl, interestsUrl, topics, activity, teaserText } = params;
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
    'You can turn these reminders off any time from your profile settings.',
  );

  return lines.join('\n');
}

function buildHtml(params: {
  dailyUrl: string;
  interestsUrl: string;
  topics: string[];
  activity: string[];
  teaserText: string | null;
}): string {
  const { dailyUrl, interestsUrl, topics, activity, teaserText } = params;

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
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:480px;background:${CREAM};">
            <tr>
              <td style="font-family:${SANS};font-size:13px;letter-spacing:0.04em;color:${INK_SOFT};padding-bottom:20px;">Joshing</td>
            </tr>
            <tr>
              <td style="font-family:${SERIF};font-size:30px;line-height:1.25;font-weight:700;padding-bottom:10px;">Your Daily Five</td>
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
                <a href="${interestsUrl}" style="font-family:${SANS};font-size:13px;color:${INK_SOFT};text-decoration:underline;">Not quite your mix? Update your interests →</a>
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
              <td style="font-family:${SANS};font-size:12px;line-height:1.55;color:${INK_FAINT};">You can turn these reminders off any time from your profile settings.</td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function ctaRow(dailyUrl: string): string {
  return `<tr>
              <td style="padding-bottom:28px;">
                <a href="${dailyUrl}" style="display:inline-block;background:${BUTTON};color:#ffffff;text-decoration:none;padding:13px 22px;border-radius:8px;font-family:${SANS};font-size:14px;font-weight:600;">Play today’s five</a>
              </td>
            </tr>`;
}

function divider(): string {
  return `<tr><td style="padding:24px 0;"><div style="height:1px;line-height:1px;font-size:0;background:${RULE};">&nbsp;</div></td></tr>`;
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
