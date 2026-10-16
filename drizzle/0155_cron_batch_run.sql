-- 0155_cron_batch_run — Batch-API tracking for two latency-insensitive crons:
-- /api/cron/vet-questions (kind 'vet') and /api/cron/backfill-supply (kind
-- 'backfill'). Same two-phase shape as VerifyBatchRun (0106): a cron run first
-- harvests ended batches, then submits a new one. Tokens bill at 50%.
--
-- A separate table (not a kind column on VerifyBatchRun) so the working
-- batch-verify path is untouched. `payload` carries what harvest needs that the
-- 64-char custom_id cannot (the backfill plan per request).
--
-- Gated by VET_QUESTIONS_BATCH_ENABLED / SUPPLY_BACKFILL_BATCH_ENABLED (default
-- OFF → the existing synchronous paths; this table then stays empty).
-- Rollback: unset both flags (unharvested work is simply re-picked by the sync
-- path), then DROP TABLE "CronBatchRun";
CREATE TABLE IF NOT EXISTS "CronBatchRun" (
  "id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
  "kind" text NOT NULL,
  "provider_batch_id" text NOT NULL,
  "status" text NOT NULL DEFAULT 'submitted',
  "request_count" integer NOT NULL DEFAULT 0,
  "payload" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "harvested_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "CronBatchRun_kind_valid" CHECK (kind IN ('vet', 'backfill')),
  CONSTRAINT "CronBatchRun_status_valid" CHECK (status IN ('submitted', 'harvested', 'failed'))
);
--> statement-breakpoint
ALTER TABLE public."CronBatchRun" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL PRIVILEGES ON TABLE public."CronBatchRun" FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "CronBatchRun_provider_batch_id_key" ON "CronBatchRun" ("provider_batch_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "CronBatchRun_kind_status_idx" ON "CronBatchRun" ("kind", "status");
