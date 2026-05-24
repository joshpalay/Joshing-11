-- Migration: per-user phone hash + Find Friends discovery threshold (B-Friends-4).
--
-- Two columns on User:
--   • phone_hash — SHA-256(salt + E.164(phone_number)). Populated at signup
--     (provisionUserForPhone in src/app/api/auth/verify-otp/route.ts) and
--     backfilled for existing users via scripts/backfill-phone-hashes.ts.
--     Required for the contact-hash match query at /api/contact-hashes/matches
--     — uploaded ContactHash.phoneHash rows join against this.
--   • last_friend_discovery_check_at — when the user last visited
--     /friends/find. The discovery dot (Nav) and the passive Invitations-tab
--     row use this as the threshold for "new since you last checked".
--
-- Both nullable. phone_hash is NULL for accounts that haven't been backfilled
-- yet (they're invisible to contact matching until the backfill script runs
-- or they re-trigger signup). last_friend_discovery_check_at is NULL on first
-- visit and treated as "show all" by getNewDiscoveryStatus.
--
-- Index is non-unique. Salt rotation could in theory produce transient
-- collisions, and the match query joins on equality only — uniqueness isn't
-- required for correctness.
--
-- Idempotent guards are also pre-applied in src/instrumentation.ts.
ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "phone_hash" text;
--> statement-breakpoint
ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "last_friend_discovery_check_at" timestamptz;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_users_phone_hash"
  ON "User" ("phone_hash");
