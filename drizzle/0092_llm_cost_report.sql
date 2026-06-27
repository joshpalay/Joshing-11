-- B-LLM-COST-LATENCY-REPORT-01 — stored weekly cost & latency digest.
--
-- One row per generated digest (Decision B1: a stored markdown digest, written
-- weekly by /api/cron/llm-cost-report and viewable in the owner-gated readout on
-- the profile page). The digest is plain-English prose assembled at write time
-- from LlmUsageEvent token/latency rows; the markdown is the durable artifact
-- (and the future payload for an emailed digest, Decision B2). Cost itself is
-- still derived at read time from src/server/llm/pricing.ts — this table stores
-- the rendered words, not a frozen dollar number, so the snapshot reflects the
-- price map in effect when the cron ran.
--
-- Purely additive: no existing table is altered. This is read-and-report-only
-- work over data already written by recordLlmUsage — nothing here touches the
-- LLM call path. RLS is enabled with no policies (the app connects as the owner
-- role, which bypasses RLS) per B-SECURITY-RLS-01 / migration 0081 — without it
-- the table would be reachable over Supabase's public Data API. Every statement
-- is idempotent and mirrored by a defensive guard in src/instrumentation.ts
-- (precedent: 0091) so a preview/production database that records this migration
-- without the table present still boots.
--
-- Rollback:
--   DROP TABLE IF EXISTS "LlmCostReport";
CREATE TABLE IF NOT EXISTS "LlmCostReport" (
  "id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
  "period_start" timestamp with time zone NOT NULL,
  "period_end" timestamp with time zone NOT NULL,
  "window_days" integer NOT NULL DEFAULT 7,
  "markdown" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "LlmCostReport" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "LlmCostReport_created_at_idx" ON "LlmCostReport" ("created_at");
