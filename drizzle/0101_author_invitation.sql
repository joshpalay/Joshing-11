-- 0101_author_invitation (B-CRAFTER-LIFECYCLE-01 Phase 3)
--
-- The manual "invitation to author" checkbox (decision 2026-07-01): a crafter
-- flips a per-(player, domain) invitation from Panel B, and the player sees the
-- full-screen "you've played through X" takeover ONCE (seen_at), with three
-- doors (author / expand / wait — door_choice records which they took). The
-- reason column keeps this generic — 'domain_exhausted' is the first of a
-- couple of invitation categories, not the only one. resolved_at closes an
-- invitation (crafter revoke or lifecycle completion) without deleting it.
-- One ACTIVE invitation per (player, domain) — the partial unique index below;
-- history rows (resolved) can accumulate.
--
-- Purely additive: no existing table is altered. RLS enabled with no policies
-- (owner-role app connection bypasses RLS) per B-SECURITY-RLS-01 / migration
-- 0081. Every statement idempotent, mirrored by a guard in instrumentation.ts.
--
-- Rollback:
--   DROP TABLE IF EXISTS "AuthorInvitation";
CREATE TABLE IF NOT EXISTS "AuthorInvitation" (
  "id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
  "user_id" text NOT NULL REFERENCES "User"("id"),
  "domain" text NOT NULL,
  "reason" text NOT NULL DEFAULT 'domain_exhausted',
  "invited_by" text NOT NULL REFERENCES "User"("id"),
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "seen_at" timestamp with time zone,
  "door_choice" text,
  "resolved_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "AuthorInvitation" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "AuthorInvitation_active_user_domain_key"
  ON "AuthorInvitation" ("user_id", "domain") WHERE "resolved_at" IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "AuthorInvitation_user_id_idx" ON "AuthorInvitation" ("user_id");
