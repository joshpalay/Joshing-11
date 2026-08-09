-- 0127: MissedReturnDismissed — per-(user, question) "don't ask me this again"
-- for the missed-question return system (D-MISSED-RETURN-01 §3.3, Phase 1 of
-- B-MISSED-RETURN-01).
--
-- Catch-up's existing dismiss is SLOT-scoped: it stamps `dismissed_at` into
-- that day's "DailyQueue".slots JSONB blob, or "FeedItem"."catchupResolvedAt".
-- A returning question is by definition a NEW slot in a DIFFERENT queue, so
-- that slot-level state is invisible to it — a question the player explicitly
-- waved off would resurface days later. This table holds the dismiss at the
-- (userId, questionId) level so it survives across queue instances. The
-- catch-up dismiss/undismiss routes dual-write here; the old slot-level write
-- is retained because other code still reads it.
--
-- Shape mirrors "RecoveredSetAside"/"MilestoneDismissed" exactly (migrations
-- 0093 and 0113): dismissedAt + nullable reinstatedAt, with a partial unique
-- index keeping at most one ACTIVE row per (userId, questionId). It is a
-- distinct table from "RecoveredSetAside" on purpose — same shape, opposite
-- meaning ("a question I now know" vs "a question I don't know and don't want
-- back"), and the rows must never be conflated.
--
-- Purely additive; RLS enabled per B-SECURITY-RLS-01 (no policies — the app
-- connects as the owner role, which bypasses RLS).
--
-- Rollback: DROP TABLE IF EXISTS "MissedReturnDismissed";
CREATE TABLE IF NOT EXISTS "MissedReturnDismissed" (
  "id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
  "userId" text NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
  "questionId" text NOT NULL REFERENCES "Question"("id") ON DELETE CASCADE,
  "dismissedAt" timestamp with time zone NOT NULL DEFAULT now(),
  "reinstatedAt" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "MissedReturnDismissed_userId_idx" ON "MissedReturnDismissed" ("userId");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "missed_return_dismissed_active_unique"
  ON "MissedReturnDismissed" ("userId", "questionId")
  WHERE "reinstatedAt" IS NULL;
--> statement-breakpoint
ALTER TABLE "MissedReturnDismissed" ENABLE ROW LEVEL SECURITY;
