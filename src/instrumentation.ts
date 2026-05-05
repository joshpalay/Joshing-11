export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { migrate } = await import('drizzle-orm/node-postgres/migrator');
    const { drizzle } = await import('drizzle-orm/node-postgres');
    const { Pool } = await import('pg');
    const { sql } = await import('drizzle-orm');
    const path = await import('path');
    const fs = await import('fs');
    const crypto = await import('crypto');

    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const db = drizzle(pool);

    // Migration 0006 sets NOT NULL on senderUserId/recipientUserId after adding them
    // as nullable columns. If any rows have NULL values (from a partial migration or
    // data predating those columns), the SET NOT NULL fails and blocks all subsequent
    // migrations. Delete those structurally-invalid rows first so 0006 can succeed.
    try {
      await db.execute(sql`
        DELETE FROM "QuestionReaction"
        WHERE "senderUserId" IS NULL OR "recipientUserId" IS NULL
      `);
    } catch {
      // Table or columns may not exist yet — that's fine, migrate() will create them
    }

    // Migration 0012 adds "sourceResult" to FeedItem but the final statement
    // (ALTER TYPE ... ADD VALUE) can fail in some PostgreSQL environments, leaving
    // the migration unrecorded and the column absent on every subsequent startup.
    // Pre-apply the column so the feed query never hits a missing-column error.
    try {
      await db.execute(sql`ALTER TABLE "FeedItem" ADD COLUMN IF NOT EXISTS "sourceResult" TEXT`);
    } catch {
      // Column already exists or FeedItem table not yet created — migrate() handles both
    }

    // If the Category enum type already exists but migration 0000 isn't recorded,
    // the migrator fails at the very first CREATE TYPE statement and aborts — leaving
    // all subsequent migrations (0006 recipientUserId, 0014 territory_type, etc.)
    // unapplied. Detect this and manually insert the 0000 record so Drizzle skips it.
    try {
      const typeResult = await db.execute(sql`
        SELECT EXISTS (
          SELECT 1 FROM pg_type t
          JOIN pg_namespace n ON n.oid = t.typnamespace
          WHERE t.typname = 'Category' AND n.nspname = 'public'
        ) AS exists
      `);

      const categoryExists = typeResult.rows[0]?.exists === true || typeResult.rows[0]?.exists === 'true';
      if (categoryExists) {
        const migrationsFolder = path.join(process.cwd(), 'drizzle');
        const migrationSql = fs.readFileSync(path.join(migrationsFolder, '0000_material_lyja.sql'), 'utf8');
        const hash = crypto.createHash('sha256').update(migrationSql).digest('hex');

        // Ensure Drizzle's internal migration tracking schema and table exist
        await db.execute(sql`CREATE SCHEMA IF NOT EXISTS "drizzle"`);
        await db.execute(sql`
          CREATE TABLE IF NOT EXISTS "drizzle"."__drizzle_migrations" (
            id serial PRIMARY KEY,
            hash text NOT NULL,
            created_at bigint
          )
        `);

        // Record 0000 as applied if it isn't already, so migrate() skips it
        await db.execute(sql`
          INSERT INTO "drizzle"."__drizzle_migrations" (hash, created_at)
          SELECT ${hash}::text, ${Date.now()}::bigint
          WHERE NOT EXISTS (
            SELECT 1 FROM "drizzle"."__drizzle_migrations" WHERE hash = ${hash}
          )
        `);
      }
    } catch {
      // If this check fails, proceed — migrate() will attempt all migrations and
      // log the error itself
    }

    try {
      await migrate(db, {
        migrationsFolder: path.join(process.cwd(), 'drizzle'),
      });
    } catch (err) {
      console.error('[instrumentation] DB migration failed — server will start but schema may be out of date:', err);
    } finally {
      await pool.end();
    }
  }
}
