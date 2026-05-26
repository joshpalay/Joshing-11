import { contextForPlayer } from '../lib/browser';
import { authenticateAndCookie, createTestGame, insertTestQuestions, phoneFor, provisionTestUser } from '../lib/seed';
import { playGame, type PlayerEvent } from '../lib/player';
import type { Scenario, ScenarioContext, ScenarioLog } from '../lib/scenario-context';
import { AssertionRecorder } from '../lib/asserts';

async function run(ctx: ScenarioContext): Promise<ScenarioLog> {
  const startedAt = Date.now();
  const asserts = new AssertionRecorder();
  const events: PlayerEvent[] = [];

  try {
    // Seed inviter + N players, plus N pre-authored questions and the game.
    const inviter = await provisionTestUser({
      phone: phoneFor(0),
      displayName: '[TEST] Inviter',
      scenarioId: ctx.scenarioId,
      manifest: ctx.manifest,
    });

    const players: Array<{ id: string; phone: string; displayName: string; sessionCookie: string }> = [];
    for (let i = 1; i <= ctx.args.players; i += 1) {
      const phone = phoneFor(i);
      const displayName = `[TEST] Player ${i}`;
      const user = await provisionTestUser({ phone, displayName, scenarioId: ctx.scenarioId, manifest: ctx.manifest });
      const cookie = await authenticateAndCookie(ctx.baseUrl, phone);
      players.push({ id: user.id, phone, displayName, sessionCookie: cookie.value });
    }

    const questionIds = await insertTestQuestions({
      creatorId: inviter.id,
      count: ctx.args.questions,
      scenarioId: ctx.scenarioId,
      manifest: ctx.manifest,
    });

    const gameId = await createTestGame({
      title: '[TEST] Automated Playtest',
      creatorId: inviter.id,
      recipientIds: players.map((p) => p.id),
      questionIds,
      scenarioId: ctx.scenarioId,
      manifest: ctx.manifest,
    });
    ctx.manifest.putScenarioData(ctx.scenarioId, 'gameId', gameId);
    asserts.pass('seeded game and players');

    // Each player plays sequentially (pool is capped at 5).
    for (const player of players) {
      console.log(`[playtest/play-game]   ${player.displayName}`);
      const browserCtx = await contextForPlayer(ctx.browser, ctx.baseUrl, player.sessionCookie);
      try {
        const log = await playGame({
          context: browserCtx,
          baseUrl: ctx.baseUrl,
          runId: ctx.runId,
          gameId,
          playerId: player.id,
          displayName: player.displayName,
          correctnessRate: ctx.args.correctnessRate,
        });
        events.push(...log.events);
        const anyAnswers = log.events.some((e) => e.kind === 'answer_submitted');
        asserts.check(
          `${player.displayName} submitted at least one answer`,
          anyAnswers,
          'no answer_submitted event recorded',
        );
      } finally {
        await browserCtx.close();
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    asserts.fail('play-game scenario threw', message);
  }

  const failed = asserts.hasFailures();
  return {
    scenarioId: ctx.scenarioId,
    displayName: 'Play a Joshing game (multi-player)',
    status: failed ? 'fail' : 'pass',
    durationMs: Date.now() - startedAt,
    events,
    assertions: asserts.results,
  };
}

export const playGameScenario: Scenario = {
  id: 'play-game',
  displayName: 'Play a Joshing game (multi-player)',
  description: 'Seeds N players and a game; each plays in their own browser context.',
  run,
};
