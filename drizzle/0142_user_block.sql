-- B-FRIENDS-SAFETY-01 Phase 1 — persistent blocking.
--
-- A block is stored one-directional (who pressed the button) but enforced
-- bidirectionally on every relationship read (see isBlockedBetween /
-- blockedIdsAmong in src/server/db/queries/user-blocks.ts, wired into the
-- shared getRelationship/getRelationships resolver in
-- src/server/db/queries/friend-requests.ts). Deliberately its own table
-- rather than a Follow.state member: a block must be able to exist with no
-- follow edge between the pair at all.
--
-- The matching idempotent boot guard lives in src/instrumentation.ts.
CREATE TABLE IF NOT EXISTS "UserBlock" (
  "id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
  "blockerId" text NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
  "blockedId" text NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "UserBlock_blockerId_blockedId_key" UNIQUE ("blockerId", "blockedId"),
  CONSTRAINT "UserBlock_distinct_users" CHECK ("blockerId" <> "blockedId")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "UserBlock_blockerId_idx" ON "UserBlock" ("blockerId");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "UserBlock_blockedId_idx" ON "UserBlock" ("blockedId");
--> statement-breakpoint
-- B-SECURITY-RLS-01 (precedent: 0081_enable_rls_public_tables). A new public
-- table is reachable over the Supabase Data API by anon/authenticated the
-- moment it exists. No policies: the app connects as owner `postgres`, which
-- bypasses RLS.
ALTER TABLE "UserBlock" ENABLE ROW LEVEL SECURITY;
