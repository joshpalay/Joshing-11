export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // Per-process guard: register() runs once at startup, but guard against any
    // double-invocation (e.g. dev hot-reload) so the boot DB work below can
    // never run twice within a single process.
    const globalForBoot = globalThis as unknown as { __joshingBootRan?: boolean };
    if (globalForBoot.__joshingBootRan) return;
    globalForBoot.__joshingBootRan = true;

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

    // RESEND_API_KEY + EMAIL_FROM back the email-verification confirm-link
    // (src/server/email/client.ts). The client never throws — if either is
    // missing it silently logs to stdout and returns missing_config, so a
    // misconfigured production deploy drops every verification email with no
    // user-visible error. Warn loudly at boot so the gap surfaces here rather
    // than as silently-undelivered mail. (Warning only, like PHONE_HASH_SALT
    // above — throwing would 500 every request via the instrumentation hook.)
    if (process.env.NODE_ENV === 'production') {
      const missingEmailVars = [
        !process.env.RESEND_API_KEY && 'RESEND_API_KEY',
        !process.env.EMAIL_FROM && 'EMAIL_FROM',
      ].filter(Boolean);
      if (missingEmailVars.length > 0) {
        console.error(
          `[instrumentation] ${missingEmailVars.join(' and ')} not set in production; email verification will silently no-op. Set both, and ensure EMAIL_FROM's domain matches a Verified domain in Resend.`,
        );
      }
    }

    const { migrate } = await import('drizzle-orm/node-postgres/migrator');
    const { drizzle } = await import('drizzle-orm/node-postgres');
    const { Pool } = await import('pg');
    const { sql } = await import('drizzle-orm');
    const path = await import('path');
    const fs = await import('fs');
    const crypto = await import('crypto');

    // Bound how long a cold boot will wait on the DB. A degraded cold connection
    // (observed: Supabase/PgBouncer EAUTHTIMEOUT / SQLSTATE 08006 at 17:05 UTC on
    // 2026-06-26) otherwise stalls the very first connect for ~20 minutes, and the
    // migrate() below inherits that stall — consuming the entire function budget
    // before any request work runs (the daily-assignments cron was killed at its
    // 300s maxDuration having built only ~6 of 17 users; D-NARROW-KB-FABRICATION-01).
    // connectionTimeoutMillis makes a hung connect fail in seconds instead of
    // minutes; it has no effect on a healthy connection. Override via
    // BOOT_DB_CONNECT_TIMEOUT_MS (0/unset → 10s default).
    const bootConnectTimeoutMs = Number(process.env.BOOT_DB_CONNECT_TIMEOUT_MS) > 0
      ? Number(process.env.BOOT_DB_CONNECT_TIMEOUT_MS)
      : 10_000;
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      connectionTimeoutMillis: bootConnectTimeoutMs,
    });
    const db = drizzle(pool);

    // Ride out a transient cold-connection blip before the guards/migrate. The
    // EAUTHTIMEOUT / SQLSTATE 08006 that took down the 2026-06-26 cron boot is
    // INTERMITTENT — a flaky first connect against Supabase/PgBouncer that a short
    // retry clears. We probe `select 1` (cheap, and it warms the pool so the
    // guards/migrate below reuse a live connection) up to BOOT_DB_CONNECT_RETRIES
    // times with linear backoff. Each attempt is bounded by connectionTimeoutMillis
    // above, so the worst case here is retries × (~timeout + backoff), not minutes.
    // Fail-open: if every attempt fails we still proceed — the guards are each
    // try/caught and migrate() is timeout-bounded, so boot never hard-blocks on a
    // flaky DB. Override the count via BOOT_DB_CONNECT_RETRIES (0/unset → 3).
    const bootConnectRetries = Number(process.env.BOOT_DB_CONNECT_RETRIES) > 0
      ? Number(process.env.BOOT_DB_CONNECT_RETRIES)
      : 3;
    for (let attempt = 1; attempt <= bootConnectRetries; attempt += 1) {
      try {
        await db.execute(sql`select 1`);
        if (attempt > 1) {
          console.info('[instrumentation] DB connection established on retry', { attempt });
        }
        break;
      } catch (err) {
        if (attempt >= bootConnectRetries) {
          console.error(
            `[instrumentation] DB connection failed after ${bootConnectRetries} attempts; proceeding anyway (guards are best-effort, migrate is timeout-bounded).`,
            err,
          );
          break;
        }
        const backoffMs = attempt * 500;
        console.warn(
          `[instrumentation] DB connection attempt ${attempt}/${bootConnectRetries} failed; retrying in ${backoffMs}ms`,
          { error: err instanceof Error ? err.message : String(err) },
        );
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
      }
    }

    // The idempotent guard blocks below pre-repair partially-recorded preview/
    // production databases so migrate() can succeed on them (additive columns,
    // enum values, and tables that a recorded-but-not-fully-applied migration
    // may be missing). On a database that already carries every change they are
    // pure overhead: ~70 sequential round-trips on every cold start, which
    // dominates cold-start latency — the first request after a boot (e.g.
    // POST /api/auth/request-otp) waits behind the whole chain.
    //
    // Set SKIP_BOOT_DB_GUARDS=1 to skip the chain; migrate() still runs
    // afterwards, and every migration through the head is journaled in
    // drizzle/meta/_journal.json, so migrate() applies them all on a fresh DB
    // and the guards are now purely defensive redundancy. Leave the flag unset
    // in preview/dev so the auto-repair guards keep running. Always journal new
    // migrations (keep _journal.json in lockstep with drizzle/*.sql) rather
    // than relying on a guard as a migration's only application path. See
    // CLAUDE.md.
    const runBootGuards = process.env.SKIP_BOOT_DB_GUARDS !== '1';
    // Boot-cost telemetry (B-GRADE-COLDSTART-01): the guard chain is the
    // suspected dominant cold-start cost that the first request waits behind.
    // Measure guard-chain vs migrate() time so the estimate becomes a number and
    // the SKIP_BOOT_DB_GUARDS trade-off can be judged on real data.
    const guardChainStartedAt = Date.now();
    if (runBootGuards) {
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
      // Area Expansion (0094): the expansion write records a zero-point
      // MASTERY_EVENTS row with this source type. Pre-add it so a
      // recorded-but-not-fully-applied 0094 can't 22P02 the insert.
      await db.execute(sql`
        ALTER TYPE "public"."MasterySourceType" ADD VALUE IF NOT EXISTS 'expansion'
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
      // B-DOMAIN-BONUS-ROTATION-01 (migration 0094): gate +2 bonus domains out of
      // the core rotation until adopted. Additive, default true → no behaviour
      // change for existing rows.
      await db.execute(sql`
        ALTER TABLE "PLAYER_MASTERY"
          ADD COLUMN IF NOT EXISTS "rotation_eligible" boolean NOT NULL DEFAULT true
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

    // B-QUESTION-QUALITY-AGENTS-01 (migration 0096): batch-verification stamp on
    // both question stores + the needs_review demote status. All additive and
    // nullable, so pre-applying is a no-op on a fully-migrated DB and repairs a
    // partially-recorded one before migrate() / app reads touch the columns
    // (precedent: the territory_type + DomainExclusionScope guards above/below).
    try {
      await db.execute(sql`
        DO $$ BEGIN
          CREATE TYPE "public"."QuestionVerificationVerdict" AS ENUM('ok', 'demoted', 'unverifiable', 'skipped');
        EXCEPTION WHEN duplicate_object THEN NULL;
        END $$
      `);
      await db.execute(sql`
        ALTER TYPE "public"."PublicStatus" ADD VALUE IF NOT EXISTS 'needs_review'
      `);
      await db.execute(sql`
        ALTER TABLE "Question"
          ADD COLUMN IF NOT EXISTS "verified_at" timestamptz,
          ADD COLUMN IF NOT EXISTS "verification_verdict" "public"."QuestionVerificationVerdict"
      `);
      await db.execute(sql`
        ALTER TABLE "GeneratedQuestion"
          ADD COLUMN IF NOT EXISTS "verified_at" timestamptz,
          ADD COLUMN IF NOT EXISTS "verification_verdict" "public"."QuestionVerificationVerdict"
      `);
      // B-CRAFTER-LIFECYCLE-01 (migration 0100): the verifier's verdict reason,
      // shown on the admin review queue's machine-demotion cards. Additive +
      // nullable — same repair rationale as the 0096 columns above.
      await db.execute(sql`
        ALTER TABLE "Question" ADD COLUMN IF NOT EXISTS "verification_reason" text
      `);
      await db.execute(sql`
        ALTER TABLE "GeneratedQuestion" ADD COLUMN IF NOT EXISTS "verification_reason" text
      `);
    } catch {
      // Question / GeneratedQuestion / PublicStatus may not exist yet on a fresh
      // DB — migrate() creates them and 0096 adds these pieces.
    }

    // B-QUESTION-QUALITY-AGENTS-01 (migration 0097): the stored quality-aggregation
    // digest table. New + isolated; RLS-enabled with no policies (owner role
    // bypasses RLS) per B-SECURITY-RLS-01. Idempotent so a partially-recorded DB
    // still boots before the weekly cron's insert (precedent: 0092 LlmCostReport).
    try {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS "QualityReport" (
          "id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
          "period_start" timestamp with time zone NOT NULL,
          "period_end" timestamp with time zone NOT NULL,
          "window_days" integer NOT NULL DEFAULT 30,
          "markdown" text NOT NULL,
          "created_at" timestamp with time zone NOT NULL DEFAULT now()
        )
      `);
      await db.execute(sql`ALTER TABLE "QualityReport" ENABLE ROW LEVEL SECURITY`);
      await db.execute(sql`
        CREATE INDEX IF NOT EXISTS "QualityReport_created_at_idx" ON "QualityReport" ("created_at")
      `);
    } catch {
      // Best-effort pre-create; migrate() creates it on a fresh DB.
    }

    // B-CRAFTER-LIFECYCLE-01 (migration 0101): the per-(player, domain) manual
    // author-invitation table. New + isolated; RLS-enabled with no policies
    // (owner role bypasses RLS) per B-SECURITY-RLS-01. Idempotent (precedent:
    // the 0097 QualityReport guard above).
    try {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS "AuthorInvitation" (
          "id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
          "user_id" text NOT NULL REFERENCES "User"("id"),
          "domain" text NOT NULL,
          "reason" text NOT NULL DEFAULT 'domain_exhausted',
          "invited_by" text NOT NULL REFERENCES "User"("id"),
          "created_at" timestamp with time zone NOT NULL DEFAULT now(),
          "seen_at" timestamp with time zone,
          "door_choice" text,
          "resolved_at" timestamp with time zone
        )
      `);
      await db.execute(sql`ALTER TABLE "AuthorInvitation" ENABLE ROW LEVEL SECURITY`);
      await db.execute(sql`
        CREATE UNIQUE INDEX IF NOT EXISTS "AuthorInvitation_active_user_domain_key"
          ON "AuthorInvitation" ("user_id", "domain") WHERE "resolved_at" IS NULL
      `);
      await db.execute(sql`
        CREATE INDEX IF NOT EXISTS "AuthorInvitation_user_id_idx" ON "AuthorInvitation" ("user_id")
      `);
    } catch {
      // Best-effort pre-create; migrate() creates it on a fresh DB.
    }

    // B-CRAFTER-DECISION-LEDGER-01 (migration 0103): the keep/kill teaching
    // ledger for machine draft candidates. New + isolated; RLS-enabled with no
    // policies (owner role bypasses RLS) per B-SECURITY-RLS-01. Idempotent
    // (precedent: the 0101 AuthorInvitation guard above).
    try {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS "CrafterDraftDecision" (
          "id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
          "decider_id" text NOT NULL REFERENCES "User"("id"),
          "domain" text NOT NULL,
          "tier" text NOT NULL CHECK ("tier" IN ('shallow', 'deep')),
          "question_text" text NOT NULL,
          "answer" text NOT NULL,
          "decision" text NOT NULL CHECK ("decision" IN ('kept', 'killed')),
          "flags" jsonb NOT NULL DEFAULT '[]'::jsonb,
          "edited_answer" text,
          "question_id" text REFERENCES "Question"("id"),
          "created_at" timestamp with time zone NOT NULL DEFAULT now()
        )
      `);
      await db.execute(sql`ALTER TABLE "CrafterDraftDecision" ENABLE ROW LEVEL SECURITY`);
      await db.execute(sql`
        CREATE INDEX IF NOT EXISTS "CrafterDraftDecision_domain_idx" ON "CrafterDraftDecision" ("domain")
      `);
      await db.execute(sql`
        CREATE INDEX IF NOT EXISTS "CrafterDraftDecision_decider_id_idx" ON "CrafterDraftDecision" ("decider_id")
      `);
    } catch {
      // Best-effort pre-create; migrate() creates it on a fresh DB.
    }

    // B-KNOWLEDGE-TAXONOMY-01 P1 (migration 0102_knowledge_graph): the
    // leaf/parent knowledge-graph tables (KnowledgeNode + KnowledgeEdge). New +
    // isolated; RLS-enabled with no policies (owner role bypasses RLS) per
    // B-SECURITY-RLS-01. Idempotent (precedent: 0097/0101 guards above).
    // Structure only — dark until KNOWLEDGE_GRAPH_* flags flip.
    try {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS "KnowledgeNode" (
          "id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
          "label" text NOT NULL,
          "domain_key" text NOT NULL,
          "node_kind" text NOT NULL DEFAULT 'leaf' CHECK ("node_kind" IN ('leaf', 'parent', 'both')),
          "mastery_threshold" integer,
          "broad_category" text,
          "field_hue" text,
          "created_at" timestamp with time zone NOT NULL DEFAULT now()
        )
      `);
      await db.execute(sql`ALTER TABLE "KnowledgeNode" ENABLE ROW LEVEL SECURITY`);
      await db.execute(sql`
        CREATE UNIQUE INDEX IF NOT EXISTS "KnowledgeNode_domain_key_key" ON "KnowledgeNode" ("domain_key")
      `);
      // B-KNOWLEDGE-ADMIN-01 P3 (migration 0107): Wikidata provenance on
      // ratified nodes. Additive nullable column — same repair rationale as
      // the 0105 web_search_requests guard.
      await db.execute(sql`
        ALTER TABLE "KnowledgeNode" ADD COLUMN IF NOT EXISTS "wikidata_qid" text
      `);
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS "KnowledgeEdge" (
          "id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
          "child_domain_key" text NOT NULL,
          "parent_domain_key" text NOT NULL,
          "created_at" timestamp with time zone NOT NULL DEFAULT now()
        )
      `);
      await db.execute(sql`ALTER TABLE "KnowledgeEdge" ENABLE ROW LEVEL SECURITY`);
      await db.execute(sql`
        CREATE UNIQUE INDEX IF NOT EXISTS "KnowledgeEdge_child_parent_key"
          ON "KnowledgeEdge" ("child_domain_key", "parent_domain_key")
      `);
      await db.execute(sql`
        CREATE INDEX IF NOT EXISTS "KnowledgeEdge_parent_domain_key_idx" ON "KnowledgeEdge" ("parent_domain_key")
      `);
      await db.execute(sql`
        CREATE INDEX IF NOT EXISTS "KnowledgeEdge_child_domain_key_idx" ON "KnowledgeEdge" ("child_domain_key")
      `);
      // B-KNOWLEDGE-TAXONOMY-01 P4 (migration 0104): the parent-mastery freeze
      // ledger — same idempotent shape.
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS "KnowledgeParentMastery" (
          "id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
          "user_id" text NOT NULL REFERENCES "User"("id"),
          "parent_domain_key" text NOT NULL,
          "mastered_at" timestamp with time zone NOT NULL DEFAULT now()
        )
      `);
      await db.execute(sql`ALTER TABLE "KnowledgeParentMastery" ENABLE ROW LEVEL SECURITY`);
      await db.execute(sql`
        CREATE UNIQUE INDEX IF NOT EXISTS "KnowledgeParentMastery_user_parent_key"
          ON "KnowledgeParentMastery" ("user_id", "parent_domain_key")
      `);
      await db.execute(sql`
        CREATE INDEX IF NOT EXISTS "KnowledgeParentMastery_user_id_idx" ON "KnowledgeParentMastery" ("user_id")
      `);
      // Mastery v2 (migration 0111): the leaf-mastery freeze ledger — same
      // idempotent shape as the parent ledger above.
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS "KnowledgeLeafMastery" (
          "id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
          "user_id" text NOT NULL REFERENCES "User"("id"),
          "leaf_domain_key" text NOT NULL,
          "mastered_at" timestamp with time zone NOT NULL DEFAULT now()
        )
      `);
      await db.execute(sql`ALTER TABLE "KnowledgeLeafMastery" ENABLE ROW LEVEL SECURITY`);
      await db.execute(sql`
        CREATE UNIQUE INDEX IF NOT EXISTS "KnowledgeLeafMastery_user_leaf_key"
          ON "KnowledgeLeafMastery" ("user_id", "leaf_domain_key")
      `);
      await db.execute(sql`
        CREATE INDEX IF NOT EXISTS "KnowledgeLeafMastery_user_id_idx" ON "KnowledgeLeafMastery" ("user_id")
      `);
    } catch {
      // Best-effort pre-create; migrate() creates them on a fresh DB.
    }

    // B-SUPPLY-REFILL-THROUGHPUT-01 follow-up (migration 0098): per-domain refill
    // health for adaptive timeout exclusion. New + isolated; RLS-enabled with no
    // policies (owner role bypasses RLS). Idempotent so a partially-recorded DB
    // still boots before runPoolRefill's first upsert (precedent: 0097).
    try {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS "RetrievalDomainHealth" (
          "domain" text PRIMARY KEY,
          "consecutive_timeouts" integer NOT NULL DEFAULT 0,
          "last_timeout_at" timestamp with time zone,
          "last_success_at" timestamp with time zone,
          "updated_at" timestamp with time zone NOT NULL DEFAULT now()
        )
      `);
      await db.execute(sql`ALTER TABLE "RetrievalDomainHealth" ENABLE ROW LEVEL SECURITY`);
      await db.execute(sql`
        CREATE INDEX IF NOT EXISTS "RetrievalDomainHealth_cooldown_idx" ON "RetrievalDomainHealth" ("consecutive_timeouts", "last_timeout_at")
      `);
    } catch {
      // Best-effort pre-create; migrate() creates it on a fresh DB.
    }

    // D-NEARNESS-LADDER-HYBRID-01 (migration 0099): the global near-ness tree cache.
    // New + isolated; RLS-enabled with no policies (owner role bypasses RLS).
    // Idempotent so a partially-recorded DB boots before the first tree write.
    try {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS "DomainRelation" (
          "id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
          "child_domain" text NOT NULL,
          "related_domain" text NOT NULL,
          "broad_category" text,
          "rung" text NOT NULL CHECK ("rung" IN ('sibling', 'cousin', 'parent', 'grandparent')),
          "source" text NOT NULL CHECK ("source" IN ('curated', 'llm')),
          "created_at" timestamp with time zone NOT NULL DEFAULT now()
        )
      `);
      await db.execute(sql`ALTER TABLE "DomainRelation" ENABLE ROW LEVEL SECURITY`);
      await db.execute(sql`
        CREATE UNIQUE INDEX IF NOT EXISTS "DomainRelation_child_related_key" ON "DomainRelation" ("child_domain", "related_domain")
      `);
      await db.execute(sql`
        CREATE INDEX IF NOT EXISTS "DomainRelation_child_domain_idx" ON "DomainRelation" ("child_domain")
      `);
    } catch {
      // Best-effort pre-create; migrate() creates it on a fresh DB.
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
      // Question.surface_priority_score (migration 0024's runtime hotfix,
      // journaled later): some preview databases have the feed migrations
      // recorded without this column actually present. This guard replaces
      // the lazy ALTER-on-first-query shim that used to live in
      // src/server/db/queries/questions.ts — boot guards belong here, not in
      // the query layer.
      await db.execute(sql`
        ALTER TABLE "Question"
          ADD COLUMN IF NOT EXISTS "surface_priority_score" DOUBLE PRECISION NOT NULL DEFAULT 0
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

    // Migration 0075 adds DailyQueue.email_reminder_sent_at, the per-queue
    // idempotency marker the daily-assignments cron claims before sending a
    // reminder email. A preview/production DB that records 0075 without the
    // column present would make the cron's claim UPDATE fail; pre-apply it
    // idempotently (precedent: 0074's domain_key guard above).
    try {
      await db.execute(sql`
        ALTER TABLE "DailyQueue"
          ADD COLUMN IF NOT EXISTS "email_reminder_sent_at" timestamptz
      `);
    } catch {
      // DailyQueue table may not exist yet — migrate() handles initial creation.
    }

    // Migration 0077 adds EmailVerificationToken.opt_in_on_confirm — the
    // "turn reminders on when this link is confirmed" intent the onboarding
    // beat sets and consumeVerificationToken reads. A preview/production DB
    // that records 0077 without the column present would break token consume;
    // pre-apply it idempotently (precedent: 0075's guard above).
    try {
      await db.execute(sql`
        ALTER TABLE "EmailVerificationToken"
          ADD COLUMN IF NOT EXISTS "opt_in_on_confirm" boolean NOT NULL DEFAULT false
      `);
    } catch {
      // EmailVerificationToken may not exist yet — migrate() handles initial creation.
    }

    // Migration 0080 adds Question.author_deleted — the account-deletion
    // tombstone marker (D-ACCOUNT-DELETION-TERRITORY-01). A preview/production DB
    // that records 0080 without the column present would break the deletion path
    // (deleteUserAccount sets author_deleted = true when tombstoning an author's
    // questions) and any tombstone-aware read; pre-apply it idempotently
    // (precedent: 0077's opt_in_on_confirm guard above).
    try {
      await db.execute(sql`
        ALTER TABLE "Question"
          ADD COLUMN IF NOT EXISTS "author_deleted" boolean NOT NULL DEFAULT false
      `);
      await db.execute(sql`
        CREATE INDEX IF NOT EXISTS "Question_author_deleted_idx"
          ON "Question" ("author_deleted")
          WHERE "author_deleted" = true
      `);
    } catch {
      // Question table may not exist yet — migrate() handles initial creation.
    }

    // Migration 0084 adds FeedItem.viaUserId (the two-hop forward-relay source,
    // D-4 via-attribution) and User.discoverable_by_forward (its consent gate).
    // A preview/production DB that records 0084 without these columns present
    // would break feed reads that select viaUserId and the discoverability gate;
    // pre-apply them idempotently (precedent: 0080's author_deleted guard above).
    // The FK constraint is not re-added here — migrate() adds it on fresh DBs and
    // it is not needed for read safety.
    try {
      await db.execute(sql`
        ALTER TABLE "User"
          ADD COLUMN IF NOT EXISTS "discoverable_by_forward" boolean NOT NULL DEFAULT true
      `);
      await db.execute(sql`
        ALTER TABLE "FeedItem"
          ADD COLUMN IF NOT EXISTS "viaUserId" text
      `);
      await db.execute(sql`
        CREATE INDEX IF NOT EXISTS "FeedItem_viaUserId_idx" ON "FeedItem" ("viaUserId")
      `);
    } catch {
      // User / FeedItem may not exist yet — migrate() handles initial creation.
    }

    // Migration 0085 adds FeedItem.answeredAt — the true answer time the Answered
    // archive (readFeedItems) sorts on, replacing the sourceEventAt (send-time)
    // fallback that buried recently-answered cards below the first page. A
    // preview/production DB that records 0085 without the column present would
    // break the answer writes (feed/answer, lately/milestone/answer set it) and
    // the archive read; pre-apply it idempotently (precedent: 0084's viaUserId
    // guard above). The historical backfill is left to migrate() — it is not
    // needed for read safety.
    try {
      await db.execute(sql`
        ALTER TABLE "FeedItem"
          ADD COLUMN IF NOT EXISTS "answeredAt" timestamptz
      `);
    } catch {
      // FeedItem table may not exist yet — migrate() handles initial creation.
    }

    // Migration 0086 adds GeneratedQuestion.subject_entity + Question.subject_entity
    // — the primary subject feeding the Tier 2 subject-cooldown gate. The generator
    // writes it and persistGeneratedQuestion carries it onto the canonical row; a
    // preview/production DB that records 0086 without the columns present would
    // break those writes. Pre-apply idempotently (precedent: 0085 above). The
    // historical backfill (scripts/backfill-subject-entity.ts) is separate and not
    // needed for read/write safety — a NULL subject_entity just means "no signal".
    try {
      await db.execute(sql`
        ALTER TABLE "GeneratedQuestion"
          ADD COLUMN IF NOT EXISTS "subject_entity" text
      `);
      await db.execute(sql`
        ALTER TABLE "Question"
          ADD COLUMN IF NOT EXISTS "subject_entity" text
      `);
    } catch {
      // Tables may not exist yet — migrate() handles initial creation.
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

    // Migration 0124 (D-DOMAIN-REST-01) adds a nullable rest_until column to
    // USER_DOMAIN_EXCLUSIONS: the game-summary "Rest a topic" action writes an
    // exclusion with an expiry instead of a permanent one. The queue-build read
    // path (getExcludedKnowledgeDomains) references this column, so a
    // preview/production database that records the migration without the column
    // present would fail there before migrate() can repair it. Additive +
    // nullable — same repair rationale as the 0036 scope guard above.
    try {
      await db.execute(sql`
        ALTER TABLE "USER_DOMAIN_EXCLUSIONS"
          ADD COLUMN IF NOT EXISTS "rest_until" timestamptz
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

    // Migration 0067 (B4 Phase 2) adds Question.nobody_correct_flag (the "nobody
    // got it" review smell) + its partial index. App code (the questions view,
    // evaluateQuestionTrustOnPlay) reads the column, so a database that records
    // the migration without it present must still boot. The one-time trust
    // back-fills (author_confirmed correction + human_validated promotion) are
    // applied by the migration only — not re-run here — because they are pure data
    // back-fill (a missing promotion is safe/conservative, never a boot blocker)
    // and re-aggregating MASTERY_EVENTS on every boot would be wasteful.
    try {
      await db.execute(sql`ALTER TABLE "Question" ADD COLUMN IF NOT EXISTS "nobody_correct_flag" boolean NOT NULL DEFAULT false`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS "Question_nobody_correct_flag_idx" ON "Question" ("nobody_correct_flag") WHERE "nobody_correct_flag" = true`);
    } catch {
      // Question may not exist yet on a fresh database — migrate() creates it
      // before this migration runs.
    }

    // Migration 0068 (B4 Phase 4) adds GeneratedQuestion.acceptable_variants —
    // equivalent answer phrasings honored in grading. App code (generation persist
    // + the daily/catchup answer routes) reads it, so a database that records the
    // migration without the column present must still boot.
    try {
      await db.execute(sql`ALTER TABLE "GeneratedQuestion" ADD COLUMN IF NOT EXISTS "acceptable_variants" text[] NOT NULL DEFAULT '{}'`);
    } catch {
      // GeneratedQuestion may not exist yet on a fresh database — migrate()
      // creates it before this migration runs.
    }

    // Migration 0074 (BP-7 / C5) adds GeneratedQuestion.domain_key — the TS
    // domainKey() fold of canonical_subcategory, matched by the bank lookup so
    // spelling variants share stock — plus its lookup index. All pool write
    // paths set it and pickBankSource reads it, so a database that records the
    // migration without the column present must still boot (precedent: the
    // 0068 acceptable_variants guard above).
    try {
      await db.execute(sql`ALTER TABLE "GeneratedQuestion" ADD COLUMN IF NOT EXISTS "domain_key" text`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS "GeneratedQuestion_domain_key_difficulty_idx" ON "GeneratedQuestion" ("domain_key", "difficulty_estimate")`);
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

    // Migration 0071 enables pg_trgm, which convergeDomain()'s fuzzy pass calls
    // via similarity() (the /api/knowledge/converge route + the onboarding seed
    // pipeline). similarity() needs no index, so none is created — see the
    // migration header. A database that records the migration without the
    // extension present must still boot; if pg_trgm is unavailable the whole
    // block is skipped — convergence degrades to exact-key + "create new".
    try {
      await db.execute(sql`CREATE EXTENSION IF NOT EXISTS pg_trgm`);
    } catch {
      // pg_trgm may be unavailable on this database — convergence is best-effort.
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
    // Migration 0069 adds a 'blocked' value to QuestionVisibility for questions
    // that fail the safety vet. Pre-applied here for the same reason as 'friends'
    // above: code paths that read/compare 'blocked' from a preview database where
    // 0069 is recorded-but-not-fully-applied would 22P02 without this guard.
    try {
      await db.execute(sql`
        ALTER TYPE "public"."QuestionVisibility" ADD VALUE IF NOT EXISTS 'blocked'
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
    // timestamp. It recorded that a user dismissed (or completed) the one-time
    // "add two more areas" prompt. That prompt was removed (onboarding now lets
    // a new user pick up to 12 areas directly, so the top-up nudge is no longer
    // needed), but the column is retained as a harmless orphan to keep schema
    // parity and avoid a destructive migration on existing databases. The guard
    // stays so partially-recorded preview/production databases don't 42703.
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

    // Migration 0089 adds USER_DOMAIN_DIFFICULTY.expansion_eligible_since and
    // .expansion_offered_at for the post-daily-Five expansion offer. The daily
    // summary reads them to decide whether to surface "you're crushing X — branch
    // out?", so a preview/production database with the migration recorded but the
    // columns missing would error. Additive nullable columns — pre-apply
    // idempotently.
    try {
      await db.execute(sql`
        ALTER TABLE "USER_DOMAIN_DIFFICULTY"
          ADD COLUMN IF NOT EXISTS "expansion_eligible_since" timestamp with time zone
      `);
      await db.execute(sql`
        ALTER TABLE "USER_DOMAIN_DIFFICULTY"
          ADD COLUMN IF NOT EXISTS "expansion_offered_at" timestamp with time zone
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

    // Migration 0070 adds DailyPreference.domain_preference_frequency (jsonb,
    // NOT NULL default '{}'). getDailyPreferences() selects it from the home
    // server component and the whole daily flow, so a database that records the
    // migration without the column present would 42703 before migrate() could
    // repair it (see digest 1273321541). Additive column with a default —
    // pre-apply it idempotently.
    try {
      await db.execute(sql`
        ALTER TABLE "DailyPreference"
          ADD COLUMN IF NOT EXISTS "domain_preference_frequency" jsonb NOT NULL DEFAULT '{}'::jsonb
      `);
    } catch {
      // DailyPreference may not exist yet on a fresh database — migrate()
      // creates it before this migration runs.
    }

    // Migration 0072 (B-FirstRecap-1) adds the nullable
    // User.first_session_recap_seen_at timestamp. The first-session recap
    // orchestrator (GET /api/daily/first-session-recap) and the seen-marker
    // (POST .../seen) both read/write it on the post-summary path, so a
    // preview/production database with the migration recorded but the column
    // missing would 42703 before migrate() could repair it. Additive nullable
    // column with no default — pre-apply it idempotently.
    try {
      await db.execute(sql`
        ALTER TABLE "User"
          ADD COLUMN IF NOT EXISTS "first_session_recap_seen_at" timestamp with time zone
      `);
    } catch {
      // User may not exist yet on a fresh database — migrate() creates it
      // before this migration runs.
    }

    // Migration 0076 (B-FirstGameRecap-1) adds the nullable
    // User.first_game_recap_seen_at timestamp. The first-game recap endpoint
    // reads it on the game-summary path, so pre-apply this additive nullable
    // column idempotently for databases whose migration journal got ahead of
    // the physical column.
    try {
      await db.execute(sql`
        ALTER TABLE "User"
          ADD COLUMN IF NOT EXISTS "first_game_recap_seen_at" timestamp with time zone
      `);
    } catch {
      // User may not exist yet on a fresh database — migrate() creates it
      // before this migration runs.
    }

    // Migration 0073 (B-Report-1) adds the ContentReport table + its three
    // enums (ContentReportCategory / ContentReportIncorrectKind /
    // ContentReportStatus). Purely additive substrate — nothing reads it yet
    // (B-Report-2 onward wires it up) — but a preview/production database that
    // records the migration without the objects present must still boot, and a
    // newly-added enum value/type referenced inside the migrator transaction
    // can 22P02/42704, so create the enums, table, FKs, CHECKs, and indexes
    // idempotently outside that transaction. Re-running is a no-op.
    try {
      await db.execute(sql`
        DO $$ BEGIN
          CREATE TYPE "public"."ContentReportCategory" AS ENUM('incorrect', 'inappropriate');
        EXCEPTION WHEN duplicate_object THEN NULL;
        END $$
      `);
      await db.execute(sql`
        DO $$ BEGIN
          CREATE TYPE "public"."ContentReportIncorrectKind" AS ENUM('answer_key', 'premise');
        EXCEPTION WHEN duplicate_object THEN NULL;
        END $$
      `);
      await db.execute(sql`
        DO $$ BEGIN
          CREATE TYPE "public"."ContentReportStatus" AS ENUM('open', 'upheld', 'dismissed');
        EXCEPTION WHEN duplicate_object THEN NULL;
        END $$
      `);
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS "ContentReport" (
          "id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
          "reporter_user_id" text NOT NULL,
          "question_id" text,
          "generated_question_id" text,
          "category" "public"."ContentReportCategory" NOT NULL,
          "incorrect_kind" "public"."ContentReportIncorrectKind",
          "note" text NOT NULL,
          "suggested_answer" text,
          "surface" text,
          "status" "public"."ContentReportStatus" NOT NULL DEFAULT 'open',
          "review_decision" text,
          "review_reason" text,
          "reviewed_at" timestamp with time zone,
          "created_at" timestamp with time zone DEFAULT now() NOT NULL,
          CONSTRAINT "ContentReport_one_target"
            CHECK ((question_id IS NOT NULL)::int + (generated_question_id IS NOT NULL)::int = 1),
          CONSTRAINT "ContentReport_incorrect_kind_scope"
            CHECK (incorrect_kind IS NULL OR category = 'incorrect')
        )
      `);
      await db.execute(sql`
        DO $$
        DECLARE
          report_table regclass := to_regclass('public."ContentReport"');
          user_table regclass := to_regclass('public."User"');
          question_table regclass := to_regclass('public."Question"');
          generated_question_table regclass := to_regclass('public."GeneratedQuestion"');
        BEGIN
          IF report_table IS NOT NULL
            AND user_table IS NOT NULL
            AND NOT EXISTS (
              SELECT 1 FROM pg_constraint
              WHERE conname = 'ContentReport_reporter_user_id_User_id_fk'
                AND conrelid = report_table
            )
          THEN
            ALTER TABLE "ContentReport"
              ADD CONSTRAINT "ContentReport_reporter_user_id_User_id_fk"
              FOREIGN KEY ("reporter_user_id") REFERENCES "User"("id");
          END IF;

          IF report_table IS NOT NULL
            AND question_table IS NOT NULL
            AND NOT EXISTS (
              SELECT 1 FROM pg_constraint
              WHERE conname = 'ContentReport_question_id_Question_id_fk'
                AND conrelid = report_table
            )
          THEN
            ALTER TABLE "ContentReport"
              ADD CONSTRAINT "ContentReport_question_id_Question_id_fk"
              FOREIGN KEY ("question_id") REFERENCES "Question"("id");
          END IF;

          IF report_table IS NOT NULL
            AND generated_question_table IS NOT NULL
            AND NOT EXISTS (
              SELECT 1 FROM pg_constraint
              WHERE conname = 'ContentReport_generated_question_id_GeneratedQuestion_id_fk'
                AND conrelid = report_table
            )
          THEN
            ALTER TABLE "ContentReport"
              ADD CONSTRAINT "ContentReport_generated_question_id_GeneratedQuestion_id_fk"
              FOREIGN KEY ("generated_question_id") REFERENCES "GeneratedQuestion"("id");
          END IF;
        END $$
      `);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS "ContentReport_reporter_user_id_idx" ON "ContentReport" ("reporter_user_id")`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS "ContentReport_question_id_idx" ON "ContentReport" ("question_id")`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS "ContentReport_generated_question_id_idx" ON "ContentReport" ("generated_question_id")`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS "ContentReport_status_idx" ON "ContentReport" ("status")`);
      await db.execute(sql`
        CREATE UNIQUE INDEX IF NOT EXISTS "ContentReport_one_open_per_question"
          ON "ContentReport" ("reporter_user_id", "question_id")
          WHERE status = 'open' AND question_id IS NOT NULL
      `);
      await db.execute(sql`
        CREATE UNIQUE INDEX IF NOT EXISTS "ContentReport_one_open_per_generated_question"
          ON "ContentReport" ("reporter_user_id", "generated_question_id")
          WHERE status = 'open' AND generated_question_id IS NOT NULL
      `);
    } catch {
      // User, Question, or GeneratedQuestion may not exist yet on a fresh
      // database — migrate() creates them before this migration runs.
    }

    // Migration 0078 adds two composite lookup indexes on hot read paths: the
    // "Lately" convergence lookback (MASTERY_EVENTS user_id+source_type+
    // answer_state+created_at) and the friends-visibility EXISTS on the feed
    // path (Follow followerId+followeeId+state). Pure index additions — a
    // preview/production database that records the migration without the
    // indexes present must still get them (precedent: 0074's domain_key index
    // guard). CREATE INDEX IF NOT EXISTS is idempotent; re-running is a no-op.
    try {
      await db.execute(sql`
        CREATE INDEX IF NOT EXISTS "MASTERY_EVENTS_user_id_source_type_answer_state_created_at_idx"
          ON "MASTERY_EVENTS" ("user_id", "source_type", "answer_state", "created_at")
      `);
    } catch {
      // MASTERY_EVENTS may not exist yet on a fresh database — migrate()
      // creates it before this migration runs.
    }
    try {
      await db.execute(sql`
        CREATE INDEX IF NOT EXISTS "Follow_followerId_followeeId_state_idx"
          ON "Follow" ("followerId", "followeeId", "state")
      `);
    } catch {
      // Follow may not exist yet on a fresh database — migrate() creates it
      // before this migration runs.
    }

    // Migration 0079 adds covering indexes for four hot-path foreign keys
    // (FeedItem.questionId / sourceUserId / joshingGameId, ActivityItem
    // .actorUserId) on the Feed-load and From-Friends read paths. Pure index
    // additions — a preview/production database that records the migration
    // without the indexes present must still get them (precedent: 0078).
    // CREATE INDEX IF NOT EXISTS is idempotent; re-running is a no-op.
    try {
      await db.execute(sql`CREATE INDEX IF NOT EXISTS "FeedItem_questionId_idx" ON "FeedItem" ("questionId")`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS "FeedItem_sourceUserId_idx" ON "FeedItem" ("sourceUserId")`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS "FeedItem_joshingGameId_idx" ON "FeedItem" ("joshingGameId")`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS "ActivityItem_actorUserId_idx" ON "ActivityItem" ("actorUserId")`);
    } catch {
      // FeedItem / ActivityItem may not exist yet on a fresh database —
      // migrate() creates them before this migration runs.
    }

    // Migration 0082 adds the composite index backing the Questions-tab list
    // (getBankedQuestions: filter user_id, ORDER BY added_at DESC). Pure index
    // addition — a preview/production database that records the migration
    // without the index present must still get it (precedent: 0079).
    // CREATE INDEX IF NOT EXISTS is idempotent; re-running is a no-op.
    try {
      await db.execute(sql`
        CREATE INDEX IF NOT EXISTS "UserQuestionBank_user_id_added_at_idx"
          ON "UserQuestionBank" ("user_id", "added_at")
      `);
    } catch {
      // UserQuestionBank may not exist yet on a fresh database — migrate()
      // creates it before this migration runs.
    }

    // Migration 0083 adds covering indexes for the cold-path foreign keys the
    // Supabase advisor flags as unindexed (lint 0001). Pure, idempotent index
    // additions — a preview/production database that records the migration
    // without them present must still get them (precedent: 0079, 0082). Each
    // CREATE INDEX IF NOT EXISTS is a no-op when the index already exists.
    try {
      await db.execute(sql`CREATE INDEX IF NOT EXISTS "DAILY_REFINE_DECISION_queue_id_idx" ON "DAILY_REFINE_DECISION" ("queue_id")`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS "FriendInvitation_inviteeUserId_idx" ON "FriendInvitation" ("inviteeUserId")`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS "Friendship_requestedByUserId_idx" ON "Friendship" ("requestedByUserId")`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS "Friendship_removedByUserId_idx" ON "Friendship" ("removedByUserId")`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS "JoshingGameQuestion_questionId_idx" ON "JoshingGameQuestion" ("questionId")`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS "JoshingGameResponse_questionId_idx" ON "JoshingGameResponse" ("questionId")`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS "SkippedDailyQuestion_question_id_idx" ON "SkippedDailyQuestion" ("question_id")`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS "SkippedDailyQuestion_generated_question_id_idx" ON "SkippedDailyQuestion" ("generated_question_id")`);
    } catch {
      // These tables may not exist yet on a fresh database — migrate() creates
      // them (and the same indexes) before/at this migration.
    }

    // Migration 0087 (B-LLM-PROVIDER-AB-SWITCH B2) creates the AppSettings
    // single-row global settings table for the provider A/B switch. A
    // preview/production database that records the migration without the table
    // present would 42P01 when getProviderSettings() reads it. Create it
    // idempotently (with RLS + the seed row) so the read always finds a row.
    // Precedent: 0073 (ContentReport). Self-contained — depends on no other table.
    try {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS "AppSettings" (
          "id" text PRIMARY KEY DEFAULT 'singleton' NOT NULL,
          "gen_provider" text NOT NULL DEFAULT 'anthropic',
          "categorize_provider" text NOT NULL DEFAULT 'anthropic',
          "suggest_provider" text NOT NULL DEFAULT 'anthropic',
          "grade_provider" text NOT NULL DEFAULT 'anthropic',
          "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
          CONSTRAINT "AppSettings_singleton" CHECK (id = 'singleton'),
          CONSTRAINT "AppSettings_gen_provider_valid" CHECK (gen_provider IN ('anthropic', 'openai')),
          CONSTRAINT "AppSettings_categorize_provider_valid" CHECK (categorize_provider IN ('anthropic', 'openai')),
          CONSTRAINT "AppSettings_suggest_provider_valid" CHECK (suggest_provider IN ('anthropic', 'openai')),
          CONSTRAINT "AppSettings_grade_provider_valid" CHECK (grade_provider IN ('anthropic', 'openai'))
        )
      `);
      await db.execute(sql`ALTER TABLE "AppSettings" ENABLE ROW LEVEL SECURITY`);
      await db.execute(sql`INSERT INTO "AppSettings" ("id") VALUES ('singleton') ON CONFLICT ("id") DO NOTHING`);
    } catch {
      // Non-fatal — migrate() creates the table from 0087 immediately after.
    }

    // Migration 0088 (B-LLM-PROVIDER-AB-SWITCH B3) adds provider-provenance
    // columns to three existing tables. A preview/production database that
    // records the migration without the columns present would 42703 when a
    // stamped write references them. Add them idempotently (additive, nullable,
    // no default — precedent: 0085/0086). Each ADD COLUMN IF NOT EXISTS no-ops
    // when the column already exists.
    try {
      await db.execute(sql`ALTER TABLE "GeneratedQuestion" ADD COLUMN IF NOT EXISTS "generated_by_provider" text`);
      await db.execute(sql`ALTER TABLE "Question" ADD COLUMN IF NOT EXISTS "categorize_provider" text`);
      await db.execute(sql`ALTER TABLE "MASTERY_EVENTS" ADD COLUMN IF NOT EXISTS "llm_provider" text`);
    } catch {
      // These tables may not exist yet on a fresh database — migrate() creates
      // them (with these columns) before/at this migration.
    }

    // Migrations 0090 + 0091 (B-LLM-PROVIDER-AB-METRICS) create the provider
    // flip log and per-call usage tables. A preview/production database that
    // records the migrations without the tables present would 42P01 when the
    // PATCH route logs a flip or recordLlmUsage() inserts a row. Create them
    // idempotently (with RLS + indexes). Both are self-contained — they depend
    // on no other table. Precedent: 0087.
    try {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS "LlmProviderChangeLog" (
          "id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
          "surface" text NOT NULL,
          "from_provider" text NOT NULL,
          "to_provider" text NOT NULL,
          "changed_by_user_id" text,
          "created_at" timestamp with time zone NOT NULL DEFAULT now(),
          CONSTRAINT "LlmProviderChangeLog_surface_valid" CHECK (surface IN ('gen', 'categorize', 'suggest', 'grade')),
          CONSTRAINT "LlmProviderChangeLog_from_valid" CHECK (from_provider IN ('anthropic', 'openai')),
          CONSTRAINT "LlmProviderChangeLog_to_valid" CHECK (to_provider IN ('anthropic', 'openai'))
        )
      `);
      await db.execute(sql`ALTER TABLE "LlmProviderChangeLog" ENABLE ROW LEVEL SECURITY`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS "LlmProviderChangeLog_created_at_idx" ON "LlmProviderChangeLog" ("created_at")`);
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS "LlmUsageEvent" (
          "id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
          "scope" text NOT NULL,
          "provider" text NOT NULL,
          "model" text NOT NULL,
          "input_tokens" integer NOT NULL DEFAULT 0,
          "output_tokens" integer NOT NULL DEFAULT 0,
          "cache_read_tokens" integer NOT NULL DEFAULT 0,
          "cache_create_tokens" integer NOT NULL DEFAULT 0,
          "duration_ms" integer,
          "created_at" timestamp with time zone NOT NULL DEFAULT now(),
          CONSTRAINT "LlmUsageEvent_provider_valid" CHECK (provider IN ('anthropic', 'openai'))
        )
      `);
      await db.execute(sql`ALTER TABLE "LlmUsageEvent" ENABLE ROW LEVEL SECURITY`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS "LlmUsageEvent_provider_created_at_idx" ON "LlmUsageEvent" ("provider", "created_at")`);
      // Migration 0105: per-call web-search request count, so search spend
      // (~$0.01/request, a separate Anthropic meter) is ledgered instead of
      // invisible (ledger-telemetry-gaps.md gap (a)). Additive with a DEFAULT —
      // same repair rationale as the 0100 verification_reason guard.
      await db.execute(sql`
        ALTER TABLE "LlmUsageEvent" ADD COLUMN IF NOT EXISTS "web_search_requests" integer NOT NULL DEFAULT 0
      `);
      // Migration 0106: batch-verify async mode — the VerifyBatchRun tracking
      // table (the cron would 42P01 on harvest/submit if the migration recorded
      // without the table) + the is_batch discount marker on LlmUsageEvent.
      // Same rationale as the 0090/0091 guards above.
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS "VerifyBatchRun" (
          "id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
          "provider_batch_id" text NOT NULL,
          "status" text NOT NULL DEFAULT 'submitted',
          "request_count" integer NOT NULL DEFAULT 0,
          "harvested_at" timestamp with time zone,
          "created_at" timestamp with time zone NOT NULL DEFAULT now(),
          CONSTRAINT "VerifyBatchRun_status_valid" CHECK (status IN ('submitted', 'harvested', 'failed'))
        )
      `);
      await db.execute(sql`ALTER TABLE "VerifyBatchRun" ENABLE ROW LEVEL SECURITY`);
      await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS "VerifyBatchRun_provider_batch_id_key" ON "VerifyBatchRun" ("provider_batch_id")`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS "VerifyBatchRun_status_idx" ON "VerifyBatchRun" ("status")`);
      await db.execute(sql`
        ALTER TABLE "LlmUsageEvent" ADD COLUMN IF NOT EXISTS "is_batch" boolean NOT NULL DEFAULT false
      `);
      // Migration 0108 (D-FANDOM-GROUNDING-01): the per-domain reference-passage
      // cache. The generation cron would 42P01 on its cache read/upsert if the
      // migration recorded without the table. Self-contained; same rationale as
      // the 0090/0091/0106 guards above.
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS "DomainReferencePassage" (
          "id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
          "canonical_subcategory" text NOT NULL,
          "source" text NOT NULL,
          "passage" text,
          "source_url" text,
          "fetched_at" timestamp with time zone NOT NULL DEFAULT now(),
          "created_at" timestamp with time zone NOT NULL DEFAULT now(),
          CONSTRAINT "DomainReferencePassage_source_valid" CHECK (source IN ('wikipedia', 'fandom', 'none'))
        )
      `);
      await db.execute(sql`ALTER TABLE "DomainReferencePassage" ENABLE ROW LEVEL SECURITY`);
      await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS "DomainReferencePassage_domain_key" ON "DomainReferencePassage" ("canonical_subcategory")`);
      // Migration 0092 (B-LLM-COST-LATENCY-REPORT-01) stores the weekly cost &
      // latency digest. The llm-cost-report cron would 42P01 on insert if the
      // migration recorded without the table present. Self-contained; precedent: 0091.
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS "LlmCostReport" (
          "id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
          "period_start" timestamp with time zone NOT NULL,
          "period_end" timestamp with time zone NOT NULL,
          "window_days" integer NOT NULL DEFAULT 7,
          "markdown" text NOT NULL,
          "created_at" timestamp with time zone NOT NULL DEFAULT now()
        )
      `);
      await db.execute(sql`ALTER TABLE "LlmCostReport" ENABLE ROW LEVEL SECURITY`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS "LlmCostReport_created_at_idx" ON "LlmCostReport" ("created_at")`);
      // Migration 0114 (D-SUPPLY-FINITE-SET-01 P2): the durable set-completion
      // designation + system-created (inviterless) author invitations. The daily
      // summary evaluates completion and would error on the missing column /
      // NOT NULL constraint if the migration recorded without these. Both
      // idempotent (ADD COLUMN IF NOT EXISTS / DROP NOT NULL is a no-op if already
      // relaxed). Same rationale as the 0105/0106 guards above.
      await db.execute(sql`
        ALTER TABLE "PLAYER_MASTERY" ADD COLUMN IF NOT EXISTS "designated_at" timestamp with time zone
      `);
      await db.execute(sql`ALTER TABLE "AuthorInvitation" ALTER COLUMN "invited_by" DROP NOT NULL`);
      // Migration 0115 (D-QUALITY-SALVAGE-01): machine-proposed salvage fixes for
      // demoted questions. The salvage batch + review queue read/insert here and
      // would 42P01 if the migration recorded without the table. Self-contained;
      // same rationale as the 0103 CrafterDraftDecision guard.
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS "QuestionSalvageProposal" (
          "id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
          "question_id" text NOT NULL,
          "target_table" text NOT NULL,
          "kind" text NOT NULL,
          "proposed_stem" text,
          "proposed_explanation" text,
          "reverify_outcome" text NOT NULL,
          "reverify_reason" text,
          "status" text NOT NULL DEFAULT 'ready',
          "created_at" timestamp with time zone NOT NULL DEFAULT now()
        )
      `);
      await db.execute(sql`ALTER TABLE "QuestionSalvageProposal" ENABLE ROW LEVEL SECURITY`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS "QuestionSalvageProposal_question_id_idx" ON "QuestionSalvageProposal" ("question_id")`);
      await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS "QuestionSalvageProposal_active_question_key" ON "QuestionSalvageProposal" ("question_id") WHERE "status" = 'ready'`);
      // Migration 0116 (D-DIFFICULTY-SIZE-COMPLETION-01): cached topic depth score
      // that set-completion sizes the completable set from. evaluateSetCompletions
      // would 42P01 on read if the migration recorded without the table. Self-
      // contained; same rationale as the 0108 DomainReferencePassage guard.
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS "DomainDepthEstimate" (
          "id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
          "domain_key" text NOT NULL,
          "depth_score" integer,
          "sample_label" text,
          "source" text NOT NULL DEFAULT 'llm',
          "computed_at" timestamp with time zone NOT NULL DEFAULT now(),
          "created_at" timestamp with time zone NOT NULL DEFAULT now()
        )
      `);
      await db.execute(sql`ALTER TABLE "DomainDepthEstimate" ENABLE ROW LEVEL SECURITY`);
      await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS "DomainDepthEstimate_domain_key" ON "DomainDepthEstimate" ("domain_key")`);
      // Migration 0117 (D-SUPPLY-FINITENESS-01): corpus-grounded size columns on
      // DomainDepthEstimate. Additive + nullable; getTargetQuestionCountForDomains
      // reads estimated_questions and would 42703 on an un-migrated DB. Same guard
      // rationale as the 0116 block above.
      await db.execute(sql`ALTER TABLE "DomainDepthEstimate" ADD COLUMN IF NOT EXISTS "estimated_questions" integer`);
      await db.execute(sql`ALTER TABLE "DomainDepthEstimate" ADD COLUMN IF NOT EXISTS "corpus_count" integer`);
      await db.execute(sql`ALTER TABLE "DomainDepthEstimate" ADD COLUMN IF NOT EXISTS "shape" text`);
      await db.execute(sql`ALTER TABLE "DomainDepthEstimate" ADD COLUMN IF NOT EXISTS "confidence" text`);
      await db.execute(sql`ALTER TABLE "DomainDepthEstimate" ADD COLUMN IF NOT EXISTS "basis" text`);
      await db.execute(sql`ALTER TABLE "DomainDepthEstimate" ADD COLUMN IF NOT EXISTS "wikipedia_title" text`);
      await db.execute(sql`ALTER TABLE "DomainDepthEstimate" ADD COLUMN IF NOT EXISTS "wikidata_qid" text`);
      await db.execute(sql`ALTER TABLE "DomainDepthEstimate" ADD COLUMN IF NOT EXISTS "fandom_host" text`);
      await db.execute(sql`ALTER TABLE "DomainDepthEstimate" ADD COLUMN IF NOT EXISTS "resolved_at" timestamp with time zone`);
      // Migration 0118 (D-SUPPLY-FINITENESS-01 #4): dry-round observation
      // counters for the supply-state machine. Additive + nullable/defaulted.
      await db.execute(sql`ALTER TABLE "DomainDepthEstimate" ADD COLUMN IF NOT EXISTS "consecutive_dry_rounds" integer NOT NULL DEFAULT 0`);
      await db.execute(sql`ALTER TABLE "DomainDepthEstimate" ADD COLUMN IF NOT EXISTS "last_yield_at" timestamp with time zone`);
      // Migration 0119: admin manual estimate override + co-calibration stamp.
      // Additive + nullable; the coverage read selects manual_estimated_questions
      // and would 42703 on an un-migrated DB. Same guard rationale as 0117/0118.
      await db.execute(sql`ALTER TABLE "DomainDepthEstimate" ADD COLUMN IF NOT EXISTS "manual_estimated_questions" integer`);
      await db.execute(sql`ALTER TABLE "DomainDepthEstimate" ADD COLUMN IF NOT EXISTS "calibrated_at" timestamp with time zone`);
      // Migration 0120: daily gate-drop counters. The write path is fire-and-
      // forget (a missing table never blocks generation) but the weekly quality
      // digest reads it and would 42P01 on an un-migrated DB. Same rationale as
      // the 0116 DomainDepthEstimate guard above.
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS "GateDropStat" (
          "id" text PRIMARY KEY DEFAULT gen_random_uuid()::text,
          "day" date NOT NULL,
          "gate" text NOT NULL,
          "considered" integer NOT NULL DEFAULT 0,
          "dropped" integer NOT NULL DEFAULT 0,
          "failed_open" integer NOT NULL DEFAULT 0,
          "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
          CONSTRAINT "GateDropStat_day_gate_unique" UNIQUE ("day", "gate")
        )
      `);
      await db.execute(sql`ALTER TABLE "GateDropStat" ENABLE ROW LEVEL SECURITY`);
      // Migration 0121: admin per-domain generation cap. Additive + nullable; the
      // coverage read + getCappedDomainKeys select generation_capped_at and would
      // 42703 on an un-migrated DB. Same guard rationale as 0117/0118/0119.
      await db.execute(sql`ALTER TABLE "DomainDepthEstimate" ADD COLUMN IF NOT EXISTS "generation_capped_at" timestamp with time zone`);
      // Migration 0122 (D-DOMAIN-MERGE-REVIEW-REDESIGN-01): permanent Dismiss
      // records for the domain-merge review surface. getDomainFragmentationCandidates
      // reads it on every review load and would 42P01 if the migration recorded
      // without the table. Self-contained; same rationale as the 0116 guard.
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS "ReviewedDomainPair" (
          "pair_key" text PRIMARY KEY NOT NULL,
          "domain_a" text NOT NULL,
          "domain_b" text NOT NULL,
          "reviewed_at" timestamp with time zone NOT NULL DEFAULT now()
        )
      `);
      await db.execute(sql`ALTER TABLE "ReviewedDomainPair" ENABLE ROW LEVEL SECURITY`);
    } catch {
      // Non-fatal — migrate() creates the tables from 0090/0091/0092 immediately after.
    }
    // Migration 0093 (D-REVIEW-RECOVERED-01) adds the per-user "set aside" table
    // for the recovered-review surface. The recovered page reads it on every load
    // and would 42P01 if the migration recorded without the table present.
    // Self-contained; precedent: 0021's FeedDismissedDomain guard above.
    try {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS "RecoveredSetAside" (
          "id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
          "userId" text NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
          "questionId" text NOT NULL REFERENCES "Question"("id") ON DELETE CASCADE,
          "setAsideAt" timestamp with time zone NOT NULL DEFAULT now(),
          "reinstatedAt" timestamp with time zone
        )
      `);
      await db.execute(sql`ALTER TABLE "RecoveredSetAside" ENABLE ROW LEVEL SECURITY`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS "RecoveredSetAside_userId_idx" ON "RecoveredSetAside" ("userId")`);
      await db.execute(sql`
        CREATE UNIQUE INDEX IF NOT EXISTS "recovered_set_aside_active_unique"
        ON "RecoveredSetAside" ("userId", "questionId")
        WHERE "reinstatedAt" IS NULL
      `);
    } catch {
      // Fresh databases may not have User/Question yet — migrate() creates all
      // three in normal migration order.
    }
    // Migration 0113 adds the per-user "dismiss" table for From Friends milestone
    // questions (dismiss-as-answered). build-stream reads it on every Home load
    // and would 42P01 if the migration recorded without the table present.
    // Self-contained; precedent: 0093's RecoveredSetAside guard above.
    try {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS "MilestoneDismissed" (
          "id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
          "userId" text NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
          "questionId" text NOT NULL REFERENCES "Question"("id") ON DELETE CASCADE,
          "dismissedAt" timestamp with time zone NOT NULL DEFAULT now(),
          "reinstatedAt" timestamp with time zone
        )
      `);
      await db.execute(sql`ALTER TABLE "MilestoneDismissed" ENABLE ROW LEVEL SECURITY`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS "MilestoneDismissed_userId_idx" ON "MilestoneDismissed" ("userId")`);
      await db.execute(sql`
        CREATE UNIQUE INDEX IF NOT EXISTS "milestone_dismissed_active_unique"
        ON "MilestoneDismissed" ("userId", "questionId")
        WHERE "reinstatedAt" IS NULL
      `);
    } catch {
      // Fresh databases may not have User/Question yet — migrate() creates all
      // three in normal migration order.
    }
    } // end if (runBootGuards)
    const guardChainMs = runBootGuards ? Date.now() - guardChainStartedAt : 0;

    const migrateStartedAt = Date.now();
    // Hard cap on migrate() so a stalled connection can't eat the whole function
    // budget (D-NARROW-KB-FABRICATION-01). On timeout we ABANDON the migrate and
    // let boot proceed: every migration through the head is journaled, so a
    // healthy later boot (or the deploy step) applies them — a one-off cold-boot
    // stall must not block request work. Override via BOOT_MIGRATE_TIMEOUT_MS
    // (0/unset → 60s default).
    const bootMigrateTimeoutMs = Number(process.env.BOOT_MIGRATE_TIMEOUT_MS) > 0
      ? Number(process.env.BOOT_MIGRATE_TIMEOUT_MS)
      : 60_000;
    let migrateTimedOut = false;
    let migrateTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      const migratePromise = migrate(db, {
        migrationsFolder: path.join(process.cwd(), 'drizzle'),
      });
      // If we abandon this promise on timeout, its eventual rejection (the pool is
      // ended below) must not surface as an unhandledRejection.
      migratePromise.catch(() => {});
      const timeoutPromise = new Promise<never>((_, reject) => {
        migrateTimer = setTimeout(() => {
          migrateTimedOut = true;
          reject(new Error(`boot migrate exceeded ${bootMigrateTimeoutMs}ms`));
        }, bootMigrateTimeoutMs);
        if (typeof migrateTimer.unref === 'function') migrateTimer.unref();
      });
      await Promise.race([migratePromise, timeoutPromise]);
    } catch (err) {
      if (migrateTimedOut) {
        console.error(
          `[instrumentation] DB migration did not finish within ${bootMigrateTimeoutMs}ms — abandoning boot migrate so a cold-boot DB stall doesn't consume the request budget. Migrations are journaled and apply on a healthy boot/deploy.`,
          err,
        );
      } else {
        console.error('[instrumentation] DB migration failed — server will start but schema may be out of date:', err);
      }
    } finally {
      if (migrateTimer) clearTimeout(migrateTimer);
      await pool.end().catch(() => {});
    }
    // One line per cold boot. guards_ms is the latency the first request waits
    // behind when SKIP_BOOT_DB_GUARDS is unset; compare against migrate_ms to see
    // how much the defensive guard chain actually costs in this environment.
    console.info('[instrumentation boot]', {
      guards_ran: runBootGuards,
      guards_ms: guardChainMs,
      migrate_ms: Date.now() - migrateStartedAt,
      total_ms: Date.now() - guardChainStartedAt,
    });
  }
}
