import { eq } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';

import {
  claimDailyEmailReminder,
  getTodaysDailyQueue,
  releaseDailyEmailReminder,
} from '@/server/db/queries/daily';
import { db, users } from '@/server/db';
import { DailyQueueFillError, fillDailyQueueForUser } from '@/server/daily/queue-orchestrator';
import { type QueueSlot } from '@/server/daily/types';
import { runWithConcurrency } from '@/server/lib/concurrency';
import { isCronAuthorized } from '@/server/auth/cron';
import { sendSms } from '@/server/sms';
import { sendEmail } from '@/server/email/client';
import { buildDailyReminderTemplate } from '@/server/email/templates/daily-reminder';
import { formatActivityForEmail, topicsForReminder } from '@/server/email/daily-reminder-data';
import { getRecentActivityForHome } from '@/server/db/queries/activity';
import { createUnsubscribeToken } from '@/server/email/unsubscribe-token';

export const dynamic = 'force-dynamic';
// Scheduled NATIVELY by vercel.json (the GitHub-Actions cron workaround was
// retired in a72430b9 once the Vercel plan gained reliable crons; the earlier
// 2026-05-30 note about a single scheduler is historical). Runs in THREE idempotent
// passes — 17:05, 17:30, 18:00 UTC — all just after the 17:00 UTC daily reset
// (DAILY_RESET_HOUR_UTC) so the window users are about to play is pre-built. The
// first pass builds what it can within USER_BUDGET_MS; the later passes skip users
// whose queue already exists and mop up any `deferred`/failed tail (SMS/email are
// replay-safe — see the idempotency notes below). The previous single 06:00 UTC
// schedule built the window that expired at 17:00 UTC and left the 17:00→06:00 UTC
// span uncovered, forcing evening-US / APAC users onto the synchronous path.
//
// COVERAGE HISTORY (audit 2026-06-26, D-NARROW-KB-FABRICATION-01): a cold-boot DB
// connection timeout once hung migrate() for ~20 min (instrumentation boot),
// blowing this function's 300s maxDuration before most users were built. That is
// now bounded in instrumentation.ts (BOOT_MIGRATE_TIMEOUT_MS); the soft USER_BUDGET_MS
// deadline below + the catch-up passes cover the rest. Per-user generation is still
// expensive when the bank misses (live Sonnet per slot) — retrieval grounding
// (Lever B in the decision doc) is the structural fix for that.
//
// This fans out generation across every onboarded user at USER_CONCURRENCY,
// each costing up to GENERATION_TIMEOUT_MS, so the default function budget is
// far too small for a non-trivial user base — give it the plan maximum so the
// tail of the user list doesn't get dropped by a platform timeout mid-run.
export const maxDuration = 300;

// Capped at 4 to stay one connection below the 5-cap DB pool. Tune down if
// the SMS provider's per-second rate becomes the binding limit instead of DB.
const USER_CONCURRENCY = 4;

// Soft internal deadline, well under maxDuration (300s). When a run can't finish
// every user in time (per-user builds run ~1 min when the bank misses), stop
// STARTING new users at this mark and return a clean result JSON instead of being
// hard-killed mid-build with no report. The users left unbuilt are reported as
// `deferred` and picked up by the idempotent catch-up passes scheduled a few
// minutes later in vercel.json (the route already skips users whose queue exists,
// and SMS/email are replay-safe). See D-NARROW-KB-FABRICATION-01.
const USER_BUDGET_MS = Number(process.env.DAILY_ASSIGNMENTS_BUDGET_MS) > 0
  ? Number(process.env.DAILY_ASSIGNMENTS_BUDGET_MS)
  : 250_000;

function asQueueSlots(value: unknown): QueueSlot[] {
  return Array.isArray(value) ? (value as QueueSlot[]) : [];
}

function getBaseUrl(request: NextRequest): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_URL;
  if (configured) return configured.replace(/\/$/, '');
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
  const protocol = request.headers.get('x-forwarded-proto') ?? 'https';
  return host ? `${protocol}://${host}` : 'http://localhost:3000';
}

export async function GET(request: NextRequest) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const startedAt = Date.now();
  const baseUrl = getBaseUrl(request);
  const onboardedUsers = await db
    .select({
      id: users.id,
      phoneNumber: users.phoneNumber,
      smsOptIn: users.smsOptIn,
      email: users.email,
      emailOptIn: users.emailOptIn,
      emailVerified: users.emailVerified,
    })
    .from(users)
    .where(eq(users.onboardingComplete, true));

  const results = {
    users: onboardedUsers.length,
    generated: 0,
    existing: 0,
    failed: 0,
    // Breakdown of `failed` by cause so a non-zero count is self-explaining:
    //  - no_knowledge_base: benign — user hasn't declared interests yet, so
    //    there's nothing to generate from (they're routed to /knowledge, not 503).
    //  - generation: the real failure mode — generation came up short / errored.
    //  - other: an unexpected (non-DailyQueueFillError) exception.
    failedNoKnowledgeBase: 0,
    failedGeneration: 0,
    failedOther: 0,
    // Users not even attempted because the soft deadline was hit — a healthy,
    // expected outcome on a large user base, mopped up by the next catch-up pass.
    deferred: 0,
    smsSent: 0,
    emailSent: 0,
  };

  await runWithConcurrency(onboardedUsers, USER_CONCURRENCY, async (user) => {
    // Stop starting new users once the soft budget is spent so the function
    // returns its result JSON instead of being killed at maxDuration mid-build.
    if (Date.now() - startedAt > USER_BUDGET_MS) {
      results.deferred += 1;
      return;
    }
    try {
      let queue = await getTodaysDailyQueue(user.id);
      const existingSlots = queue ? asQueueSlots(queue.slots) : [];

      // Nudges below are gated on THIS invocation having built the queue.
      // The workflow curls this route with retries and a timeout equal to
      // maxDuration, so a client-side timeout (function still running) replays
      // the whole run; skipping users whose queue already exists makes the
      // route idempotent for SMS/email — a retry can never re-text someone the
      // previous attempt already nudged. Side effect (accepted): a user who
      // built their own queue between the 17:00 reset and this cron gets no
      // reminder — they're already playing today.
      let freshlyGenerated = false;
      if (!queue || existingSlots.length === 0) {
        // Background build: use the longer top-up budget this 300s cron route
        // allows, so a struggling build reaches DAILY_QUEUE_SIZE instead of
        // persisting the 4-slot short queue the 90s sync ceiling forces.
        await fillDailyQueueForUser(user.id, { background: true });
        queue = await getTodaysDailyQueue(user.id);
        results.generated += 1;
        freshlyGenerated = true;
      } else {
        results.existing += 1;
      }

      if (freshlyGenerated && queue && user.smsOptIn === 'opted_in' && user.phoneNumber) {
        await sendSms(
          user.phoneNumber,
          `Your five for today. ${baseUrl}/daily`,
          'daily_questions',
          user.id,
        );
        results.smsSent += 1;
      }

      // Email reminder — previews today's first question as a no-spoiler teaser.
      // Unlike SMS, this is NOT gated on freshlyGenerated: a user whose queue
      // already existed (self-generated before this drift-prone cron, or built
      // by an earlier run) should still get one nudge. The idempotency that the
      // freshly-generated gate used to provide is now an atomic per-queue claim
      // (claimDailyEmailReminder), so the workflow's retry-replay can't
      // double-send. Only fires when an unanswered slot remains, so a user who
      // already finished today is skipped. sendEmail never throws (returns a
      // discriminated union), so a provider failure counts as a skipped email.
      if (queue && user.emailOptIn === 'opted_in' && user.emailVerified && user.email) {
        const slots = asQueueSlots(queue.slots);
        const teaserSlot = slots.find(
          (slot) => !slot.answered && !slot.skipped && slot.question_text,
        );
        // Claim before send so concurrent retries race on the DB, not the
        // provider; a losing claim (already sent today) skips silently.
        if (teaserSlot && (await claimDailyEmailReminder(queue.id))) {
          // Quiet, people-first "Meanwhile" lines from the same home-eligible
          // activity Home surfaces; empty → the section is omitted downstream.
          const activity = formatActivityForEmail(await getRecentActivityForHome(user.id, 3));
          // Session-less unsubscribe: the footer link points at the friendly
          // /unsubscribe page; the List-Unsubscribe header at the RFC 8058
          // one-click POST endpoint. Both verify the same signed token. Gmail/
          // Yahoo bulk-sender rules expect this header on reminder mail.
          const unsubToken = createUnsubscribeToken(user.id);
          const unsubscribeUrl = `${baseUrl}/unsubscribe?token=${unsubToken}`;
          const oneClickUrl = `${baseUrl}/api/email/unsubscribe?token=${unsubToken}`;
          const template = buildDailyReminderTemplate({
            dailyUrl: `${baseUrl}/daily`,
            interestsUrl: `${baseUrl}/knowledge`,
            topics: topicsForReminder(slots),
            activity,
            teaser: { questionText: teaserSlot.question_text, domain: teaserSlot.domain },
            unsubscribeUrl,
          });
          const emailResult = await sendEmail({
            to: user.email,
            subject: template.subject,
            html: template.html,
            text: template.text,
            headers: {
              'List-Unsubscribe': `<${oneClickUrl}>`,
              'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
            },
          });
          if (emailResult.ok) {
            results.emailSent += 1;
          } else {
            // Send failed after we claimed — release so a later run can retry.
            await releaseDailyEmailReminder(queue.id);
            console.warn('[cron/daily-assignments] reminder email failed', {
              userId: user.id,
              reason: emailResult.reason,
            });
          }
        }
      }
    } catch (error) {
      results.failed += 1;

      if (error instanceof DailyQueueFillError) {
        if (error.code === 'no_knowledge_base') {
          results.failedNoKnowledgeBase += 1;
        } else {
          results.failedGeneration += 1;
        }
        // Was previously swallowed silently; log the reason so a non-zero
        // `failed` count is diagnosable from the logs as well as the response.
        console.warn('[cron/daily-assignments] user skipped', {
          userId: user.id,
          code: error.code,
        });
        return;
      }

      results.failedOther += 1;
      console.error('[cron/daily-assignments] user failed', {
        userId: user.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // Structured run summary so coverage/timeouts are diagnosable from logs alone
  // (the function may still be killed before the caller reads the JSON body).
  console.info('[cron/daily-assignments] run complete', {
    ...results,
    elapsed_ms: Date.now() - startedAt,
    budget_ms: USER_BUDGET_MS,
  });

  return NextResponse.json(results);
}
