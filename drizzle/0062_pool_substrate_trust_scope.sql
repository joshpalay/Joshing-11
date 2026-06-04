-- Migration: B1 pool substrate — trust tier, scope, perishable, provenance,
-- empirical stats, and embedding-dedup flags (PRD-D-5 §5.1 / §6 / §8).
--
-- Evolves the machine bank (GeneratedQuestion) and human-authored questions
-- (Question) into one durable, trust-tiered, dedup-aware pool. B1 adds the
-- fields + the capability to filter by them; it does NOT switch on live
-- trust-tier gating (that is B4) and deletes nothing.
--
-- Field reuse (human table): scope, n_answered and empirical_correct_rate are
-- NOT added to Question — the unified selection layer reuses visibility,
-- asked_count and correct_rate. Only genuinely-new columns are added there.
--
-- Grandfather backfill: machine rows -> machine_verified; human rows ->
-- author_confirmed. Machine empirical stats are derived from the linked played
-- Question row (Question.generated_question_id, unique) where one exists.
--
-- All additive / IF NOT EXISTS / guarded — safe and non-destructive. Matching
-- idempotent boot guards land in src/instrumentation.ts so a preview/production
-- database that records this migration without the pieces present can still boot.
--
-- Rollback: DROP the added columns (DROP COLUMN IF EXISTS) on both tables and
-- DROP TYPE "TrustTier"/"QuestionScope"; no other data depends on them.
DO $$ BEGIN
  CREATE TYPE "public"."TrustTier" AS ENUM('unverified', 'machine_verified', 'human_validated', 'author_confirmed');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "public"."QuestionScope" AS ENUM('private', 'friends_only', 'public');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
-- Human-authored questions: new-only columns.
ALTER TABLE "Question"
  ADD COLUMN IF NOT EXISTS "trust_tier" "public"."TrustTier" NOT NULL DEFAULT 'unverified';
--> statement-breakpoint
ALTER TABLE "Question"
  ADD COLUMN IF NOT EXISTS "perishable" boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE "Question"
  ADD COLUMN IF NOT EXISTS "source_refs" jsonb NOT NULL DEFAULT '[]'::jsonb;
--> statement-breakpoint
ALTER TABLE "Question"
  ADD COLUMN IF NOT EXISTS "is_duplicate" boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE "Question"
  ADD COLUMN IF NOT EXISTS "suppressed_by" text;
--> statement-breakpoint
-- Machine bank: new-only + machine-only columns (scope/n_answered/correct-rate).
ALTER TABLE "GeneratedQuestion"
  ADD COLUMN IF NOT EXISTS "trust_tier" "public"."TrustTier" NOT NULL DEFAULT 'unverified';
--> statement-breakpoint
ALTER TABLE "GeneratedQuestion"
  ADD COLUMN IF NOT EXISTS "scope" "public"."QuestionScope" NOT NULL DEFAULT 'public';
--> statement-breakpoint
ALTER TABLE "GeneratedQuestion"
  ADD COLUMN IF NOT EXISTS "perishable" boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE "GeneratedQuestion"
  ADD COLUMN IF NOT EXISTS "source_refs" jsonb NOT NULL DEFAULT '[]'::jsonb;
--> statement-breakpoint
ALTER TABLE "GeneratedQuestion"
  ADD COLUMN IF NOT EXISTS "n_answered" integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE "GeneratedQuestion"
  ADD COLUMN IF NOT EXISTS "empirical_correct_rate" double precision;
--> statement-breakpoint
ALTER TABLE "GeneratedQuestion"
  ADD COLUMN IF NOT EXISTS "is_duplicate" boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE "GeneratedQuestion"
  ADD COLUMN IF NOT EXISTS "suppressed_by" text;
--> statement-breakpoint
-- Grandfather backfill: existing human rows are author_confirmed (default
-- target only the rows still at the 'unverified' default so this is re-runnable).
UPDATE "Question"
  SET "trust_tier" = 'author_confirmed'
  WHERE "trust_tier" = 'unverified';
--> statement-breakpoint
-- Grandfather backfill: existing machine rows are machine_verified.
UPDATE "GeneratedQuestion"
  SET "trust_tier" = 'machine_verified'
  WHERE "trust_tier" = 'unverified';
--> statement-breakpoint
-- Empirical stats backfill (D11): derive each machine row's play stats from its
-- linked played Question (Question.generated_question_id is unique). Machine rows
-- with no linked play stay at 0 / NULL.
UPDATE "GeneratedQuestion" g
  SET "n_answered" = q."asked_count",
      "empirical_correct_rate" = CASE
        WHEN q."asked_count" > 0 THEN q."correct_count"::double precision / q."asked_count"
        ELSE NULL
      END
  FROM "Question" q
  WHERE q."generated_question_id" = g."id"
    AND q."asked_count" > 0;
--> statement-breakpoint
-- Selection-layer filter indexes (B1). Capability only; not gated on any surface.
CREATE INDEX IF NOT EXISTS "Question_trust_tier_idx" ON "Question" ("trust_tier");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "Question_is_duplicate_idx" ON "Question" ("is_duplicate");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "GeneratedQuestion_trust_tier_idx" ON "GeneratedQuestion" ("trust_tier");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "GeneratedQuestion_is_duplicate_idx" ON "GeneratedQuestion" ("is_duplicate");
