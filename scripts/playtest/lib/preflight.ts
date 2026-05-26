import type { PlaytestArgs } from './args';

const MAX_PLAYERS = 6;

export function preflight(args: PlaytestArgs): void {
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      '[playtest] refusing to run with NODE_ENV=production. This harness creates and deletes real rows in the configured DATABASE_URL.',
    );
  }
  if (!process.env.DATABASE_URL) {
    throw new Error('[playtest] DATABASE_URL is required.');
  }
  if (args.players < 1 || args.players > MAX_PLAYERS) {
    throw new Error(
      `[playtest] --players must be between 1 and ${MAX_PLAYERS} ` +
        `(the Postgres pool is capped at 5 in src/server/db/index.ts; more players overload it).`,
    );
  }
  if (args.questions < 1 || args.questions > 5) {
    throw new Error('[playtest] --questions must be between 1 and 5 (matches Joshing game limit).');
  }
  if (args.correctnessRate < 0 || args.correctnessRate > 1) {
    throw new Error('[playtest] --correctness-rate must be between 0 and 1.');
  }
}
