-- 0118: dry-round observation counters on DomainDepthEstimate
-- (D-SUPPLY-FINITENESS-01 #4, the soft/provisional finiteness state machine).
--
-- Persists ONLY the raw observations; the supply STATE (filling / soft_finite /
-- discrepancy / raise_estimate) is derived at read time by classifySupplyState
-- (src/server/daily/supply-state.ts) so there is no stored state to go stale.
--  - consecutive_dry_rounds: offered-to-fresh-generation rounds in a row that
--    yielded zero surviving rows for the domain; reset on any yield.
--  - last_yield_at: when the domain last produced a surviving row.
--
-- Purely additive + idempotent; mirrored by an instrumentation guard.
--
-- Rollback:
--   ALTER TABLE "DomainDepthEstimate"
--     DROP COLUMN IF EXISTS "consecutive_dry_rounds",
--     DROP COLUMN IF EXISTS "last_yield_at";
ALTER TABLE "DomainDepthEstimate" ADD COLUMN IF NOT EXISTS "consecutive_dry_rounds" integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE "DomainDepthEstimate" ADD COLUMN IF NOT EXISTS "last_yield_at" timestamp with time zone;
