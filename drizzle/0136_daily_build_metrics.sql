-- A0 (Track A): additive instrumentation for the Daily Five build pipeline.
-- NO BEHAVIOR CHANGE. Nothing reads the new DailyQueue columns yet; A1 and A2
-- turn them on. This migration exists so the A1/A2 decisions can be made
-- against measured numbers instead of reconstructed ones.
--
-- WHY: build spans were previously inferred by clustering LlmUsageEvent rows by
-- timestamp, which produced three independent measurement errors (a one-day
-- batch sweep read as build traffic; overlapping lookback windows double-counting
-- the 36% of queues the cron builds back-to-back; and a circular "0.0s" for
-- builds that make no LLM calls). LlmUsageEvent.build_id removes the inference.
--
-- MIGRATION TIMING (deliberate): the DailyQueue backfill below marks every
-- existing row complete at its current size. If a build were in flight while it
-- ran, that build's partially-assembled queue would be marked complete. The
-- window is small but the daily cron makes it PREDICTABLE, so run this
-- off-schedule -- not within the cron's build window. It is otherwise safe to
-- re-run (all statements are idempotent).
--
-- Rollback:
--   DROP TABLE IF EXISTS "DailyBuildMetric";
--   ALTER TABLE "LlmUsageEvent" DROP COLUMN IF EXISTS "build_id";
--   ALTER TABLE "DailyQueue" DROP COLUMN IF EXISTS "target_size";
--   ALTER TABLE "DailyQueue" DROP COLUMN IF EXISTS "build_completed_at";

-- 1. Build correlation on every LLM call. NULL for every non-build caller
--    (batch verify, crafter drafting, admin audits), which is what keeps those
--    scopes out of build statistics without a scope allowlist.
ALTER TABLE "LlmUsageEvent"
  ADD COLUMN IF NOT EXISTS "build_id" text;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "LlmUsageEvent_build_id_idx"
  ON "LlmUsageEvent" ("build_id") WHERE "build_id" IS NOT NULL;
--> statement-breakpoint

-- 2. The A2 invariant columns, shipped inert in A0 so A1 can abort SAFELY.
--    Writing a short queue without these would let a 3-slot queue read as
--    complete under `answered >= slots.length` -- reintroducing
--    B-DAILY-PARTIAL-QUEUE-01 by a new route.
--
--    target_size is the round's DENOMINATOR, distinct from rows present.
--    Completion is answered >= target_size, never answered >= slots.length.
ALTER TABLE "DailyQueue"
  ADD COLUMN IF NOT EXISTS "target_size" integer NOT NULL DEFAULT 5;
--> statement-breakpoint
ALTER TABLE "DailyQueue"
  ADD COLUMN IF NOT EXISTS "build_completed_at" timestamp with time zone;
--> statement-breakpoint

-- 3. Backfill: every EXISTING row reads as complete at the size it already has,
--    so no live queue changes behavior the moment this lands. A queue that was
--    built short stays short and completes at its own length.
UPDATE "DailyQueue"
SET "target_size" = GREATEST(1, jsonb_array_length("slots"))
WHERE jsonb_typeof("slots") = 'array'
  AND "target_size" IS DISTINCT FROM GREATEST(1, jsonb_array_length("slots"));
--> statement-breakpoint
UPDATE "DailyQueue"
SET "build_completed_at" = "created_at"
WHERE "build_completed_at" IS NULL;
--> statement-breakpoint

-- 4. One row per build. Answers the questions this thread could not:
--    does span track ROUND count or CALL count (the 9+ bucket anomaly), what
--    is the realized bank hit rate and which narrower dominates the misses, and
--    what would write-at-3 actually have bought (gated_floor_reached_ms).
CREATE TABLE IF NOT EXISTS "DailyBuildMetric" (
  "id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
  "build_id" text NOT NULL,
  "user_id" text NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
  "started_at" timestamp with time zone NOT NULL,
  "completed_at" timestamp with time zone NOT NULL DEFAULT now(),
  -- Authoritative wall clock: measured by the build itself, not reconstructed.
  -- Covers bank-only builds, which have no LLM events at all to span.
  "span_ms" integer NOT NULL,
  -- The §2 hypothesis: wall clock scales with ROUNDS (each separated by ~10s of
  -- sequential gates), not with parallel call count. Both recorded so the
  -- regression can be run rather than argued.
  "round_count" integer NOT NULL DEFAULT 0,
  "generate_call_count" integer NOT NULL DEFAULT 0,
  -- Per-round [{round, generationMs, gateMs, chunks}].
  "rounds" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "bank_hit_count" integer NOT NULL DEFAULT 0,
  "bank_miss_count" integer NOT NULL DEFAULT 0,
  -- Per-domain [{domain, outcome, missReason, tierRequested, tierServed}] --
  -- this is the existing [daily/bank-telemetry] console line made queryable,
  -- not new logic.
  "bank_attempts" jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- Counterfactual for the A2 go/no-go: when in-memory assembly first crossed
  -- DAILY_QUEUE_MIN_SIZE, independent of when the write happened. NULL when the
  -- floor was never reached.
  "gated_floor_reached_ms" integer,
  "target_size" integer NOT NULL,
  "final_size" integer NOT NULL,
  "aborted" boolean NOT NULL DEFAULT false,
  "outcome" text NOT NULL DEFAULT 'ok'
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "DailyBuildMetric_user_id_idx" ON "DailyBuildMetric" ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "DailyBuildMetric_completed_at_idx" ON "DailyBuildMetric" ("completed_at");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "DailyBuildMetric_build_id_key" ON "DailyBuildMetric" ("build_id");
--> statement-breakpoint
-- B-SECURITY-RLS-01 (precedent: 0081): a new public table is reachable over the
-- Supabase Data API the moment it exists. No policies -- the app connects as
-- owner `postgres`, which bypasses RLS.
ALTER TABLE "DailyBuildMetric" ENABLE ROW LEVEL SECURITY;
