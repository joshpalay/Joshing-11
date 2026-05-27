import 'dotenv/config';

import { pool } from '@/server/db';

import { parsePlaytestArgs } from './lib/args';
import { launchBrowser } from './lib/browser';
import { wipeTestData } from './lib/cleanup';
import { reviewSession } from './lib/claude';
import { ensureRunDirs, newRunId, readManifest, runDir } from './lib/manifest';
import { preflight } from './lib/preflight';
import { writeReport } from './lib/report';
import { runSuite, selectScenarios } from './lib/suite';
import { allScenarios } from './scenarios';

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

  // Validate scenario ids before doing anything expensive.
  const picked = selectScenarios(allScenarios, args);

  const runId = args.runId ?? newRunId();
  ensureRunDirs(runId);
  console.log(`[playtest] starting run ${runId} (audits/playtest-${runId}/)`);
  console.log(`[playtest] running ${picked.length} scenario(s): ${picked.map((s) => s.id).join(', ')}`);

  const browser = await launchBrowser(args.headed);
  try {
    const { manifest, logs } = await runSuite({
      scenarios: picked,
      args,
      browser,
      runId,
    });

    console.log('[playtest] running LLM review');
    const review = await reviewSession({ logs, runId });

    const reportFile = writeReport({ manifest, logs, review });
    console.log(`[playtest] report written → ${reportFile}`);
    console.log(`[playtest] run dir → ${runDir(runId)}`);

    const failedScenarios = logs.filter((log) => log.status === 'fail');
    if (failedScenarios.length > 0) {
      console.error(`[playtest] ${failedScenarios.length} scenario(s) failed: ${failedScenarios.map((s) => s.scenarioId).join(', ')}`);
      process.exitCode = 1;
    }

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
