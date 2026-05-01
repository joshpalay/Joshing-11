import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import checkEnv from '@/env-check';
import * as schema from './schema';

const connectionString = process.env.DATABASE_URL;

if (process.env.NODE_ENV === 'production' && process.env.NEXT_PHASE !== 'phase-production-build') {
  checkEnv();
}

if (!connectionString) {
  throw new Error('DATABASE_URL is required to initialize the database client.');
}

export const pool = new Pool({ connectionString });
export const db = drizzle(pool, { schema });

export * from './schema';
