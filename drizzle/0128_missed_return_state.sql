-- 0128: MissedReturnState + the DailyPreference toggle — Phase 2 of
-- B-MISSED-RETURN-01 (D-MISSED-RETURN-01 §4, §7-B1, §7-F1).
--
-- "MissedReturnState" holds the two per-(user, question) facts the return
-- eligibility rule needs and cannot get cheaply from anywhere else:
--   lastReturnedAt — the 7-day floor between sightings of the same question (R5)
--   returnCount    — the lifetime cap of 3 returns per (player, question) (R7)
-- One row per pair, updated in place: this is CURRENT STATE, not an event log.
-- MASTERY_EVENTS already keeps the history, and re-deriving these two values
-- from it would mean scanning the whole log per candidate on every queue build.
--
-- There is deliberately NO retiredAt column. R6 ("stop on first correct") is
-- already queryable as "has a first_correct_after_wrong event" — the same
-- predicate the shipped Recovered deck uses, which is exactly why a correct
-- return lands the question in that deck with no new plumbing (§3.1).
--
-- "DailyPreference"."missed_return_enabled" is the single on/off toggle (§7-B1)
-- governing both scopes together, defaulting TRUE for everyone (§7-F1). The
-- default covers existing rows; users with NO DailyPreference row are treated as
-- enabled in code, so "never opened Customize" never reads as "opted out".
--
-- Purely additive — the new column carries a DEFAULT so it is safe on the
-- existing non-empty table. RLS enabled on the new table per B-SECURITY-RLS-01
-- (no policies — the app connects as the owner role, which bypasses RLS).
--
-- Rollback:
--   DROP TABLE IF EXISTS "MissedReturnState";
--   ALTER TABLE "DailyPreference" DROP COLUMN IF EXISTS "missed_return_enabled";
CREATE TABLE IF NOT EXISTS "MissedReturnState" (
  "id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
  "userId" text NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
  "questionId" text NOT NULL REFERENCES "Question"("id") ON DELETE CASCADE,
  "lastReturnedAt" timestamp with time zone NOT NULL DEFAULT now(),
  "returnCount" integer NOT NULL DEFAULT 0,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "MissedReturnState_userId_idx" ON "MissedReturnState" ("userId");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "missed_return_state_user_question_unique"
  ON "MissedReturnState" ("userId", "questionId");
--> statement-breakpoint
ALTER TABLE "MissedReturnState" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "DailyPreference"
  ADD COLUMN IF NOT EXISTS "missed_return_enabled" boolean NOT NULL DEFAULT true;
