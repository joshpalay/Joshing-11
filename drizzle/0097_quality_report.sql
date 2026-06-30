-- B-QUESTION-QUALITY-AGENTS-01 Phase 4 — stored weekly quality-aggregation digest.
--
-- One row per generated digest, written weekly by /api/cron/quality-aggregation.
-- The markdown is the durable artifact (rolled up from vet rejections, critique
-- counts, and the new verification verdicts by broadCategory × canonicalSubcategory,
-- trailing 30d, enforcing the sample floor). Mirrors LlmCostReport (migration 0092).
--
-- Purely additive: no existing table is altered. RLS enabled with no policies
-- (the app connects as the owner role, which bypasses RLS) per B-SECURITY-RLS-01 /
-- migration 0081 — without it the table would be reachable over Supabase's public
-- Data API. Every statement is idempotent and mirrored by a defensive guard in
-- src/instrumentation.ts (precedent: 0092).
--
-- Rollback:
--   DROP TABLE IF EXISTS "QualityReport";
CREATE TABLE IF NOT EXISTS "QualityReport" (
  "id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
  "period_start" timestamp with time zone NOT NULL,
  "period_end" timestamp with time zone NOT NULL,
  "window_days" integer NOT NULL DEFAULT 30,
  "markdown" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "QualityReport" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "QualityReport_created_at_idx" ON "QualityReport" ("created_at");
