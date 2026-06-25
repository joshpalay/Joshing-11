-- B-LLM-PROVIDER-AB-METRICS (Part 2) — per-call LLM usage events (cost).
--
-- One row per LLM completion (Anthropic or OpenAI), carrying the token counts
-- already emitted to the [llm] structured logs, but in a queryable table so the
-- A/B experiment can answer "is OpenAI cheaper on this surface?" without exporting
-- logs by hand. Cost is NOT stored — it is computed at read time from the token
-- columns and the price map in src/server/llm/pricing.ts, so a repricing needs no
-- backfill. Written best-effort, fire-and-forget, off the LLM call's critical
-- path (telemetry must never block or fail a completion); some rows may be lost
-- on a cold serverless cutoff, which is acceptable for a cost estimate.
--
-- Purely additive: no existing table is altered. RLS is enabled with no policies
-- (the app connects as the owner role, which bypasses RLS) per B-SECURITY-RLS-01
-- / migration 0081 — without it the table would be reachable over Supabase's
-- public Data API. Every statement is idempotent and mirrored by a defensive
-- guard in src/instrumentation.ts (precedent: 0087) so a preview/production
-- database that records this migration without the table present still boots.
--
-- Rollback:
--   DROP TABLE IF EXISTS "LlmUsageEvent";
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
);
--> statement-breakpoint
ALTER TABLE "LlmUsageEvent" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "LlmUsageEvent_provider_created_at_idx" ON "LlmUsageEvent" ("provider", "created_at");
