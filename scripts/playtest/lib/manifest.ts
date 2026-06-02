import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';

export type TrackedUser = {
  kind: 'user';
  id: string;
  phone: string;
  displayName: string;
  scenarioId: string;
};

export type TrackedQuestion = {
  kind: 'question';
  id: string;
  creatorId: string;
  scenarioId: string;
};

export type TrackedInvitation = {
  kind: 'invitation';
  id: string;
  inviterUserId: string;
  inviteePhone: string;
  scenarioId: string;
};

export type TrackedFriendship = {
  kind: 'friendship';
  id: string;
  scenarioId: string;
};

export type TrackedGame = {
  kind: 'game';
  id: string;
  scenarioId: string;
};

export type TrackedDailyQueue = {
  kind: 'daily-queue';
  id: string;
  userId: string;
  scenarioId: string;
};

export type TrackedRow =
  | TrackedUser
  | TrackedQuestion
  | TrackedInvitation
  | TrackedFriendship
  | TrackedGame
  | TrackedDailyQueue;

export type PlaytestManifest = {
  runId: string;
  baseUrl: string;
  createdAt: string;
  rows: TrackedRow[];
  /**
   * Per-scenario stash for things the cleanup doesn't need but
   * scenarios want to remember (e.g. session cookies for replay).
   */
  scenarioData: Record<string, Record<string, unknown>>;
};

const ROOT = path.resolve(process.cwd(), 'audits');

export function runDir(runId: string): string {
  return path.join(ROOT, `playtest-${runId}`);
}

export function manifestPath(runId: string): string {
  return path.join(runDir(runId), 'manifest.json');
}

export function screenshotDir(runId: string): string {
  return path.join(runDir(runId), 'screenshots');
}

export function reportPath(runId: string): string {
  return path.join(ROOT, `playtest-${runId}.md`);
}

export function ensureRunDirs(runId: string): void {
  mkdirSync(screenshotDir(runId), { recursive: true });
}

export function writeManifest(manifest: PlaytestManifest): void {
  ensureRunDirs(manifest.runId);
  writeFileSync(manifestPath(manifest.runId), JSON.stringify(manifest, null, 2));
}

export function readManifest(runId: string): PlaytestManifest {
  const p = manifestPath(runId);
  if (!existsSync(p)) {
    throw new Error(`[playtest] manifest not found at ${p}`);
  }
  return JSON.parse(readFileSync(p, 'utf8')) as PlaytestManifest;
}

export function newRunId(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

export function newManifest(runId: string, baseUrl: string): PlaytestManifest {
  return {
    runId,
    baseUrl,
    createdAt: new Date().toISOString(),
    rows: [],
    scenarioData: {},
  };
}
