-- Separate real Daily Five builds from maintenance, backfills, and audits.
-- Existing rows predate this distinction and remain labelled "unknown".
-- Rollback removes the new constraint and column, then restores the old key.
ALTER TABLE "GateDropStat" ADD COLUMN IF NOT EXISTS "scope" text NOT NULL DEFAULT 'unknown';
--> statement-breakpoint
ALTER TABLE "GateDropStat" DROP CONSTRAINT IF EXISTS "GateDropStat_day_gate_unique";
--> statement-breakpoint
ALTER TABLE "GateDropStat" ADD CONSTRAINT "GateDropStat_day_gate_scope_unique" UNIQUE ("day", "gate", "scope");
