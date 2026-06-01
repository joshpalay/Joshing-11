-- Migration: D-1 Stage 3 — directional follow model.
--
-- Replaces the symmetric Friendship primitive with directional Follow edges.
-- Two approved edges == a mutual ("friend") relationship; one edge == a
-- one-directional follow. A follow targeting an approval_required user lands
-- `pending` (a request the followee approves); a follow targeting a public user
-- lands `approved`. Invitations create approved edges in both directions.
--
-- Friendship is FROZEN (no new writes) but left in place for rollback. The
-- matching idempotent boot guard lives in src/instrumentation.ts. Backfills are
-- ON CONFLICT DO NOTHING so they are safe to re-run and safe to race the boot
-- guard.
DO $$ BEGIN
  CREATE TYPE "public"."FollowState" AS ENUM('pending', 'approved');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "public"."FollowPrivacy" AS ENUM('public', 'approval_required');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "follow_privacy" "public"."FollowPrivacy" NOT NULL DEFAULT 'approval_required';
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "Follow" (
  "id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
  "followerId" text NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
  "followeeId" text NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
  "state" "public"."FollowState" NOT NULL DEFAULT 'pending',
  "personalNote" text,
  "requestContext" jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "approvedAt" timestamptz,
  CONSTRAINT "Follow_followerId_followeeId_key" UNIQUE ("followerId", "followeeId"),
  CONSTRAINT "Follow_distinct_users" CHECK ("followerId" <> "followeeId")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "Follow_followerId_state_idx" ON "Follow" ("followerId", "state");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "Follow_followeeId_state_idx" ON "Follow" ("followeeId", "state");
--> statement-breakpoint
-- Backfill: each active friendship (A,B) -> two approved edges.
INSERT INTO "Follow" ("id", "followerId", "followeeId", "state", "approvedAt", "created_at")
SELECT gen_random_uuid()::text, "userAId", "userBId", 'approved'::"public"."FollowState",
       COALESCE("formedAt", now()), "createdAt"
FROM "Friendship" WHERE "status" = 'active'
ON CONFLICT ("followerId", "followeeId") DO NOTHING;
--> statement-breakpoint
INSERT INTO "Follow" ("id", "followerId", "followeeId", "state", "approvedAt", "created_at")
SELECT gen_random_uuid()::text, "userBId", "userAId", 'approved'::"public"."FollowState",
       COALESCE("formedAt", now()), "createdAt"
FROM "Friendship" WHERE "status" = 'active'
ON CONFLICT ("followerId", "followeeId") DO NOTHING;
--> statement-breakpoint
-- Backfill: each pending request -> one pending edge requester -> other,
-- carrying the personal note and suggested-interest context.
INSERT INTO "Follow" ("id", "followerId", "followeeId", "state", "personalNote", "requestContext", "created_at")
SELECT gen_random_uuid()::text,
       "requestedByUserId",
       CASE WHEN "requestedByUserId" = "userAId" THEN "userBId" ELSE "userAId" END,
       'pending'::"public"."FollowState",
       "personalNote", "requestContext", "createdAt"
FROM "Friendship" WHERE "status" = 'pending'
ON CONFLICT ("followerId", "followeeId") DO NOTHING;
