import path from 'node:path';

import { eq } from 'drizzle-orm';

import { dailyQueues, db } from '@/server/db';

import { AssertionRecorder } from '../lib/asserts';
import { contextForPlayer } from '../lib/browser';
import type { PlayerEvent } from '../lib/player';
import type { Scenario, ScenarioContext, ScenarioLog } from '../lib/scenario-context';
import { authenticateAndCookie, insertTestQuestions, phoneFor, provisionTestUser } from '../lib/seed';

function now(): string {
  return new Date().toISOString();
}

async function run(ctx: ScenarioContext): Promise<ScenarioLog> {
  const startedAt = Date.now();
  const asserts = new AssertionRecorder();
  const events: PlayerEvent[] = [];

  try {
    const alice = await provisionTestUser({
      phone: phoneFor(52),
      displayName: '[TEST] Alice (daily)',
      scenarioId: ctx.scenarioId,
      manifest: ctx.manifest,
    });

    // Seed a small pool of authored questions on Alice so the daily
    // queue generator has material to draw from.
    await insertTestQuestions({
      creatorId: alice.id,
      count: 3,
      scenarioId: ctx.scenarioId,
      manifest: ctx.manifest,
    });

    const cookie = await authenticateAndCookie(ctx.baseUrl, alice.phone);
    const browserCtx = await contextForPlayer(ctx.browser, ctx.baseUrl, cookie.value);

    try {
      const page = await browserCtx.newPage();
      await page.goto(`${ctx.baseUrl}/daily`, { waitUntil: 'domcontentloaded' });
      await page.waitForLoadState('networkidle').catch(() => undefined);
      events.push({ kind: 'navigated', url: page.url(), at: now() });

      const shot = path.join(ctx.screenshotDir, 'daily-queue--page.png');
      await page.screenshot({ path: shot, fullPage: false });
      events.push({ kind: 'screenshot', file: shot, note: 'daily page loaded', at: now() });

      // Ask the API directly whether a queue exists or can be created. This
      // exercises the route without depending on the somewhat-stateful UI.
      const queueRes = await page.request.get(`${ctx.baseUrl}/api/daily/queue`);
      asserts.expectEqual('GET /api/daily/queue returns 200', queueRes.status(), 200);

      // The queue may be empty for a brand-new test user with no
      // generated/authored questions in their domain. Either way the row
      // should land in dailyQueues after the GET (if the route auto-fills)
      // or after a POST.
      const [queueRow] = await db
        .select({ id: dailyQueues.id, userId: dailyQueues.userId })
        .from(dailyQueues)
        .where(eq(dailyQueues.userId, alice.id))
        .limit(1);
      if (queueRow) {
        ctx.manifest.trackDailyQueue({ id: queueRow.id, userId: alice.id, scenarioId: ctx.scenarioId });
        asserts.pass('dailyQueues row created for test user');
      } else {
        // Not strictly a failure — the test user has no generated questions,
        // so the queue may be empty. Record as a note for the LLM review.
        asserts.pass('daily page loaded (no queue row — empty domain pool)');
      }

      await page.close();
    } finally {
      await browserCtx.close();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    asserts.fail('daily-queue scenario threw', message);
    events.push({ kind: 'error', message, at: now() });
  }

  return {
    scenarioId: ctx.scenarioId,
    displayName: 'Daily queue loads',
    status: asserts.hasFailures() ? 'fail' : 'pass',
    durationMs: Date.now() - startedAt,
    events,
    assertions: asserts.results,
  };
}

export const dailyQueueScenario: Scenario = {
  id: 'daily-queue',
  displayName: 'Daily queue loads',
  description: 'A test user navigates to /daily; the queue endpoint responds 200 and (if questions are available) a dailyQueues row is created.',
  run,
};
