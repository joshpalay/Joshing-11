import { NextRequest, NextResponse } from 'next/server';

import { isCronAuthorized } from '@/server/auth/cron';
import { getFriendNews } from '@/server/db/queries/friend-news';
import {
  claimWeeklyDigest,
  getWeeklyDigestRecipients,
  releaseWeeklyDigest,
} from '@/server/db/queries/weekly-digest';
import { sendEmail } from '@/server/email/client';
import { buildWeeklyFriendsTemplate } from '@/server/email/templates/weekly-friends';
import { createUnsubscribeToken } from '@/server/email/unsubscribe-token';
import { runWithConcurrency } from '@/server/lib/concurrency';
import { weeklyDigestSections } from '@/server/notifications/friend-news-copy';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// One below the 5-connection DB pool cap (see src/server/db/index.ts).
const USER_CONCURRENCY = 4;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function getBaseUrl(request: NextRequest): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_URL;
  if (configured) return configured.replace(/\/$/, '');
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
  const protocol = request.headers.get('x-forwarded-proto') ?? 'https';
  return host ? `${protocol}://${host}` : 'http://localhost:3000';
}

// The Sunday "your week with friends" email (notifications option C). Scheduled
// weekly in vercel.json. For each confirmed, not-unsubscribed address with the
// weekly switch on: gather the week's friend news and send ONE calm email — or
// nothing at all when there's no news. A quiet week sends nothing and does not
// claim, so it never burns a slot. Replay-safe via claimWeeklyDigest.
export async function GET(request: NextRequest) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const now = new Date();
  const baseUrl = getBaseUrl(request);
  const recipients = await getWeeklyDigestRecipients(now);
  const results = { recipients: recipients.length, sent: 0, quiet: 0, failed: 0 };

  await runWithConcurrency(recipients, USER_CONCURRENCY, async (recipient) => {
    try {
      // Cover the week, but never re-tell what last week's email already said.
      const weekAgo = new Date(now.getTime() - WEEK_MS);
      const since =
        recipient.weeklyDigestSentAt && recipient.weeklyDigestSentAt > weekAgo
          ? recipient.weeklyDigestSentAt
          : weekAgo;
      const sections = weeklyDigestSections(await getFriendNews(recipient.id, since));
      if (sections.length === 0) {
        results.quiet += 1;
        return;
      }

      if (!(await claimWeeklyDigest(recipient.id, recipient.weeklyDigestSentAt, now))) return;

      const unsubToken = createUnsubscribeToken(recipient.id);
      const template = buildWeeklyFriendsTemplate({
        activityUrl: `${baseUrl}/activities`,
        settingsUrl: `${baseUrl}/users/me#notifications`,
        sections,
        unsubscribeUrl: `${baseUrl}/unsubscribe?token=${unsubToken}`,
      });
      const emailResult = await sendEmail({
        to: recipient.email,
        subject: template.subject,
        html: template.html,
        text: template.text,
        headers: {
          'List-Unsubscribe': `<${baseUrl}/api/email/unsubscribe?token=${unsubToken}>`,
          'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
        },
      });
      if (emailResult.ok) {
        results.sent += 1;
      } else {
        await releaseWeeklyDigest(recipient.id, recipient.weeklyDigestSentAt);
        results.failed += 1;
        console.warn('[cron/weekly-friends] send failed', {
          userId: recipient.id,
          reason: emailResult.reason,
        });
      }
    } catch (error) {
      results.failed += 1;
      console.error('[cron/weekly-friends] user failed', {
        userId: recipient.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  console.info('[cron/weekly-friends] run complete', results);
  return NextResponse.json(results);
}
