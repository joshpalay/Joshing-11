-- B-FRIENDS-SAFETY-01 Phase 2 — decline creates a durable boundary.
--
-- Adds 'declined' to FollowState so ignorePendingFriendshipRequest can
-- transition an edge instead of hard-deleting it, plus declinedAt to record
-- when. createOrReusePendingFriendshipRequest reads declinedAt to enforce a
-- re-request cooldown (FRIEND_REQUEST_DECLINE_COOLDOWN_DAYS, default 30).
-- resolve() in src/server/db/queries/friend-requests.ts treats a declined
-- edge as if it doesn't exist -- it never counts as a friend, a follower, a
-- pending request, or a feed-visibility grant.
ALTER TYPE "public"."FollowState" ADD VALUE IF NOT EXISTS 'declined';
--> statement-breakpoint
ALTER TABLE "Follow" ADD COLUMN IF NOT EXISTS "declinedAt" timestamptz;
