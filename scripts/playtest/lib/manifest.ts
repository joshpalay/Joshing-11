import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';

export type PlaytestManifest = {
  runId: string;
  baseUrl: string;
  createdAt: string;
  inviter: { id: string; phone: string; displayName: string };
  players: { id: string; phone: string; displayName: string; sessionCookie: string }[];
  questionIds: string[];
  gameId: string;
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
