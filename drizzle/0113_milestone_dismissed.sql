-- Dismiss-as-answered for From Friends milestone/streak questions.
--
-- A reversible per-user soft-dismiss at the QUESTION level for the "has been
-- deep in {domain}" bundle cards. An active row (reinstatedAt IS NULL) marks
-- that the viewer waved a friend's question off: it counts toward the bundle's
-- consumed/played progress exactly like an answer (so a bundle whose questions
-- are all answered-or-dismissed disappears from Home), but it is deliberately
-- NEUTRAL — it writes ONLY this row and touches nothing in the mastery/points
-- system, so a dismiss is never scored as a wrong answer. Undo sets
-- reinstatedAt = now(); dismissing again inserts a fresh active row. The partial
-- unique index keeps at most one active row per (userId, questionId). Mirrors
-- RecoveredSetAside (0093) / FeedDismissedDomain (0012/0021) exactly.
--
-- Purely additive: no existing table is altered. RLS is enabled with no policies
-- (the app connects as the owner role, which bypasses RLS) per B-SECURITY-RLS-01
-- / migration 0081 — without it the table would be reachable over Supabase's
-- public Data API. Every statement is idempotent and mirrored by a defensive
-- guard in src/instrumentation.ts (precedent: 0093's RecoveredSetAside guard).
--
-- Rollback:
--   DROP TABLE IF EXISTS "MilestoneDismissed";
CREATE TABLE IF NOT EXISTS "MilestoneDismissed" (
  "id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
  "userId" text NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
  "questionId" text NOT NULL REFERENCES "Question"("id") ON DELETE CASCADE,
  "dismissedAt" timestamp with time zone NOT NULL DEFAULT now(),
  "reinstatedAt" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "MilestoneDismissed" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "MilestoneDismissed_userId_idx" ON "MilestoneDismissed" ("userId");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "milestone_dismissed_active_unique"
  ON "MilestoneDismissed" ("userId", "questionId")
  WHERE "reinstatedAt" IS NULL;
