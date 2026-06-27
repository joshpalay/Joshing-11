-- D-REVIEW-RECOVERED-01 — per-user "set aside" for recovered-review questions.
--
-- A reversible soft-dismiss at the QUESTION level for the "ones you turned
-- around" surface. An active row (reinstatedAt IS NULL) demotes that question to
-- the bottom of the viewer's recovered list (and dims it in the UI); restoring
-- sets reinstatedAt = now(). The partial unique index keeps at most one active
-- row per (userId, questionId), so a question can't be set aside twice. Mirrors
-- FeedDismissedDomain (migrations 0012/0021) exactly.
--
-- Purely additive: no existing table is altered, and the recovered surface is
-- otherwise read-only. RLS is enabled with no policies (the app connects as the
-- owner role, which bypasses RLS) per B-SECURITY-RLS-01 / migration 0081 —
-- without it the table would be reachable over Supabase's public Data API. Every
-- statement is idempotent and mirrored by a defensive guard in
-- src/instrumentation.ts (precedent: 0021's FeedDismissedDomain guard).
--
-- Rollback:
--   DROP TABLE IF EXISTS "RecoveredSetAside";
CREATE TABLE IF NOT EXISTS "RecoveredSetAside" (
  "id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
  "userId" text NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
  "questionId" text NOT NULL REFERENCES "Question"("id") ON DELETE CASCADE,
  "setAsideAt" timestamp with time zone NOT NULL DEFAULT now(),
  "reinstatedAt" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "RecoveredSetAside" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "RecoveredSetAside_userId_idx" ON "RecoveredSetAside" ("userId");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "recovered_set_aside_active_unique"
  ON "RecoveredSetAside" ("userId", "questionId")
  WHERE "reinstatedAt" IS NULL;
