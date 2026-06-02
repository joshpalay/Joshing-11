import type { Browser } from 'playwright';

import type { PlaytestArgs } from './args';
import type {
  PlaytestManifest,
  TrackedDailyQueue,
  TrackedFriendship,
  TrackedGame,
  TrackedInvitation,
  TrackedQuestion,
  TrackedUser,
} from './manifest';
import type { PlayerEvent } from './player';

export type ScenarioStatus = 'pass' | 'fail' | 'skip';

export type AssertionResult =
  | { kind: 'assert_pass'; label: string; at: string }
  | { kind: 'assert_fail'; label: string; message: string; at: string };

export type ScenarioLog = {
  scenarioId: string;
  displayName: string;
  status: ScenarioStatus;
  durationMs: number;
  events: PlayerEvent[];
  assertions: AssertionResult[];
  notes?: string;
  errorMessage?: string;
};

export class ManifestBuilder {
  constructor(private readonly manifest: PlaytestManifest) {}

  trackUser(row: Omit<TrackedUser, 'kind'>): void {
    this.manifest.rows.push({ kind: 'user', ...row });
  }
  trackQuestion(row: Omit<TrackedQuestion, 'kind'>): void {
    this.manifest.rows.push({ kind: 'question', ...row });
  }
  trackInvitation(row: Omit<TrackedInvitation, 'kind'>): void {
    this.manifest.rows.push({ kind: 'invitation', ...row });
  }
  trackFriendship(row: Omit<TrackedFriendship, 'kind'>): void {
    this.manifest.rows.push({ kind: 'friendship', ...row });
  }
  trackGame(row: Omit<TrackedGame, 'kind'>): void {
    this.manifest.rows.push({ kind: 'game', ...row });
  }
  trackDailyQueue(row: Omit<TrackedDailyQueue, 'kind'>): void {
    this.manifest.rows.push({ kind: 'daily-queue', ...row });
  }

  putScenarioData(scenarioId: string, key: string, value: unknown): void {
    if (!this.manifest.scenarioData[scenarioId]) {
      this.manifest.scenarioData[scenarioId] = {};
    }
    this.manifest.scenarioData[scenarioId][key] = value;
  }

  raw(): PlaytestManifest {
    return this.manifest;
  }
}

export type ScenarioContext = {
  baseUrl: string;
  runId: string;
  browser: Browser;
  manifest: ManifestBuilder;
  screenshotDir: string;
  args: PlaytestArgs;
  scenarioId: string;
};

export type Scenario = {
  id: string;
  displayName: string;
  description: string;
  run(ctx: ScenarioContext): Promise<ScenarioLog>;
};
