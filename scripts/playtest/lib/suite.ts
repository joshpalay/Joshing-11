import type { Browser } from 'playwright';

import type { PlaytestArgs } from './args';
import { ManifestBuilder, type Scenario, type ScenarioContext, type ScenarioLog } from './scenario-context';
import { newManifest, screenshotDir, writeManifest, type PlaytestManifest } from './manifest';

export type SuiteResult = {
  manifest: PlaytestManifest;
  logs: ScenarioLog[];
};

function nowIso(): string {
  return new Date().toISOString();
}

export function selectScenarios(all: Scenario[], args: PlaytestArgs): Scenario[] {
  if (args.scenarioIds.length === 0) return all;
  const wanted = new Set(args.scenarioIds);
  const picked = all.filter((s) => wanted.has(s.id));
  const missing = [...wanted].filter((id) => !all.some((s) => s.id === id));
  if (missing.length > 0) {
    throw new Error(
      `[playtest] unknown scenario id(s): ${missing.join(', ')}. ` +
        `Known: ${all.map((s) => s.id).join(', ')}`,
    );
  }
  return picked;
}

export async function runSuite(params: {
  scenarios: Scenario[];
  args: PlaytestArgs;
  browser: Browser;
  runId: string;
}): Promise<SuiteResult> {
  const manifest = newManifest(params.runId, params.args.baseUrl);
  const builder = new ManifestBuilder(manifest);
  const scenarios = selectScenarios(params.scenarios, params.args);

  const logs: ScenarioLog[] = [];

  for (const scenario of scenarios) {
    console.log(`[playtest] scenario "${scenario.id}" — ${scenario.displayName}`);
    const startedAt = Date.now();
    const ctx: ScenarioContext = {
      baseUrl: params.args.baseUrl,
      runId: params.runId,
      browser: params.browser,
      manifest: builder,
      screenshotDir: screenshotDir(params.runId),
      args: params.args,
      scenarioId: scenario.id,
    };
    let log: ScenarioLog;
    try {
      log = await scenario.run(ctx);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[playtest] scenario "${scenario.id}" threw: ${message}`);
      log = {
        scenarioId: scenario.id,
        displayName: scenario.displayName,
        status: 'fail',
        durationMs: Date.now() - startedAt,
        events: [{ kind: 'error', message, at: nowIso() }],
        assertions: [],
        errorMessage: message,
      };
    }
    logs.push(log);
    // Persist the manifest after every scenario so a crash mid-suite
    // still leaves a usable cleanup target.
    writeManifest(manifest);
  }

  return { manifest, logs };
}
