-- 0106_verify_batch_run — batch-verify async mode (Batch API), two pieces:
--
--   VerifyBatchRun: one row per Anthropic Message Batch of verification requests
--   submitted by /api/cron/batch-verify-questions when BATCH_VERIFY_ASYNC_ENABLED
--   is on. The daily cron harvests 'submitted' runs (applying verdicts + stamping
--   rows) before submitting a new batch; rows in errored/expired results stay
--   unstamped and are re-picked next submission (fail-open, same contract as the
--   sync path). RLS enabled per B-SECURITY-RLS-01 (no policies — owner bypasses).
--
--   LlmUsageEvent.is_batch: marks ledger rows whose tokens billed at the Batch
--   API's 50% discount so estimateCostUsd prices them honestly instead of
--   over-reporting batch spend 2x. Additive with a DEFAULT — safe on non-empty.
--
-- Rollback: unset BATCH_VERIFY_ASYNC_ENABLED first (cron reverts to the sync
-- path), then DROP TABLE "VerifyBatchRun"; ALTER TABLE "LlmUsageEvent" DROP
-- COLUMN "is_batch"; — unharvested batches simply leave rows unstamped, which the
-- sync sweep then processes.
CREATE TABLE IF NOT EXISTS "VerifyBatchRun" (
  "id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
  "provider_batch_id" text NOT NULL,
  "status" text NOT NULL DEFAULT 'submitted',
  "request_count" integer NOT NULL DEFAULT 0,
  "harvested_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "VerifyBatchRun_status_valid" CHECK (status IN ('submitted', 'harvested', 'failed'))
);
--> statement-breakpoint
ALTER TABLE "VerifyBatchRun" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "VerifyBatchRun_provider_batch_id_key" ON "VerifyBatchRun" ("provider_batch_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "VerifyBatchRun_status_idx" ON "VerifyBatchRun" ("status");
--> statement-breakpoint
ALTER TABLE "LlmUsageEvent" ADD COLUMN IF NOT EXISTS "is_batch" boolean NOT NULL DEFAULT false;
