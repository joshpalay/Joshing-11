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

export * from './schema';
