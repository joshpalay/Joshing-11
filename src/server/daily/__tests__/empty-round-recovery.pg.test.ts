import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

// QA 2026-09-29, C1 — a new player unfriended the inviter before answering,
// dropSeveredBonusSlots wiped every unanswered slot (a NULL keep-predicate
// drops the row), and every rebuild then lost the persist race to the empty
// row. Both halves are SQL semantics a mocked chain can't see, so this runs
// against a real Postgres.
const testDatabaseUrl = process.env.TEST_DATABASE_URL;

// Run only against a disposable local database, never the application's .env.
describe.skipIf(!testDatabaseUrl)('empty daily round — Postgres', () => {
  let pool: typeof import('@/server/db').pool;
  let drop: typeof import('@/server/daily/drop-severed-bonus').dropSeveredBonusSlots;
  let persist: typeof import('@/server/db/queries/daily').persistDailyQueue;
  let today: string;

  const OWNER = 'owner-1';
  const FRIEND = 'friend-a';

  const readSlots = async (): Promise<Array<Record<string, unknown>>> => {
    const { rows } = await pool.query(`SELECT slots FROM "DailyQueue" WHERE user_id = $1`, [OWNER]);
    return rows[0]?.slots ?? null;
  };
  const seed = (slots: unknown[]) =>
    pool.query(`INSERT INTO "DailyQueue" (user_id, queue_date, slots, target_size) VALUES ($1, $2, $3, 5)`, [
      OWNER,
      today,
      JSON.stringify(slots),
    ]);

  beforeAll(async () => {
    const url = new URL(testDatabaseUrl!);
    if (!['127.0.0.1', 'localhost'].includes(url.hostname) || url.pathname !== '/joshing_empty_round_test') {
      throw new Error('TEST_DATABASE_URL must point to the local joshing_empty_round_test database');
    }
    process.env.DATABASE_URL = testDatabaseUrl;
    ({ pool } = await import('@/server/db'));
    ({ dropSeveredBonusSlots: drop } = await import('@/server/daily/drop-severed-bonus'));
    ({ persistDailyQueue: persist } = await import('@/server/db/queries/daily'));
    ({ assignmentDateStr: today } = (await import('@/lib/games/timezone')).getDailyAssignmentBounds());

    await pool.query(
      `CREATE TABLE "DailyQueue" (
        id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
        user_id text NOT NULL,
        queue_date date NOT NULL,
        slots jsonb NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        email_reminder_sent_at timestamptz,
        sms_reminder_sent_at timestamptz,
        target_size integer,
        build_completed_at timestamptz,
        UNIQUE (user_id, queue_date)
      )`,
    );
  });

  beforeEach(async () => {
    await pool.query(`TRUNCATE "DailyQueue"`);
  });

  afterAll(async () => {
    await pool?.end();
  });

  it('drops only the severed friend’s unanswered bonus, never core slots', async () => {
    await seed([
      { slot_index: 0, question_text: 'core unanswered', answered: false },
      { slot_index: 1, question_text: 'core with no answered key' },
      { slot_index: 2, question_text: 'core answered', answered: true },
      { slot_index: 3, question_text: 'core skipped', answered: false, skipped: true },
      { slot_index: 5, question_text: 'bonus A unanswered', presence_source_id: FRIEND, answered: false },
      { slot_index: 6, question_text: 'bonus A answered', presence_source_id: FRIEND, answered: true },
      { slot_index: 7, question_text: 'bonus Z', presence_source_id: 'friend-z', answered: false },
    ]);

    await drop(FRIEND, [OWNER]);

    expect((await readSlots()).map((s) => s.question_text)).toEqual([
      'core unanswered',
      'core with no answered key',
      'core answered',
      'core skipped',
      'bonus A answered',
      'bonus Z',
    ]);
  });

  it('a new build replaces an EMPTY row and reports won', async () => {
    await seed([]);
    const slots = [{ slot_index: 0, source: 'bot', question_text: 'fresh', answered: false }] as never;

    const result = await persist(OWNER, slots, []);

    expect(result?.won).toBe(true);
    expect((await readSlots()).map((s) => s.question_text)).toEqual(['fresh']);
  });

  it('a new build never overwrites a populated row (first writer wins)', async () => {
    await seed([{ slot_index: 0, question_text: 'served', answered: false }]);
    const slots = [{ slot_index: 0, source: 'bot', question_text: 'loser', answered: false }] as never;

    const result = await persist(OWNER, slots, []);

    expect(result?.won).toBe(false);
    expect((await readSlots()).map((s) => s.question_text)).toEqual(['served']);
  });
});
