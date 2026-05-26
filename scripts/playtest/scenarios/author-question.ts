import path from 'node:path';

import { and, eq, like } from 'drizzle-orm';

import { db, questions } from '@/server/db';

import { AssertionRecorder } from '../lib/asserts';
import { contextForPlayer } from '../lib/browser';
import type { PlayerEvent } from '../lib/player';
import type { Scenario, ScenarioContext, ScenarioLog } from '../lib/scenario-context';
import { authenticateAndCookie, phoneFor, provisionTestUser } from '../lib/seed';

function now(): string {
  return new Date().toISOString();
}

const QUESTION_TEXT = '[TEST] What is the capital of France?';
const ANSWER_TEXT = 'Paris';

async function run(ctx: ScenarioContext): Promise<ScenarioLog> {
  const startedAt = Date.now();
  const asserts = new AssertionRecorder();
  const events: PlayerEvent[] = [];

  try {
    const alice = await provisionTestUser({
      phone: phoneFor(53),
      displayName: '[TEST] Alice (author)',
      scenarioId: ctx.scenarioId,
      manifest: ctx.manifest,
    });

    const cookie = await authenticateAndCookie(ctx.baseUrl, alice.phone);
    const browserCtx = await contextForPlayer(ctx.browser, ctx.baseUrl, cookie.value);

    try {
      const page = await browserCtx.newPage();
      await page.goto(`${ctx.baseUrl}/questions`, { waitUntil: 'domcontentloaded' });
      await page.waitForLoadState('networkidle').catch(() => undefined);
      events.push({ kind: 'navigated', url: page.url(), at: now() });

      const shot = path.join(ctx.screenshotDir, 'author-question--page.png');
      await page.screenshot({ path: shot, fullPage: false });
      events.push({ kind: 'screenshot', file: shot, note: 'questions page', at: now() });

      // Hit the create API via the authenticated browser context. The full
      // /questions UI has multiple steps including LLM-assisted answer
      // suggestion; driving it via the API still exercises auth, validation,
      // categorization, and DB writes.
      const response = await page.request.post(`${ctx.baseUrl}/api/questions`, {
        data: {
          text: QUESTION_TEXT,
          correctAnswer: ANSWER_TEXT,
          alternateAnswers: ['paris'],
          verified: true,
          critiqueIterations: 0,
        },
      });
      const bodyText = await response.text().catch(() => '');
      const body = (() => {
        try { return JSON.parse(bodyText) as { question?: { id: string }; error?: string; message?: string }; }
        catch { return null; }
      })();

      const status = response.status();
      const ok2xx = Math.floor(status / 100) === 2;
      if (!ok2xx) {
        // Surface the actual error body so the report tells us exactly
        // why the route refused. The most common rejection in this
        // environment is `category_too_generic` (422) — fires when
        // ANTHROPIC_API_KEY is unset and the deterministic fallback
        // can't find a hyper-specific subcategory from question text alone.
        asserts.fail(
          `POST /api/questions returns 2xx (got ${status})`,
          `body: ${bodyText.slice(0, 300)}`,
        );
        events.push({
          kind: 'error',
          message: `POST /api/questions returned ${status}: ${bodyText.slice(0, 300)}`,
          at: now(),
        });
      } else {
        asserts.pass(`POST /api/questions returns 2xx (got ${status})`);
        asserts.expectTruthy('response contains question.id', typeof body?.question?.id === 'string');
      }

      // DB-level: the row exists with the right creatorId.
      const [row] = await db
        .select({ id: questions.id, creatorId: questions.creatorId, source: questions.source })
        .from(questions)
        .where(and(eq(questions.creatorId, alice.id), like(questions.questionText, '[TEST]%')))
        .limit(1);
      asserts.expectTruthy('question row exists with creatorId=Alice', !!row);
      if (row) {
        ctx.manifest.trackQuestion({ id: row.id, creatorId: alice.id, scenarioId: ctx.scenarioId });
        asserts.expectEqual('question.source is authored', row.source, 'authored');
      }

      await page.close();
    } finally {
      await browserCtx.close();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    asserts.fail('author-question scenario threw', message);
    events.push({ kind: 'error', message, at: now() });
  }

  return {
    scenarioId: ctx.scenarioId,
    displayName: 'Author a new question',
    status: asserts.hasFailures() ? 'fail' : 'pass',
    durationMs: Date.now() - startedAt,
    events,
    assertions: asserts.results,
  };
}

export const authorQuestionScenario: Scenario = {
  id: 'author-question',
  displayName: 'Author a new question',
  description: 'A test user POSTs to /api/questions and the question row appears with source=authored.',
  run,
};
