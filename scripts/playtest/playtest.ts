import 'dotenv/config';

import { pool } from '@/server/db';

import { parsePlaytestArgs } from './lib/args';
import { launchBrowser, contextForPlayer } from './lib/browser';
import { wipeTestData } from './lib/cleanup';
import { reviewSession } from './lib/claude';
import { ensureRunDirs, newRunId, readManifest, runDir, writeManifest } from './lib/manifest';
import { playGame } from './lib/player';
import { preflight } from './lib/preflight';
import { writeReport } from './lib/report';
import { seed } from './lib/seed';

async function main(): Promise<void> {
  const args = parsePlaytestArgs(process.argv);
  preflight(args);

  if (args.clean) {
    const runId = args.runId;
    if (!runId) {
      throw new Error('[playtest] --clean requires --run-id=<id>');
    }
    const manifest = readManifest(runId);
    console.log(`[playtest] cleaning run ${runId}`);
    await wipeTestData(manifest);
    console.log(`[playtest] cleanup complete for ${runId}`);
    return;
  }

  const runId = args.runId ?? newRunId();
  ensureRunDirs(runId);
  console.log(`[playtest] starting run ${runId} (audits/playtest-${runId}/)`);
  console.log(`[playtest] seeding ${args.players} players, ${args.questions} questions against ${args.baseUrl}`);

  const manifest = await seed({
    runId,
    baseUrl: args.baseUrl,
    numPlayers: args.players,
    numQuestions: args.questions,
  });
  writeManifest(manifest);
  console.log(`[playtest] seeded game ${manifest.gameId}`);

  const browser = await launchBrowser(args.headed);
  try {
    const logs = [];
    for (const player of manifest.players) {
      console.log(`[playtest] playing as ${player.displayName}`);
      const context = await contextForPlayer(browser, args.baseUrl, player.sessionCookie);
      try {
        const log = await playGame({
          context,
          baseUrl: args.baseUrl,
          runId,
          gameId: manifest.gameId,
          playerId: player.id,
          displayName: player.displayName,
          correctnessRate: args.correctnessRate,
        });
        logs.push(log);
      } finally {
        await context.close();
      }
    }

    console.log('[playtest] running LLM review');
    const review = await reviewSession({ logs, runId });

    const reportFile = writeReport({ manifest, logs, review });
    console.log(`[playtest] report written → ${reportFile}`);
    console.log(`[playtest] run dir → ${runDir(runId)}`);

    if (!args.keep) {
      console.log('[playtest] --keep=false: cleaning up test rows immediately');
      await wipeTestData(manifest);
    } else {
      console.log(`[playtest] retained test rows; cleanup later with --clean --run-id=${runId}`);
    }
  } finally {
    await browser.close();
  }
}

main()
  .catch((error) => {
    console.error('[playtest] failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end().catch(() => undefined);
  });
