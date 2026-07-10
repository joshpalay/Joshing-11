-- 0123: MasteryCalibrationSnapshot — one daily snapshot of the mastery-v2
-- calibration picture (D-MASTERY-FINEST-NODE-01 observability).
--
-- Captured in SHADOW by the mastery-calibration-report cron: it computes what
-- mastery-v2 WOULD show via the pure resolveV2Mastery, without enabling
-- KNOWLEDGE_MASTERY_V2 or writing the leaf-freeze ledger. `metrics` (jsonb) holds
-- the structured aggregate — reachability buckets, v1<->v2 badge divergence,
-- per-node headroom, threshold-vs-supply classification, flip-readiness verdict —
-- so trends chart without re-parsing markdown; `markdown` is the rendered digest
-- (identical to the email body). One row per UTC day, replaced on a same-day
-- re-run via the (day) unique key.
--
-- Purely additive; RLS enabled per B-SECURITY-RLS-01 (no policies — the app
-- connects as the owner role, which bypasses RLS).
--
-- Rollback: DROP TABLE IF EXISTS "MasteryCalibrationSnapshot";
CREATE TABLE IF NOT EXISTS "MasteryCalibrationSnapshot" (
  "id" text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "day" date NOT NULL,
  "flag_enabled" boolean NOT NULL DEFAULT false,
  "metrics" jsonb NOT NULL,
  "markdown" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "MasteryCalibrationSnapshot_day_unique" UNIQUE ("day")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "MasteryCalibrationSnapshot_day_idx" ON "MasteryCalibrationSnapshot" ("day");
--> statement-breakpoint
ALTER TABLE "MasteryCalibrationSnapshot" ENABLE ROW LEVEL SECURITY;
