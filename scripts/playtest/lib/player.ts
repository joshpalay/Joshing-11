import path from 'node:path';

import type { BrowserContext, ConsoleMessage, Page, Request, Response } from 'playwright';

import { canonicalAnswerFor } from './seed';
import { screenshotDir } from './manifest';

export type PlayerEvent =
  | { kind: 'navigated'; url: string; at: string }
  | { kind: 'question_seen'; index: number; text: string; at: string }
  | { kind: 'answer_submitted'; index: number; text: string; intent: 'correct' | 'wrong'; at: string }
  | { kind: 'result_observed'; index: number; correct: boolean; pointsAwarded: number | null; at: string }
  | { kind: 'console'; level: string; text: string; at: string }
  | { kind: 'network_error'; url: string; status: number | null; at: string }
  | { kind: 'screenshot'; file: string; note: string; at: string }
  | { kind: 'finished'; at: string }
  | { kind: 'error'; message: string; at: string };

export type PlayerLog = {
  playerId: string;
  displayName: string;
  events: PlayerEvent[];
};

function now(): string {
  return new Date().toISOString();
}

async function snap(page: Page, runId: string, label: string, log: PlayerLog): Promise<void> {
  const safe = label.replace(/[^a-z0-9_-]/gi, '-');
  const fileName = `${log.displayName.replace(/[^a-z0-9]/gi, '-')}--${safe}.png`;
  const file = path.join(screenshotDir(runId), fileName);
  await page.screenshot({ path: file, fullPage: false });
  log.events.push({ kind: 'screenshot', file, note: label, at: now() });
}

function wrongAnswerFor(canonical: string): string {
  return `definitely-not-${canonical.toLowerCase()}-${Math.floor(Math.random() * 1000)}`;
}

function pickIntent(rate: number): 'correct' | 'wrong' {
  return Math.random() < rate ? 'correct' : 'wrong';
}

async function readCurrentQuestionText(page: Page): Promise<string> {
  // Our seeded questions all start with "[TEST]"; pick the last such bubble on the page.
  // Fallback to the last visible <p> inside the chat thread.
  const testNodes = page.locator('p', { hasText: '[TEST]' });
  if ((await testNodes.count()) > 0) {
    return ((await testNodes.last().innerText().catch(() => '')) ?? '').trim();
  }
  return ((await page.locator('main p').last().innerText().catch(() => '')) ?? '').trim();
}

export async function playGame(params: {
  context: BrowserContext;
  baseUrl: string;
  runId: string;
  gameId: string;
  playerId: string;
  displayName: string;
  correctnessRate: number;
}): Promise<PlayerLog> {
  const log: PlayerLog = { playerId: params.playerId, displayName: params.displayName, events: [] };
  const page = await params.context.newPage();

  page.on('console', (msg: ConsoleMessage) => {
    const level = msg.type();
    if (level === 'log' || level === 'debug') return;
    log.events.push({ kind: 'console', level, text: msg.text(), at: now() });
  });
  page.on('requestfailed', (req: Request) => {
    log.events.push({ kind: 'network_error', url: req.url(), status: null, at: now() });
  });
  page.on('response', (response: Response) => {
    const status = response.status();
    if (status >= 500) {
      log.events.push({ kind: 'network_error', url: response.url(), status, at: now() });
    }
  });

  const url = `${params.baseUrl}/games/${params.gameId}`;
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle').catch(() => undefined);
  log.events.push({ kind: 'navigated', url: page.url(), at: now() });
  await snap(page, params.runId, 'arrived', log);

  // The first answer input must mount within a few seconds. If it doesn't,
  // something is broken upstream (commonly: Next.js dev server ChunkLoadError
  // on stale .next/, an unauthenticated session that landed on /login, or a
  // proxy redirect loop). Surface it loudly — without this guard, the loop
  // below would exit with zero iterations and the run would falsely report
  // success.
  const inputLocator = page.locator('input[placeholder="Your answer..."]');
  try {
    await inputLocator.first().waitFor({ state: 'visible', timeout: 10_000 });
  } catch {
    const overlay = await page.locator('[data-nextjs-dialog], #nextjs__container_errors_label').first().innerText().catch(() => '');
    const trimmedOverlay = overlay.trim();
    const detail = trimmedOverlay
      ? ` Next.js error overlay: ${trimmedOverlay.slice(0, 200)}`
      : ` URL ended at ${page.url()}.`;
    throw new Error(
      `[playtest] answer input never appeared on /games/${params.gameId} for ${params.displayName}.` +
        `${detail} Check the dev server: rm .next, restart, and look for the ChunkLoadError.`,
    );
  }

  const answerUrlMatcher = `**/api/joshing-games/${params.gameId}/answer`;
  let index = 0;
  while (true) {
    if ((await inputLocator.count()) === 0) break;
    if (index >= 5) break;
    index += 1;

    const questionText = await readCurrentQuestionText(page);
    log.events.push({ kind: 'question_seen', index, text: questionText, at: now() });

    const intent = pickIntent(params.correctnessRate);
    const canonical = canonicalAnswerFor(questionText);
    const answer = intent === 'correct' && canonical
      ? canonical
      : wrongAnswerFor(canonical ?? 'unknown');

    const input = page.locator('input[placeholder="Your answer..."]');
    await input.fill(answer);
    await snap(page, params.runId, `q${index}-before-submit`, log);

    const responsePromise = page.waitForResponse(answerUrlMatcher, { timeout: 15_000 }).catch(() => null);
    // Press Enter rather than clicking [type="submit"]. The bottom <nav
    // aria-label="Primary navigation"> is fixed at the same bottom edge as
    // the sticky answer form and intercepts pointer events on the Send
    // button — that's a real mobile UX bug worth noting (see the LLM
    // review section of the report), and it would make the harness flaky
    // if we relied on the click.
    await input.press('Enter');
    log.events.push({ kind: 'answer_submitted', index, text: answer, intent, at: now() });

    const response = await responsePromise;
    let correct = false;
    let pointsAwarded: number | null = null;
    if (response) {
      const body = await response.json().catch(() => null) as { isCorrect?: boolean; pointsAwarded?: number } | null;
      if (body) {
        correct = body.isCorrect === true;
        pointsAwarded = typeof body.pointsAwarded === 'number' ? body.pointsAwarded : null;
      }
    } else {
      log.events.push({ kind: 'error', message: `no response to ${answerUrlMatcher} within 15s`, at: now() });
    }
    log.events.push({ kind: 'result_observed', index, correct, pointsAwarded, at: now() });

    // play-client.tsx pauses 850ms before revealing the next question.
    await page.waitForTimeout(1100);
    await snap(page, params.runId, `q${index}-after-result`, log);
  }

  // After the last answer the play client redirects to /summary; capture it.
  await page.waitForLoadState('networkidle').catch(() => undefined);
  await page.waitForTimeout(500);
  await snap(page, params.runId, 'summary', log);
  log.events.push({ kind: 'finished', at: now() });

  await page.close();
  return log;
}
