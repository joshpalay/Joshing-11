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

    // PlayerMastery.territory_type was introduced after the base table. Preview
    // databases can have the migration recorded without the column present, which
    // makes Drizzle selects fail with Postgres 42703 before app code can recover.
    // Add it idempotently before migrate() so answer routes remain usable.
    try {
      await db.execute(sql`
        ALTER TABLE "PLAYER_MASTERY"
          ADD COLUMN IF NOT EXISTS "territory_type" text DEFAULT 'demonstrated' NOT NULL
      `);
    } catch {
      // PLAYER_MASTERY may not exist yet — migrate() handles initial creation.
    }

    // UserQuestionBank provenance columns were added after the original table. If
    // a preview/production database has the migration marked as applied without
    // these additive columns present, Drizzle selects fail with Postgres 42703.
    // Add them idempotently before migrate() so question-bank reads stay safe.
    try {
      await db.execute(sql`
        ALTER TABLE "UserQuestionBank"
          ADD COLUMN IF NOT EXISTS "added_from_context_type" text,
          ADD COLUMN IF NOT EXISTS "added_from_context_id" text
      `);
    } catch {
      // UserQuestionBank may not exist yet — migrate() handles initial creation.
    }

    // Several FeedItem columns were introduced after the original table. In preview
    // databases with partially-recorded migrations, Drizzle can believe these
    // migrations already ran while the nullable columns are still absent, causing
    // feed reads to fail before migrate() gets another chance to reconcile them.
    // Pre-apply these additive columns idempotently so GET /api/feed remains safe.
    try {
      await db.execute(sql`
        ALTER TABLE "FeedItem"
          ADD COLUMN IF NOT EXISTS "personalMessage" text,
          ADD COLUMN IF NOT EXISTS "sourceResult" text,
          ADD COLUMN IF NOT EXISTS "submittedAnswer" text,
          ADD COLUMN IF NOT EXISTS "quip" text
      `);
    } catch {
      // FeedItem table may not exist yet — migrate() handles initial creation.
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

    // Migration 0021 adds a partial unique index on FeedDismissedDomain. Some
    // deployments may still execute an index-only copy of that migration, or may
    // have migration 0012 recorded without the table actually present. Create the
    // table and its non-unique indexes first so either migration shape can finish.
    try {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS "FeedDismissedDomain" (
          "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
          "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
          "canonicalSubcategory" TEXT NOT NULL,
          "dismissedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          "reinstatedAt" TIMESTAMPTZ
        )
      `);
      await db.execute(sql`
        CREATE INDEX IF NOT EXISTS "FeedDismissedDomain_userId_idx"
        ON "FeedDismissedDomain" ("userId")
      `);
      await db.execute(sql`
        CREATE INDEX IF NOT EXISTS "FeedDismissedDomain_userId_sub_idx"
        ON "FeedDismissedDomain" ("userId", "canonicalSubcategory")
      `);
      await db.execute(sql`
        DELETE FROM "FeedDismissedDomain" existing
        USING "FeedDismissedDomain" newest
        WHERE existing."userId" = newest."userId"
          AND existing."canonicalSubcategory" = newest."canonicalSubcategory"
          AND existing."reinstatedAt" IS NULL
          AND newest."reinstatedAt" IS NULL
          AND (
            existing."dismissedAt" < newest."dismissedAt"
            OR (existing."dismissedAt" = newest."dismissedAt" AND existing."id" < newest."id")
          )
      `);
    } catch {
      // Fresh databases may not have the User table yet. In that case migrate()
      // will create both User and FeedDismissedDomain in normal migration order.
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
