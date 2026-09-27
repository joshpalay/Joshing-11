import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { domainKey } from '@/lib/knowledge/domain-key';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

// The normal suite does not need a database. Set TEST_DATABASE_URL to a
// disposable local Postgres database to run the real SQL/JS parity check.
describe.skipIf(!testDatabaseUrl)('findExactCanonicalMatch — Postgres parity', () => {
  let pool: typeof import('@/server/db').pool;
  let findExactCanonicalMatch: typeof import('@/server/db/queries/knowledge').findExactCanonicalMatch;

  beforeAll(async () => {
    const url = new URL(testDatabaseUrl!);
    if (
      !['127.0.0.1', 'localhost'].includes(url.hostname) ||
      url.pathname !== '/joshing_category_parity_test'
    ) {
      throw new Error(
        'TEST_DATABASE_URL must point to the local joshing_category_parity_test database',
      );
    }

    process.env.DATABASE_URL = testDatabaseUrl;
    const dbModule = await import('@/server/db');
    pool = dbModule.pool;
    ({ findExactCanonicalMatch } = await import('@/server/db/queries/knowledge'));

    // Only these two columns are read by the query. The disposable database
    // intentionally has no application data or migrations.
    await pool.query(
      'CREATE TABLE "PLAYER_MASTERY" (canonical_subcategory text NOT NULL, broad_category text)',
    );
  });

  afterAll(async () => {
    if (!pool) return;
    await pool.query('DROP TABLE IF EXISTS "PLAYER_MASTERY"');
    await pool.end();
  });

  it('matches every connector and punctuation fold used by domainKey', async () => {
    const equivalent: Array<[string, string]> = [
      ['Star Trek: TNG', 'Star Trek TNG'],
      ['Star Trek – TNG', 'Star Trek TNG'],
      ['Star Trek—TNG', 'Star Trek TNG'],
      ['Star Trek - TNG', 'Star Trek TNG'],
      ['Rock & Roll', 'Rock and Roll'],
      ['90’s Hip-Hop', "90's Hip-Hop"],
      ['  Mixed   CASE  ', 'mixed case'],
      ['A B', 'A B'],
      ['A:	B', 'A B'],
    ];

    for (const [stored, proposed] of equivalent) {
      expect(domainKey(stored)).toBe(domainKey(proposed));
      await pool.query('TRUNCATE "PLAYER_MASTERY"');
      await pool.query(
        'INSERT INTO "PLAYER_MASTERY" (canonical_subcategory, broad_category) VALUES ($1, $2)',
        [stored, 'Pop Culture'],
      );
      expect(await findExactCanonicalMatch(proposed)).toMatchObject({
        label: stored,
        broadCategory: 'Pop Culture',
        prevalence: 1,
      });
    }
  });

  it('keeps distinct domains separate', async () => {
    const distinct: Array<[string, string]> = [
      ['Alien', 'Alien: Covenant'],
      ['Henry IV', 'Henry IV, Part 2'],
      ['D-Day', 'D Day'],
    ];

    for (const [stored, proposed] of distinct) {
      expect(domainKey(stored)).not.toBe(domainKey(proposed));
      await pool.query('TRUNCATE "PLAYER_MASTERY"');
      await pool.query(
        'INSERT INTO "PLAYER_MASTERY" (canonical_subcategory, broad_category) VALUES ($1, $2)',
        [stored, 'Pop Culture'],
      );
      expect(await findExactCanonicalMatch(proposed)).toBeNull();
    }
  });
});
