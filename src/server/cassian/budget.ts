import pg from 'pg';

export const CASSIAN_TOTAL_CAP_USD = 10;
export const CASSIAN_FIRST_RUN_CAP_USD = 4;

type CallStep = {
  status: 'reserved' | 'done' | 'uncertain';
  reservedUsd: number;
  actualUsd?: number;
  at: string;
  completedAt?: string;
  reason?: string;
};
export type Calls = Record<string, CallStep>;

type RunRow = {
  id: string;
  manifest_sha: string;
  status: 'active' | 'halted' | 'complete';
  spent_usd: string;
  reserved_usd: string;
  calls: Calls;
};

const LOCK_KEY = 617842901; // Cassian budget; kept stable across processes.
const RUNNER_LOCK_KEY = LOCK_KEY + 1;
let pool: pg.Pool | null = null;
function getPool(): pg.Pool {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for Cassian budget accounting.');
  pool ??= new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
  return pool;
}

export function canReserve(args: {
  lifetimeSpent: number;
  lifetimeReserved: number;
  runSpent: number;
  runReserved: number;
  requested: number;
  runCap?: number;
}): boolean {
  const { lifetimeSpent, lifetimeReserved, runSpent, runReserved, requested } = args;
  const runCap = args.runCap ?? CASSIAN_FIRST_RUN_CAP_USD;
  const values = [lifetimeSpent, lifetimeReserved, runSpent, runReserved, requested, runCap];
  return values.every((value) => Number.isFinite(value) && value >= 0)
    && requested > 0
    && lifetimeSpent + lifetimeReserved + requested <= CASSIAN_TOTAL_CAP_USD + 1e-9
    && runSpent + runReserved + requested <= runCap + 1e-9;
}

async function transaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1)', [LOCK_KEY]);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function reserveCall(args: {
  runId: string;
  manifestSha: string;
  key: string;
  reserveUsd: number;
  runCap?: number;
}): Promise<'reserved' | 'already_done'> {
  if (!args.runId || !args.key || !args.manifestSha) throw new Error('Missing Cassian identity.');
  if (!Number.isFinite(args.reserveUsd) || args.reserveUsd <= 0) throw new Error('Invalid reservation.');
  return transaction(async (client) => {
    await client.query(
      'INSERT INTO "CassianRun" (id, manifest_sha) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING',
      [args.runId, args.manifestSha],
    );
    const rowResult = await client.query<RunRow>(
      'SELECT * FROM "CassianRun" WHERE id = $1 FOR UPDATE', [args.runId],
    );
    const row = rowResult.rows[0];
    if (!row || row.manifest_sha !== args.manifestSha) throw new Error('Run manifest changed.');
    if (row.status !== 'active') throw new Error(`Cassian run is ${row.status}.`);
    const existing = row.calls[args.key];
    if (existing?.status === 'done') return 'already_done';
    if (existing) throw new Error(`Call ${args.key} has an unresolved ${existing.status} reservation.`);
    const totals = await client.query<{ spent: string; reserved: string }>(
      'SELECT COALESCE(sum(spent_usd), 0) AS spent, COALESCE(sum(reserved_usd), 0) AS reserved FROM "CassianRun"',
    );
    if (!canReserve({
      lifetimeSpent: Number(totals.rows[0].spent),
      lifetimeReserved: Number(totals.rows[0].reserved),
      runSpent: Number(row.spent_usd),
      runReserved: Number(row.reserved_usd),
      requested: args.reserveUsd,
      runCap: args.runCap,
    })) throw new Error('Cassian budget cap would be exceeded.');
    const calls: Calls = { ...row.calls, [args.key]: {
      status: 'reserved', reservedUsd: args.reserveUsd, at: new Date().toISOString(),
    } };
    await client.query(
      'UPDATE "CassianRun" SET calls = $2::jsonb, reserved_usd = reserved_usd + $3, updated_at = now() WHERE id = $1',
      [args.runId, JSON.stringify(calls), args.reserveUsd],
    );
    return 'reserved';
  });
}

export async function settleCall(args: {
  runId: string;
  key: string;
  actualUsd: number | null;
  reason?: string;
}): Promise<void> {
  await transaction(async (client) => {
    const rowResult = await client.query<RunRow>(
      'SELECT * FROM "CassianRun" WHERE id = $1 FOR UPDATE', [args.runId],
    );
    const row = rowResult.rows[0];
    const step = row?.calls[args.key];
    if (!row || !step || step.status !== 'reserved') throw new Error('No active Cassian reservation.');
    const known = args.actualUsd !== null && Number.isFinite(args.actualUsd) && args.actualUsd >= 0;
    const calls: Calls = { ...row.calls, [args.key]: {
      ...step,
      status: known ? 'done' : 'uncertain',
      ...(known ? { actualUsd: args.actualUsd! } : { reason: args.reason ?? 'charge unknown' }),
      completedAt: new Date().toISOString(),
    } };
    const overReserve = known && args.actualUsd! > step.reservedUsd + 1e-9;
    await client.query(
      `UPDATE "CassianRun" SET calls = $2::jsonb,
       spent_usd = spent_usd + $3,
       reserved_usd = reserved_usd - $4,
       status = CASE WHEN $5 THEN 'halted' ELSE status END,
       updated_at = now() WHERE id = $1`,
      [args.runId, JSON.stringify(calls), known ? args.actualUsd : 0,
        known ? step.reservedUsd : 0, overReserve || !known],
    );
    if (overReserve) {
      // The charge already occurred. Halt further calls while keeping the actual
      // cost on record; the caller must report the exceeded reservation.
      console.error('[cassian] call exceeded reserved ceiling', { key: args.key });
    }
  });
}

export async function getBudgetStatus(runId: string): Promise<{
  spentUsd: number; reservedUsd: number; calls: Calls;
  lifetimeSpentUsd: number; lifetimeReservedUsd: number;
}> {
  const client = await getPool().connect();
  try {
    const [run, total] = await Promise.all([
      client.query<RunRow>('SELECT * FROM "CassianRun" WHERE id = $1', [runId]),
      client.query<{ spent: string; reserved: string }>(
        'SELECT COALESCE(sum(spent_usd), 0) AS spent, COALESCE(sum(reserved_usd), 0) AS reserved FROM "CassianRun"',
      ),
    ]);
    return {
      spentUsd: Number(run.rows[0]?.spent_usd ?? 0),
      reservedUsd: Number(run.rows[0]?.reserved_usd ?? 0),
      calls: run.rows[0]?.calls ?? {},
      lifetimeSpentUsd: Number(total.rows[0].spent),
      lifetimeReservedUsd: Number(total.rows[0].reserved),
    };
  } finally {
    client.release();
  }
}

/** A session advisory lock permits one paid CLI runner without a long transaction. */
export async function acquireRunnerLock(): Promise<() => Promise<void>> {
  const client = await getPool().connect();
  try {
    const result = await client.query<{ acquired: boolean }>(
      'SELECT pg_try_advisory_lock($1) AS acquired', [RUNNER_LOCK_KEY],
    );
    if (!result.rows[0]?.acquired) throw new Error('Another Cassian paid runner is active.');
    return async () => {
      try { await client.query('SELECT pg_advisory_unlock($1)', [RUNNER_LOCK_KEY]); }
      finally { client.release(); }
    };
  } catch (error) {
    client.release();
    throw error;
  }
}

export async function closeBudgetPool(): Promise<void> { if (pool) await pool.end(); }
