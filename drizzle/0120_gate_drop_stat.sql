-- 0120: GateDropStat — daily counters for the generation-time gate chain.
--
-- Every gate in generateDailyQuestions FAILS OPEN by design (an LLM outage
-- must not block the daily queue), so a gate can be silently disabled —
-- timing out, truncating, or erroring on every call — with nothing surfacing
-- it. One row per (UTC day, gate): considered = batch sizes summed across
-- runs, dropped = questions the gate removed, failed_open = runs where the
-- gate errored/timed out and passed everything unchecked. Incremented
-- fire-and-forget from the gate chain (a write failure never blocks
-- generation); read by the weekly quality digest to render per-gate drop
-- rates and failed-open counts.
--
-- Purely additive; RLS enabled per B-SECURITY-RLS-01 (no policies — the app
-- connects as the owner role, which bypasses RLS).
--
-- Rollback: DROP TABLE IF EXISTS "GateDropStat";
CREATE TABLE IF NOT EXISTS "GateDropStat" (
  "id" text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "day" date NOT NULL,
  "gate" text NOT NULL,
  "considered" integer NOT NULL DEFAULT 0,
  "dropped" integer NOT NULL DEFAULT 0,
  "failed_open" integer NOT NULL DEFAULT 0,
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "GateDropStat_day_gate_unique" UNIQUE ("day", "gate")
);
--> statement-breakpoint
ALTER TABLE "GateDropStat" ENABLE ROW LEVEL SECURITY;
