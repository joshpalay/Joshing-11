export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // PHONE_HASH_SALT seeds the SHA-256 used by hashPhoneNumber()
    // (src/server/lib/phone-hashing.ts) and the client-side hashing path
    // B-Friends-4 will add. hashPhoneNumber() already throws at call time if
    // the salt is missing, so this boot-time check is just a loud warning —
    // throwing here kills the entire instrumentation hook and 500s every
    // request, which is the opposite of the desired fail-fast behavior.
    // B-Friends-4 will re-introduce strict enforcement at the actual call
    // sites that need it.
    if (process.env.NODE_ENV === 'production' && !process.env.PHONE_HASH_SALT) {
      console.error(
        '[instrumentation] PHONE_HASH_SALT is not set in production; contact-hash matching will throw at call time. Set this env var to enable B-Friends-4 features.',
      );
    }

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

    // Domain-merge mastery events were introduced after the base table in
    // drizzle/0009_domain_merge_events.sql. Some preview/production databases
    // can have that migration recorded without the enum value or metadata column
    // present, which makes the domain cleanup audit insert in ceremony.ts fail.
    // Add both pieces idempotently before migrate() so the backfill can proceed.
    try {
      await db.execute(sql`
        ALTER TYPE "public"."MasterySourceType" ADD VALUE IF NOT EXISTS 'curator_credit'
      `);
      await db.execute(sql`
        ALTER TYPE "public"."MasterySourceType" ADD VALUE IF NOT EXISTS 'domain_merged'
      `);
      await db.execute(sql`
        ALTER TYPE "public"."MasterySourceType" ADD VALUE IF NOT EXISTS 'declared_promoted'
      `);
      await db.execute(sql`
        ALTER TABLE "MASTERY_EVENTS"
          ADD COLUMN IF NOT EXISTS "metadata" jsonb
      `);
    } catch {
      // MASTERY_EVENTS or MasterySourceType may not exist yet — migrate() handles
      // initial creation and the additive migration will add these schema pieces.
    }

    // PlayerMastery.territory_type was introduced after the base table and later
    // (migration 0034) converted from text to a TerritoryType enum. Preview
    // databases can have either migration recorded without its schema actually
    // landing, which makes Drizzle selects fail with Postgres 42703 or 22P02
    // before app code can recover. Mirror 0034's idempotent shape here: create
    // the enum, ensure the column exists (as enum if fresh, converted if text).
    try {
      await db.execute(sql`
        DO $$ BEGIN
          CREATE TYPE "public"."TerritoryType" AS ENUM('declared', 'demonstrated');
        EXCEPTION WHEN duplicate_object THEN NULL;
        END $$
      `);
      await db.execute(sql`
        ALTER TABLE "PLAYER_MASTERY"
          ADD COLUMN IF NOT EXISTS "territory_type" "public"."TerritoryType" DEFAULT 'demonstrated' NOT NULL
      `);
      await db.execute(sql`
        DO $$ BEGIN
          IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'PLAYER_MASTERY'
              AND column_name = 'territory_type'
              AND udt_name = 'text'
          ) THEN
            ALTER TABLE "PLAYER_MASTERY" ALTER COLUMN "territory_type" DROP DEFAULT;
            ALTER TABLE "PLAYER_MASTERY"
              ALTER COLUMN "territory_type"
              SET DATA TYPE "public"."TerritoryType"
              USING "territory_type"::"public"."TerritoryType";
            ALTER TABLE "PLAYER_MASTERY"
              ALTER COLUMN "territory_type"
              SET DEFAULT 'demonstrated'::"public"."TerritoryType";
          END IF;
        END $$
      `);
    } catch {
      // PLAYER_MASTERY may not exist yet — migrate() handles initial creation.
    }

    // Migration 0043 renames PlayerMastery.season_points_start to
    // lifetime_points_baseline. If a preview/production database has 0043
    // recorded without the rename actually applied, Drizzle selects against
    // the new column name fail with Postgres 42703. Apply the rename
    // idempotently before migrate() so app code referencing the new column
    // name keeps working.
    try {
      await db.execute(sql`
        DO $$
        BEGIN
          IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name = 'PLAYER_MASTERY'
              AND column_name = 'season_points_start'
          ) THEN
            ALTER TABLE "PLAYER_MASTERY"
              RENAME COLUMN "season_points_start" TO "lifetime_points_baseline";
          END IF;
        END $$
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

    // Question generated-question provenance columns and constraints were added
    // in migration 0018. If that migration is recorded without these additive
    // pieces present, "my questions" reads can fail before migrate() repairs them.
    // Add the columns, foreign key, and unique index idempotently before migrate().
    try {
      // 0018 also drops NOT NULL on creator_id so daily_generated questions
      // (which have no human author) can be persisted with creator_id=null.
      // If that statement didn't take effect on a partially-recorded migration,
      // every persistGeneratedQuestion call fails with 23502 and friend-feed
      // propagation silently drops for the rest of time. Re-apply it idempotently.
      await db.execute(sql`
        ALTER TABLE "Question" ALTER COLUMN "creator_id" DROP NOT NULL
      `);
      await db.execute(sql`
        ALTER TABLE "Question"
          ADD COLUMN IF NOT EXISTS "generated_question_id" text,
          ADD COLUMN IF NOT EXISTS "source" text DEFAULT 'authored' NOT NULL
      `);
      await db.execute(sql`
        DO $$
        DECLARE
          question_table regclass := to_regclass('public."Question"');
          generated_question_table regclass := to_regclass('public."GeneratedQuestion"');
        BEGIN
          IF question_table IS NOT NULL
            AND generated_question_table IS NOT NULL
            AND NOT EXISTS (
              SELECT 1
              FROM pg_constraint
              WHERE conname = 'Question_generated_question_id_GeneratedQuestion_id_fk'
                AND conrelid = question_table
            )
          THEN
            ALTER TABLE "Question"
              ADD CONSTRAINT "Question_generated_question_id_GeneratedQuestion_id_fk"
              FOREIGN KEY ("generated_question_id")
              REFERENCES "GeneratedQuestion"("id")
              ON DELETE set null;
          END IF;
        END $$
      `);
      await db.execute(sql`
        CREATE UNIQUE INDEX IF NOT EXISTS "Question_generated_question_id_key"
        ON "Question" USING btree ("generated_question_id")
      `);
    } catch {
      // Question or GeneratedQuestion may not exist yet — migrate() handles
      // initial creation and the 0018 migration will add these schema pieces.
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
          ADD COLUMN IF NOT EXISTS "catchupResolvedAt" timestamptz
      `);
    } catch {
      // FeedItem table may not exist yet — migrate() handles initial creation.
    }

    // Migration 0028 adds the Category.general_knowledge enum value and migration
    // 0030 uses it as a default/backfill value. Drizzle wraps all pending Postgres
    // migrations in one transaction, but Postgres requires a newly-added enum value
    // to be committed before it can be used. Pre-apply the enum addition and data
    // change outside the migrator transaction so production startup cannot get
    // stuck on `unsafe use of new value "general_knowledge"`.
    try {
      await db.execute(sql`
        ALTER TYPE "public"."Category" ADD VALUE IF NOT EXISTS 'general_knowledge'
      `);
      await db.execute(sql`
        ALTER TABLE "Question" ALTER COLUMN "category" SET DEFAULT 'general_knowledge'
      `);
      await db.execute(sql`
        UPDATE "Question" SET "category" = 'general_knowledge' WHERE "category" = 'other'
      `);
    } catch {
      // Fresh databases may not have Category or Question yet. In that case the
      // normal migration sequence will create the base schema first.
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

    // Migration 0036 adds a DomainExclusionScope enum, a NOT NULL scope column
    // with default on USER_DOMAIN_EXCLUSIONS, and replaces the unique constraint
    // to include scope. If a preview/production database has this migration
    // recorded without these pieces present, the exclusion writes used by the
    // daily familiarity slider fail before migrate() can repair them. Apply each
    // piece idempotently outside the migrator transaction.
    try {
      await db.execute(sql`
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM pg_type t
            JOIN pg_namespace n ON n.oid = t.typnamespace
            WHERE t.typname = 'DomainExclusionScope' AND n.nspname = 'public'
          ) THEN
            CREATE TYPE "public"."DomainExclusionScope" AS ENUM('subcategory', 'broad_category', 'category');
          END IF;
        END $$
      `);
      await db.execute(sql`
        ALTER TABLE "USER_DOMAIN_EXCLUSIONS"
          ADD COLUMN IF NOT EXISTS "scope" "public"."DomainExclusionScope" NOT NULL DEFAULT 'subcategory'
      `);
      await db.execute(sql`
        ALTER TABLE "USER_DOMAIN_EXCLUSIONS"
          DROP CONSTRAINT IF EXISTS "USER_DOMAIN_EXCLUSIONS_user_id_canonical_subcategory_key"
      `);
      await db.execute(sql`
        DO $$
        DECLARE
          exclusions_table regclass := to_regclass('public."USER_DOMAIN_EXCLUSIONS"');
        BEGIN
          IF exclusions_table IS NOT NULL
            AND NOT EXISTS (
              SELECT 1 FROM pg_constraint
              WHERE conname = 'USER_DOMAIN_EXCLUSIONS_user_id_scope_canonical_subcategory_key'
                AND conrelid = exclusions_table
            )
          THEN
            ALTER TABLE "USER_DOMAIN_EXCLUSIONS"
              ADD CONSTRAINT "USER_DOMAIN_EXCLUSIONS_user_id_scope_canonical_subcategory_key"
              UNIQUE ("user_id", "scope", "canonical_subcategory");
          END IF;
        END $$
      `);
    } catch {
      // USER_DOMAIN_EXCLUSIONS may not exist yet on a fresh database — migrate()
      // creates it before this migration runs.
    }

    // Migration 0037 adds the EmailOptIn enum and four columns on User for the
    // round-open reminder opt-in (email_opt_in, email_verified, pending_email,
    // reminder_prompt_dismissed_at). If a preview/production database has this
    // migration recorded without the pieces present, the daily summary query
    // and PATCH /api/account/reminders fail before migrate() can repair them.
    try {
      await db.execute(sql`
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM pg_type t
            JOIN pg_namespace n ON n.oid = t.typnamespace
            WHERE t.typname = 'EmailOptIn' AND n.nspname = 'public'
          ) THEN
            CREATE TYPE "public"."EmailOptIn" AS ENUM('opted_in', 'opted_out', 'not_asked');
          END IF;
        END $$
      `);
      await db.execute(sql`
        ALTER TABLE "User"
          ADD COLUMN IF NOT EXISTS "email_opt_in" "public"."EmailOptIn" NOT NULL DEFAULT 'not_asked'
      `);
      await db.execute(sql`
        ALTER TABLE "User"
          ADD COLUMN IF NOT EXISTS "email_verified" boolean NOT NULL DEFAULT false
      `);
      await db.execute(sql`
        ALTER TABLE "User"
          ADD COLUMN IF NOT EXISTS "pending_email" text
      `);
      await db.execute(sql`
        ALTER TABLE "User"
          ADD COLUMN IF NOT EXISTS "reminder_prompt_dismissed_at" timestamptz
      `);
    } catch {
      // User table may not exist yet on a fresh database — migrate() creates
      // it before this migration runs.
    }

    // Migration 0040 adds includeSubmittedAnswer to QuestionReaction (§8.22
    // opt-in for surfacing answerer text to the question author). Guard for
    // preview/production databases that may have this migration recorded
    // without the column actually present.
    try {
      await db.execute(sql`
        ALTER TABLE "QuestionReaction"
          ADD COLUMN IF NOT EXISTS "includeSubmittedAnswer" boolean NOT NULL DEFAULT false
      `);
    } catch {
      // QuestionReaction table may not exist yet on a fresh database —
      // migrate() creates it before this migration runs.
    }

    // Migration 0041 adds the nullable Question.inside_joke column for the
    // friends-only LLM-generated aside. Apply it idempotently in case the
    // migration is recorded without the column actually present.
    try {
      await db.execute(sql`
        ALTER TABLE "Question"
          ADD COLUMN IF NOT EXISTS "inside_joke" text
      `);
    } catch {
      // Question may not exist yet on a fresh database — migrate() creates it
      // before this migration runs.
    }

    // Migration 0060 adds the nullable GeneratedQuestion.inside_joke column,
    // which holds the precomputed aside copied into Question.inside_joke at
    // persist time. Apply it idempotently in case the migration is recorded
    // without the column actually present.
    try {
      await db.execute(sql`
        ALTER TABLE "GeneratedQuestion"
          ADD COLUMN IF NOT EXISTS "inside_joke" text
      `);
    } catch {
      // GeneratedQuestion may not exist yet on a fresh database — migrate()
      // creates it before this migration runs.
    }

    // Migration 0062 (B1 pool substrate) adds the TrustTier/QuestionScope enums
    // and the pool fields (trust_tier, scope, perishable, source_refs, empirical
    // stats, embedding-dedup flags) to Question + GeneratedQuestion. App code
    // (the unified selection layer, suppress-aware bank pick) reads these, so a
    // preview/production database that records the migration without the pieces
    // present must still boot. Enums + columns + grandfather backfill are applied
    // idempotently; the backfills target only rows still at the 'unverified'
    // default, so they are re-runnable no-ops once corrected.
    try {
      await db.execute(sql`
        DO $$ BEGIN
          CREATE TYPE "public"."TrustTier" AS ENUM('unverified', 'machine_verified', 'human_validated', 'author_confirmed');
        EXCEPTION WHEN duplicate_object THEN NULL;
        END $$
      `);
      await db.execute(sql`
        DO $$ BEGIN
          CREATE TYPE "public"."QuestionScope" AS ENUM('private', 'friends_only', 'public');
        EXCEPTION WHEN duplicate_object THEN NULL;
        END $$
      `);
      await db.execute(sql`ALTER TABLE "Question" ADD COLUMN IF NOT EXISTS "trust_tier" "public"."TrustTier" NOT NULL DEFAULT 'unverified'`);
      await db.execute(sql`ALTER TABLE "Question" ADD COLUMN IF NOT EXISTS "perishable" boolean NOT NULL DEFAULT false`);
      await db.execute(sql`ALTER TABLE "Question" ADD COLUMN IF NOT EXISTS "source_refs" jsonb NOT NULL DEFAULT '[]'::jsonb`);
      await db.execute(sql`ALTER TABLE "Question" ADD COLUMN IF NOT EXISTS "is_duplicate" boolean NOT NULL DEFAULT false`);
      await db.execute(sql`ALTER TABLE "Question" ADD COLUMN IF NOT EXISTS "suppressed_by" text`);
      await db.execute(sql`UPDATE "Question" SET "trust_tier" = 'author_confirmed' WHERE "trust_tier" = 'unverified'`);
    } catch {
      // Question may not exist yet on a fresh database — migrate() creates it
      // before this migration runs.
    }
    try {
      await db.execute(sql`ALTER TABLE "GeneratedQuestion" ADD COLUMN IF NOT EXISTS "trust_tier" "public"."TrustTier" NOT NULL DEFAULT 'unverified'`);
      await db.execute(sql`ALTER TABLE "GeneratedQuestion" ADD COLUMN IF NOT EXISTS "scope" "public"."QuestionScope" NOT NULL DEFAULT 'public'`);
      await db.execute(sql`ALTER TABLE "GeneratedQuestion" ADD COLUMN IF NOT EXISTS "perishable" boolean NOT NULL DEFAULT false`);
      await db.execute(sql`ALTER TABLE "GeneratedQuestion" ADD COLUMN IF NOT EXISTS "source_refs" jsonb NOT NULL DEFAULT '[]'::jsonb`);
      await db.execute(sql`ALTER TABLE "GeneratedQuestion" ADD COLUMN IF NOT EXISTS "n_answered" integer NOT NULL DEFAULT 0`);
      await db.execute(sql`ALTER TABLE "GeneratedQuestion" ADD COLUMN IF NOT EXISTS "empirical_correct_rate" double precision`);
      await db.execute(sql`ALTER TABLE "GeneratedQuestion" ADD COLUMN IF NOT EXISTS "is_duplicate" boolean NOT NULL DEFAULT false`);
      await db.execute(sql`ALTER TABLE "GeneratedQuestion" ADD COLUMN IF NOT EXISTS "suppressed_by" text`);
      // Grandfather-promote the pre-existing machine backlog — but ONLY while the
      // database is still pre-B4. Once migration 0066 adds ask_to_answer_verified,
      // we are in the B4 world where fresh rows are promoted explicitly by the
      // ask-to-answer gate (resolveMachineTrustTier); a blanket boot-time promotion
      // would then wrongly bump rows the gate deliberately left 'unverified'
      // (failed/skipped ask-to-answer). The one-time grandfather already ran in the
      // 0062 migration SQL; this guard only re-applies it for a recovering pre-B4 DB.
      await db.execute(sql`
        DO $$ BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name = 'GeneratedQuestion' AND column_name = 'ask_to_answer_verified'
          ) THEN
            UPDATE "GeneratedQuestion" SET "trust_tier" = 'machine_verified' WHERE "trust_tier" = 'unverified';
          END IF;
        END $$
      `);
    } catch {
      // GeneratedQuestion may not exist yet on a fresh database — migrate()
      // creates it before this migration runs.
    }

    // Migration 0066 (B4 Phase 1) adds GeneratedQuestion.ask_to_answer_verified —
    // the ask-to-answer corroboration record that (with B3 retrieval) earns the
    // machine_verified tier. App code reads it via resolveMachineTrustTier, so a
    // preview/production database that records the migration without the column
    // present must still boot.
    try {
      await db.execute(sql`ALTER TABLE "GeneratedQuestion" ADD COLUMN IF NOT EXISTS "ask_to_answer_verified" boolean NOT NULL DEFAULT false`);
    } catch {
      // GeneratedQuestion may not exist yet on a fresh database — migrate()
      // creates it before this migration runs.
    }

    // Migration 0063 (B1) enables pgvector and adds the nullable 1024-dim
    // embedding column + HNSW cosine indexes to both pool tables. The dedup
    // helpers read/write GeneratedQuestion.embedding / Question.embedding, so a
    // database that records the migration without the pieces present must still
    // boot. Guard the extension, columns, and indexes idempotently. If pgvector
    // is unavailable the whole block is skipped — insert-time dedup degrades to
    // the deterministic guards.
    try {
      await db.execute(sql`CREATE EXTENSION IF NOT EXISTS vector`);
      await db.execute(sql`ALTER TABLE "GeneratedQuestion" ADD COLUMN IF NOT EXISTS "embedding" vector(1024)`);
      await db.execute(sql`ALTER TABLE "Question" ADD COLUMN IF NOT EXISTS "embedding" vector(1024)`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS "GeneratedQuestion_embedding_hnsw_idx" ON "GeneratedQuestion" USING hnsw ("embedding" vector_cosine_ops)`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS "Question_embedding_hnsw_idx" ON "Question" USING hnsw ("embedding" vector_cosine_ops)`);
    } catch {
      // pgvector may be unavailable, or the tables may not exist yet on a fresh
      // database — migrate() handles creation; dedup is best-effort regardless.
    }

    // Migration 0044 adds the nullable User.last_activity_bell_opened_at
    // timestamp used by getBellBadgeCount to compute "rolled-off + unseen"
    // counts. Apply it idempotently in case the migration is recorded
    // without the column actually present.
    try {
      await db.execute(sql`
        ALTER TABLE "User"
          ADD COLUMN IF NOT EXISTS "last_activity_bell_opened_at" timestamp with time zone
      `);
    } catch {
      // User may not exist yet on a fresh database — migrate() creates it
      // before this migration runs.
    }

    // Migration 0045 introduces the public-facing User.handle plus the
    // handle_last_changed_at rate-limit anchor. Guard for preview/production
    // databases that may have this migration recorded without the column
    // or unique-lower index actually present.
    try {
      await db.execute(sql`
        ALTER TABLE "User"
          ADD COLUMN IF NOT EXISTS "handle" text
      `);
      await db.execute(sql`
        ALTER TABLE "User"
          ADD COLUMN IF NOT EXISTS "handle_last_changed_at" timestamp with time zone
      `);
      await db.execute(sql`
        CREATE UNIQUE INDEX IF NOT EXISTS "idx_users_handle_lower"
          ON "User" (LOWER("handle")) WHERE "handle" IS NOT NULL
      `);
    } catch {
      // User may not exist yet on a fresh database — migrate() creates it
      // before this migration runs.
    }

    // Migration 0046 adds the nullable User.avatar_color column. The value
    // is computed at signup via colorForUser(id) so the persisted color
    // matches what the runtime helper already renders. Guard for
    // preview/production databases that may have the migration recorded
    // without the column actually present.
    try {
      await db.execute(sql`
        ALTER TABLE "User"
          ADD COLUMN IF NOT EXISTS "avatar_color" text
      `);
    } catch {
      // User may not exist yet on a fresh database — migrate() creates it
      // before this migration runs.
    }

    // Migration 0047 added User.bio / .tagline / .location plus length
    // CHECKs. Migration 0054 drops all three columns + their CHECKs as part
    // of the profile redesign — no app code references them after 0054.
    // The 0047 guards have been removed accordingly; 0054 runs IF EXISTS
    // drops idempotently so a partially-recorded 0054 is still safe.

    // Migration 0048 adds the friends/privacy foundation:
    //   • User.discoverable_by_contacts / .discoverable_by_mutual_friends
    //     (default FALSE) — read by B-Friends-3/4 once those land.
    //   • ContactHash table — stores per-user SHA-256 contact hashes for
    //     the B-Friends-4 matching channel. Cascades on User delete.
    //   • Friendship extensions — personalNote (≤160), expiresAt,
    //     resolvedAt + two CHECKs (length, users distinct) + two partial
    //     indexes (expiry cron, declined/expired decay GC).
    // Guard for preview/production databases that may have the migration
    // recorded without the columns/table/constraints actually present.
    try {
      await db.execute(sql`
        ALTER TABLE "User"
          ADD COLUMN IF NOT EXISTS "discoverable_by_contacts" boolean NOT NULL DEFAULT false
      `);
      await db.execute(sql`
        ALTER TABLE "User"
          ADD COLUMN IF NOT EXISTS "discoverable_by_mutual_friends" boolean NOT NULL DEFAULT false
      `);
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS "ContactHash" (
          "userId"     text NOT NULL,
          "phoneHash"  text NOT NULL,
          "uploadedAt" timestamptz NOT NULL DEFAULT NOW(),
          PRIMARY KEY ("userId", "phoneHash")
        )
      `);
      await db.execute(sql`
        DO $$
        DECLARE
          hash_table regclass := to_regclass('public."ContactHash"');
          user_table regclass := to_regclass('public."User"');
        BEGIN
          IF hash_table IS NOT NULL
            AND user_table IS NOT NULL
            AND NOT EXISTS (
              SELECT 1 FROM pg_constraint
              WHERE conname = 'ContactHash_userId_User_id_fk'
                AND conrelid = hash_table
            )
          THEN
            ALTER TABLE "ContactHash"
              ADD CONSTRAINT "ContactHash_userId_User_id_fk"
              FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE;
          END IF;
        END $$
      `);
      await db.execute(sql`
        CREATE INDEX IF NOT EXISTS "ContactHash_phoneHash_idx"
          ON "ContactHash" ("phoneHash")
      `);
      await db.execute(sql`
        ALTER TABLE "Friendship"
          ADD COLUMN IF NOT EXISTS "personalNote" text
      `);
      await db.execute(sql`
        ALTER TABLE "Friendship"
          ADD COLUMN IF NOT EXISTS "expiresAt" timestamptz
      `);
      await db.execute(sql`
        ALTER TABLE "Friendship"
          ADD COLUMN IF NOT EXISTS "resolvedAt" timestamptz
      `);
      await db.execute(sql`
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM information_schema.table_constraints
            WHERE table_schema = 'public'
              AND table_name = 'Friendship'
              AND constraint_name = 'friendship_personal_note_length'
          ) THEN
            ALTER TABLE "Friendship"
              ADD CONSTRAINT friendship_personal_note_length
              CHECK (char_length("personalNote") <= 160);
          END IF;
          IF NOT EXISTS (
            SELECT 1 FROM information_schema.table_constraints
            WHERE table_schema = 'public'
              AND table_name = 'Friendship'
              AND constraint_name = 'friendship_users_distinct'
          ) THEN
            ALTER TABLE "Friendship"
              ADD CONSTRAINT friendship_users_distinct
              CHECK ("userAId" <> "userBId");
          END IF;
        END $$
      `);
      await db.execute(sql`
        CREATE INDEX IF NOT EXISTS "Friendship_expiresAt_pending_idx"
          ON "Friendship" ("expiresAt") WHERE status = 'pending'
      `);
      await db.execute(sql`
        CREATE INDEX IF NOT EXISTS "Friendship_resolvedAt_decay_idx"
          ON "Friendship" ("resolvedAt") WHERE status IN ('declined', 'expired')
      `);
    } catch {
      // User or Friendship may not exist yet on a fresh database — migrate()
      // creates the base tables before this migration runs.
    }

    // Migration 0049 adds the per-user invite token (users.invite_token)
    // used by /u/<handle>/<token> shareable links. Guard for preview/
    // production databases that may have the migration recorded without
    // the column or the unique partial index actually present.
    try {
      await db.execute(sql`
        ALTER TABLE "User"
          ADD COLUMN IF NOT EXISTS "invite_token" text
      `);
      await db.execute(sql`
        CREATE UNIQUE INDEX IF NOT EXISTS "idx_users_invite_token"
          ON "User" ("invite_token") WHERE "invite_token" IS NOT NULL
      `);
    } catch {
      // User may not exist yet on a fresh database — migrate() creates it
      // before this migration runs.
    }

    // Migration 0050 adds users.phone_hash (the user's own SHA-256(salt+E.164)
    // for the contact-hash match query) and users.last_friend_discovery_check_at
    // (the threshold for the Find Friends discovery dot + passive
    // Invitations-tab row). Guard for preview/production databases that may
    // have the migration recorded without the columns or index present.
    try {
      await db.execute(sql`
        ALTER TABLE "User"
          ADD COLUMN IF NOT EXISTS "phone_hash" text
      `);
      await db.execute(sql`
        ALTER TABLE "User"
          ADD COLUMN IF NOT EXISTS "last_friend_discovery_check_at" timestamptz
      `);
      await db.execute(sql`
        CREATE INDEX IF NOT EXISTS "idx_users_phone_hash"
          ON "User" ("phone_hash")
      `);
    } catch {
      // User may not exist yet on a fresh database — migrate() creates it
      // before this migration runs.
    }

    // Migration 0051 adds GeneratedQuestion.fact_key (nullable) plus the
    // (user_id, fact_key) lookup index used by the fact-level dedup in
    // persistGeneratedQuestion + the recent-fact-keys avoid list in
    // generateDailyQuestions. Guard for preview/production databases that may
    // have the migration recorded without the column or index actually present.
    try {
      await db.execute(sql`
        ALTER TABLE "GeneratedQuestion"
          ADD COLUMN IF NOT EXISTS "fact_key" text
      `);
      await db.execute(sql`
        CREATE INDEX IF NOT EXISTS "GeneratedQuestion_user_id_fact_key_idx"
          ON "GeneratedQuestion" ("user_id", "fact_key")
      `);
    } catch {
      // GeneratedQuestion may not exist yet on a fresh database — migrate()
      // creates it before this migration runs.
    }

    // Migration 0052 adds a 'friends' value to QuestionVisibility and creates
    // the PROFILE_SECTION_VISIBILITY table (with backfill from the legacy
    // User.portrait_visibility and User.authorProfilePublic columns). The
    // enum addition must be pre-applied here because Postgres forbids
    // referencing a newly-added enum value inside the same transaction that
    // adds it — Drizzle wraps the migrator in a transaction, so subsequent
    // code paths that read 'friends' from a preview database where 0052 is
    // recorded-but-not-fully-applied would 22P02 without this guard.
    try {
      await db.execute(sql`
        ALTER TYPE "public"."QuestionVisibility" ADD VALUE IF NOT EXISTS 'friends'
      `);
    } catch {
      // QuestionVisibility may not exist yet on a fresh database — migrate()
      // creates it before this migration runs.
    }
    try {
      await db.execute(sql`
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM pg_type t
            JOIN pg_namespace n ON n.oid = t.typnamespace
            WHERE t.typname = 'ProfileSection' AND n.nspname = 'public'
          ) THEN
            CREATE TYPE "public"."ProfileSection" AS ENUM(
              'bio', 'tagline', 'location',
              'knowledge_map', 'mind_expanding',
              'friends_list', 'authored_questions'
            );
          END IF;
        END $$
      `);
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS "PROFILE_SECTION_VISIBILITY" (
          "id"          text PRIMARY KEY DEFAULT gen_random_uuid()::text,
          "user_id"     text NOT NULL,
          "section"     "public"."ProfileSection" NOT NULL,
          "visibility"  text NOT NULL DEFAULT 'public',
          "updated_at"  timestamptz NOT NULL DEFAULT NOW(),
          CONSTRAINT "PROFILE_SECTION_VISIBILITY_visibility_check"
            CHECK ("visibility" IN ('public', 'friends', 'private'))
        )
      `);
      await db.execute(sql`
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint
            WHERE conname = 'PROFILE_SECTION_VISIBILITY_user_id_User_id_fk'
              AND conrelid = to_regclass('public."PROFILE_SECTION_VISIBILITY"')
          ) THEN
            ALTER TABLE "PROFILE_SECTION_VISIBILITY"
              ADD CONSTRAINT "PROFILE_SECTION_VISIBILITY_user_id_User_id_fk"
              FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE;
          END IF;
        END $$
      `);
      await db.execute(sql`
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint
            WHERE conname = 'PROFILE_SECTION_VISIBILITY_user_id_section_key'
              AND conrelid = to_regclass('public."PROFILE_SECTION_VISIBILITY"')
          ) THEN
            ALTER TABLE "PROFILE_SECTION_VISIBILITY"
              ADD CONSTRAINT "PROFILE_SECTION_VISIBILITY_user_id_section_key"
              UNIQUE ("user_id", "section");
          END IF;
        END $$
      `);
      await db.execute(sql`
        CREATE INDEX IF NOT EXISTS "PROFILE_SECTION_VISIBILITY_user_id_idx"
          ON "PROFILE_SECTION_VISIBILITY" ("user_id")
      `);
    } catch {
      // User table may not exist yet on a fresh database — migrate() creates
      // both User and PROFILE_SECTION_VISIBILITY before this migration runs.
    }

    // Migration 0061 creates the EmailVerificationToken table that backs the
    // /verify-email confirm-link flow. The send + confirm routes hit this
    // table on every email-verification request, so a preview/production
    // database with the migration recorded but the table missing would 42P01
    // before migrate() could repair it. Pre-create the table, FK, and
    // indexes idempotently outside the migrator transaction.
    try {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS "EmailVerificationToken" (
          "id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
          "user_id" text NOT NULL,
          "email" text NOT NULL,
          "token_hash" text NOT NULL,
          "expires_at" timestamp with time zone NOT NULL,
          "consumed_at" timestamp with time zone,
          "created_at" timestamp with time zone DEFAULT now() NOT NULL
        )
      `);
      await db.execute(sql`
        DO $$
        DECLARE
          token_table regclass := to_regclass('public."EmailVerificationToken"');
          user_table regclass := to_regclass('public."User"');
        BEGIN
          IF token_table IS NOT NULL
            AND user_table IS NOT NULL
            AND NOT EXISTS (
              SELECT 1 FROM pg_constraint
              WHERE conname = 'EmailVerificationToken_user_id_User_id_fk'
                AND conrelid = token_table
            )
          THEN
            ALTER TABLE "EmailVerificationToken"
              ADD CONSTRAINT "EmailVerificationToken_user_id_User_id_fk"
              FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE;
          END IF;
        END $$
      `);
      await db.execute(sql`
        CREATE UNIQUE INDEX IF NOT EXISTS "EmailVerificationToken_token_hash_key"
          ON "EmailVerificationToken" ("token_hash")
      `);
      await db.execute(sql`
        CREATE INDEX IF NOT EXISTS "EmailVerificationToken_user_id_idx"
          ON "EmailVerificationToken" ("user_id")
      `);
    } catch {
      // User table may not exist yet on a fresh database — migrate() creates
      // it before this migration runs.
    }

    // Migration 0054 adds a 'knowledge_base' value to ProfileSection (which
    // collapses the legacy 'knowledge_map' and 'mind_expanding' sections into
    // one) and drops User.bio / .tagline / .location plus their CHECKs. The
    // enum addition must be pre-applied here because Postgres forbids
    // referencing a newly-added enum value inside the same transaction that
    // adds it — Drizzle wraps the migrator in a transaction, so the
    // backfill INSERT inside 0054 would 22P02 without this guard.
    try {
      await db.execute(sql`
        ALTER TYPE "public"."ProfileSection" ADD VALUE IF NOT EXISTS 'knowledge_base'
      `);
    } catch {
      // ProfileSection may not exist yet on a fresh database — migrate()
      // creates it before this migration runs.
    }

    // Migration 0055 adds GeneratedQuestion.sub_angles (text[]) for positive
    // sub-angle guidance in daily question generation. Guard for preview/
    // production databases that may have the migration recorded without the
    // column actually present — code paths that select sub_angles would 42703
    // before app code can recover.
    try {
      await db.execute(sql`
        ALTER TABLE "GeneratedQuestion"
          ADD COLUMN IF NOT EXISTS "sub_angles" text[] NOT NULL DEFAULT '{}'
      `);
    } catch {
      // GeneratedQuestion may not exist yet on a fresh database — migrate()
      // creates it before this migration runs.
    }

    // Migration 0056 adds the nullable User.area_top_up_prompt_dismissed_at
    // timestamp. It records that a user dismissed (or completed) the one-time
    // "add two more areas" prompt shown to invite-seeded users who only have
    // three declared interests. Guard for preview/production databases that may
    // have the migration recorded without the column actually present — the
    // GET /api/declared-interests/top-up eligibility query selects it and would
    // 42703 before app code can recover.
    try {
      await db.execute(sql`
        ALTER TABLE "User"
          ADD COLUMN IF NOT EXISTS "area_top_up_prompt_dismissed_at" timestamp with time zone
      `);
    } catch {
      // User may not exist yet on a fresh database — migrate() creates it
      // before this migration runs.
    }

    // Migration 0058 (D-1 Stage 3) introduces the directional Follow model:
    // the FollowState/FollowPrivacy enums, the User.follow_privacy column, the
    // Follow table, and a backfill from the frozen Friendship table. Guard for
    // preview/production databases that may have the migration recorded without
    // the objects present — relationship reads now go through Follow and would
    // 42P01/42703/42704 before app code can recover. Backfills are
    // ON CONFLICT DO NOTHING, so this whole block is safe to re-run.
    try {
      await db.execute(sql`
        DO $$ BEGIN
          CREATE TYPE "public"."FollowState" AS ENUM('pending', 'approved');
        EXCEPTION WHEN duplicate_object THEN NULL;
        END $$
      `);
      await db.execute(sql`
        DO $$ BEGIN
          CREATE TYPE "public"."FollowPrivacy" AS ENUM('public', 'approval_required');
        EXCEPTION WHEN duplicate_object THEN NULL;
        END $$
      `);
      await db.execute(sql`
        ALTER TABLE "User"
          ADD COLUMN IF NOT EXISTS "follow_privacy" "public"."FollowPrivacy" NOT NULL DEFAULT 'approval_required'
      `);
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS "Follow" (
          "id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
          "followerId" text NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
          "followeeId" text NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
          "state" "public"."FollowState" NOT NULL DEFAULT 'pending',
          "personalNote" text,
          "requestContext" jsonb,
          "created_at" timestamptz NOT NULL DEFAULT now(),
          "approvedAt" timestamptz,
          CONSTRAINT "Follow_followerId_followeeId_key" UNIQUE ("followerId", "followeeId"),
          CONSTRAINT "Follow_distinct_users" CHECK ("followerId" <> "followeeId")
        )
      `);
      await db.execute(sql`
        CREATE INDEX IF NOT EXISTS "Follow_followerId_state_idx" ON "Follow" ("followerId", "state")
      `);
      await db.execute(sql`
        CREATE INDEX IF NOT EXISTS "Follow_followeeId_state_idx" ON "Follow" ("followeeId", "state")
      `);
      await db.execute(sql`
        INSERT INTO "Follow" ("id", "followerId", "followeeId", "state", "approvedAt", "created_at")
        SELECT gen_random_uuid()::text, "userAId", "userBId", 'approved'::"public"."FollowState",
               COALESCE("formedAt", now()), "createdAt"
        FROM "Friendship" WHERE "status" = 'active'
        ON CONFLICT ("followerId", "followeeId") DO NOTHING
      `);
      await db.execute(sql`
        INSERT INTO "Follow" ("id", "followerId", "followeeId", "state", "approvedAt", "created_at")
        SELECT gen_random_uuid()::text, "userBId", "userAId", 'approved'::"public"."FollowState",
               COALESCE("formedAt", now()), "createdAt"
        FROM "Friendship" WHERE "status" = 'active'
        ON CONFLICT ("followerId", "followeeId") DO NOTHING
      `);
      await db.execute(sql`
        INSERT INTO "Follow" ("id", "followerId", "followeeId", "state", "personalNote", "requestContext", "created_at")
        SELECT gen_random_uuid()::text,
               "requestedByUserId",
               CASE WHEN "requestedByUserId" = "userAId" THEN "userBId" ELSE "userAId" END,
               'pending'::"public"."FollowState",
               "personalNote", "requestContext", "createdAt"
        FROM "Friendship" WHERE "status" = 'pending'
        ON CONFLICT ("followerId", "followeeId") DO NOTHING
      `);
    } catch {
      // User or Friendship may not exist yet on a fresh database — migrate()
      // creates them and applies 0058 in normal order.
    }

    // Migration 0059 (D-2 WS1) adds User.discoverable_by_niche_match, the third
    // discoverability flag. Additive boolean with a default — the safe case.
    // TEST-PHASE default is ON (DEFAULT true): the whole cohort, including
    // pre-existing users, is enrolled in the niche-match test. The production
    // default is an OPEN DECISION to revisit after the test; default-ON here is
    // deliberate for the test cohort only. Guard for preview/production
    // databases that may have the migration recorded without the column present.
    try {
      await db.execute(sql`
        ALTER TABLE "User"
          ADD COLUMN IF NOT EXISTS "discoverable_by_niche_match" boolean NOT NULL DEFAULT true
      `);
    } catch {
      // User may not exist yet on a fresh database — migrate() creates it
      // before this migration runs.
    }

    // Migration 0064 (Refine Your Game) adds USER_DOMAIN_DIFFICULTY.freeze_until.
    // adaptive-difficulty.ts reads it on every answer to decide whether the
    // served difficulty is pinned, so a preview/production database with the
    // migration recorded but the column missing would error before migrate()
    // could repair it. Additive nullable column — pre-apply it idempotently.
    try {
      await db.execute(sql`
        ALTER TABLE "USER_DOMAIN_DIFFICULTY"
          ADD COLUMN IF NOT EXISTS "freeze_until" timestamp with time zone
      `);
    } catch {
      // USER_DOMAIN_DIFFICULTY may not exist yet on a fresh database —
      // migrate() creates it before this migration runs.
    }

    // Migration 0065 (Refine Your Game) creates DAILY_REFINE_DECISION, the
    // decision + cooldown ledger behind the daily-summary refine section. The
    // summary builder, the resolve/undo route, and the next-daily commit hook
    // all read this table, so a preview/production database with the migration
    // recorded but the table missing would 42P01 before migrate() could repair
    // it. Pre-create the table, FKs, and indexes idempotently.
    try {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS "DAILY_REFINE_DECISION" (
          "id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
          "user_id" text NOT NULL,
          "queue_id" text NOT NULL,
          "item_type" text NOT NULL,
          "canonical_subcategory" text NOT NULL,
          "friend_id" text,
          "action" text NOT NULL DEFAULT 'pending',
          "committed_at" timestamp with time zone,
          "cooldown_until" timestamp with time zone,
          "created_at" timestamp with time zone DEFAULT now() NOT NULL,
          "updated_at" timestamp with time zone DEFAULT now() NOT NULL
        )
      `);
      await db.execute(sql`
        DO $$
        DECLARE
          decision_table regclass := to_regclass('public."DAILY_REFINE_DECISION"');
          user_table regclass := to_regclass('public."User"');
          queue_table regclass := to_regclass('public."DailyQueue"');
        BEGIN
          IF decision_table IS NOT NULL
            AND user_table IS NOT NULL
            AND NOT EXISTS (
              SELECT 1 FROM pg_constraint
              WHERE conname = 'DAILY_REFINE_DECISION_user_id_User_id_fk'
                AND conrelid = decision_table
            )
          THEN
            ALTER TABLE "DAILY_REFINE_DECISION"
              ADD CONSTRAINT "DAILY_REFINE_DECISION_user_id_User_id_fk"
              FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE;
          END IF;

          IF decision_table IS NOT NULL
            AND queue_table IS NOT NULL
            AND NOT EXISTS (
              SELECT 1 FROM pg_constraint
              WHERE conname = 'DAILY_REFINE_DECISION_queue_id_DailyQueue_id_fk'
                AND conrelid = decision_table
            )
          THEN
            ALTER TABLE "DAILY_REFINE_DECISION"
              ADD CONSTRAINT "DAILY_REFINE_DECISION_queue_id_DailyQueue_id_fk"
              FOREIGN KEY ("queue_id") REFERENCES "DailyQueue"("id") ON DELETE CASCADE;
          END IF;
        END $$
      `);
      await db.execute(sql`
        CREATE UNIQUE INDEX IF NOT EXISTS "DAILY_REFINE_DECISION_unique_item"
          ON "DAILY_REFINE_DECISION" ("user_id", "queue_id", "item_type", "canonical_subcategory", COALESCE("friend_id", ''))
      `);
      await db.execute(sql`
        CREATE INDEX IF NOT EXISTS "DAILY_REFINE_DECISION_cooldown_idx"
          ON "DAILY_REFINE_DECISION" ("user_id", "item_type", "canonical_subcategory", "cooldown_until")
      `);
      await db.execute(sql`
        CREATE INDEX IF NOT EXISTS "DAILY_REFINE_DECISION_uncommitted_idx"
          ON "DAILY_REFINE_DECISION" ("user_id", "committed_at")
      `);
    } catch {
      // User or DailyQueue may not exist yet on a fresh database — migrate()
      // creates them before this migration runs.
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
