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

    // Migration 0017 adds the 'creator_note_received' SmsMessageType enum value
    // and creates the CreatorNote table with its FKs and indexes. If a preview/
    // production database has this migration recorded without the table actually
    // present, the daily summary query (and every creator-notes route) fails with
    // Postgres 42P01 before migrate() can repair it. Pre-apply each piece
    // idempotently outside the migrator transaction.
    try {
      await db.execute(sql`
        ALTER TYPE "public"."SmsMessageType" ADD VALUE IF NOT EXISTS 'creator_note_received'
      `);
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS "CreatorNote" (
          "id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
          "authorUserId" text NOT NULL,
          "recipientUserId" text NOT NULL,
          "questionId" text NOT NULL,
          "contextType" text NOT NULL,
          "contextId" text,
          "noteText" text NOT NULL,
          "promptedAt" timestamp with time zone DEFAULT now() NOT NULL,
          "writtenAt" timestamp with time zone,
          "deliveredAt" timestamp with time zone,
          "created_at" timestamp with time zone DEFAULT now() NOT NULL
        )
      `);
      await db.execute(sql`
        DO $$
        DECLARE
          note_table regclass := to_regclass('public."CreatorNote"');
          user_table regclass := to_regclass('public."User"');
        BEGIN
          IF note_table IS NOT NULL
            AND user_table IS NOT NULL
            AND NOT EXISTS (
              SELECT 1 FROM pg_constraint
              WHERE conname = 'CreatorNote_authorUserId_User_id_fk'
                AND conrelid = note_table
            )
          THEN
            ALTER TABLE "CreatorNote"
              ADD CONSTRAINT "CreatorNote_authorUserId_User_id_fk"
              FOREIGN KEY ("authorUserId") REFERENCES "User"("id") ON DELETE cascade;
          END IF;
        END $$
      `);
      await db.execute(sql`
        DO $$
        DECLARE
          note_table regclass := to_regclass('public."CreatorNote"');
          user_table regclass := to_regclass('public."User"');
        BEGIN
          IF note_table IS NOT NULL
            AND user_table IS NOT NULL
            AND NOT EXISTS (
              SELECT 1 FROM pg_constraint
              WHERE conname = 'CreatorNote_recipientUserId_User_id_fk'
                AND conrelid = note_table
            )
          THEN
            ALTER TABLE "CreatorNote"
              ADD CONSTRAINT "CreatorNote_recipientUserId_User_id_fk"
              FOREIGN KEY ("recipientUserId") REFERENCES "User"("id") ON DELETE cascade;
          END IF;
        END $$
      `);
      await db.execute(sql`
        DO $$
        DECLARE
          note_table regclass := to_regclass('public."CreatorNote"');
          question_table regclass := to_regclass('public."Question"');
        BEGIN
          IF note_table IS NOT NULL
            AND question_table IS NOT NULL
            AND NOT EXISTS (
              SELECT 1 FROM pg_constraint
              WHERE conname = 'CreatorNote_questionId_Question_id_fk'
                AND conrelid = note_table
            )
          THEN
            ALTER TABLE "CreatorNote"
              ADD CONSTRAINT "CreatorNote_questionId_Question_id_fk"
              FOREIGN KEY ("questionId") REFERENCES "Question"("id") ON DELETE cascade;
          END IF;
        END $$
      `);
      await db.execute(sql`
        CREATE INDEX IF NOT EXISTS "CreatorNote_authorUserId_promptedAt_idx"
        ON "CreatorNote" USING btree ("authorUserId","promptedAt")
      `);
      await db.execute(sql`
        CREATE INDEX IF NOT EXISTS "CreatorNote_recipientUserId_questionId_idx"
        ON "CreatorNote" USING btree ("recipientUserId","questionId")
      `);
      await db.execute(sql`
        CREATE INDEX IF NOT EXISTS "CreatorNote_questionId_idx"
        ON "CreatorNote" USING btree ("questionId")
      `);
    } catch {
      // SmsMessageType, User, or Question may not exist yet on a fresh database
      // — migrate() creates them before 0017 runs.
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
          ADD COLUMN IF NOT EXISTS "quip" text,
          ADD COLUMN IF NOT EXISTS "catchupResolvedAt" timestamptz
      `);
    } catch {
      // FeedItem table may not exist yet — migrate() handles initial creation.
    }

    // Migration 0016 also adds the nullable "quip" column to JoshingGameResponse
    // alongside the FeedItem.quip add above. If a preview/production database has
    // 0016 recorded with only one of the two ALTERs applied, Drizzle selects
    // joining JoshingGameResponse fail with Postgres 42703 (e.g. the knowledge
    // domain detail query) before migrate() gets a chance to repair it.
    try {
      await db.execute(sql`
        ALTER TABLE "JoshingGameResponse"
          ADD COLUMN IF NOT EXISTS "quip" text
      `);
    } catch {
      // JoshingGameResponse may not exist yet — migrate() handles initial creation.
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

    // Migration 0047 adds the editable profile fields: bio (≤280),
    // tagline (≤80), location (≤60). All nullable; when bio is NULL the
    // existing formatBio() default in src/server/profile/bio.ts still
    // renders. Guard for preview/production databases that may have the
    // migration recorded without the columns or CHECK constraints
    // actually present.
    try {
      await db.execute(sql`
        ALTER TABLE "User"
          ADD COLUMN IF NOT EXISTS "bio" text
      `);
      await db.execute(sql`
        ALTER TABLE "User"
          ADD COLUMN IF NOT EXISTS "tagline" text
      `);
      await db.execute(sql`
        ALTER TABLE "User"
          ADD COLUMN IF NOT EXISTS "location" text
      `);
      await db.execute(sql`
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM information_schema.table_constraints
            WHERE table_schema = 'public'
              AND table_name = 'User'
              AND constraint_name = 'user_bio_length'
          ) THEN
            ALTER TABLE "User"
              ADD CONSTRAINT user_bio_length CHECK (char_length("bio") <= 280);
          END IF;
          IF NOT EXISTS (
            SELECT 1 FROM information_schema.table_constraints
            WHERE table_schema = 'public'
              AND table_name = 'User'
              AND constraint_name = 'user_tagline_length'
          ) THEN
            ALTER TABLE "User"
              ADD CONSTRAINT user_tagline_length CHECK (char_length("tagline") <= 80);
          END IF;
          IF NOT EXISTS (
            SELECT 1 FROM information_schema.table_constraints
            WHERE table_schema = 'public'
              AND table_name = 'User'
              AND constraint_name = 'user_location_length'
          ) THEN
            ALTER TABLE "User"
              ADD CONSTRAINT user_location_length CHECK (char_length("location") <= 60);
          END IF;
        END $$
      `);
    } catch {
      // User may not exist yet on a fresh database — migrate() creates it
      // before this migration runs.
    }

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
    // used by /invite/<handle>/<token> shareable links. Guard for preview/
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
