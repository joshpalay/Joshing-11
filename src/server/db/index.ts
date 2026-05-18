import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import * as schema from './schema';

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error('DATABASE_URL is required to initialize the database client.');
}

// Singleton prevents a new Pool from being allocated on every hot-reload in
// Next.js dev mode. Without this, each reload leaks idle connections that
// count against PgBouncer's session-mode pool_size limit.
const globalForDb = globalThis as unknown as { pool: Pool | undefined };

export const pool =
  globalForDb.pool ??
  new Pool({
    connectionString,
    // Cap well below PgBouncer's session-mode pool_size (15) so that
    // multiple Next.js worker processes don't jointly exhaust the limit.
    max: 5,
  });

globalForDb.pool = pool;

export const db = drizzle(pool, { schema });

// Periodic pool-saturation logger. Logs only when there's actual contention
// (a request was waiting on a connection) or the pool is near its cap, so
// the log stays quiet during normal operation and screams when the
// 5-connection ceiling is biting. unref() prevents the interval from keeping
// the Node process alive in scripts/tests, and the global cache prevents
// dev-mode hot-reload from spawning duplicates.
const globalForPoolLogger = globalThis as unknown as {
  __joshingPoolLogger?: NodeJS.Timeout;
};
if (!globalForPoolLogger.__joshingPoolLogger) {
  const timer = setInterval(() => {
    const total = pool.totalCount;
    const idle = pool.idleCount;
    const waiting = pool.waitingCount;
    if (waiting > 0 || total >= 4) {
      console.info('[db-pool]', { total, idle, waiting, max: 5 });
    }
  }, 30_000);
  timer.unref();
  globalForPoolLogger.__joshingPoolLogger = timer;
}

export * from './schema';
