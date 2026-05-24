-- Migration: add per-user invite token for shareable invite links (B-Friends-3).
--
-- users.invite_token is the inviter's evergreen invite link slug. URLs look
-- like /invite/<handle>/<token>. Distinct from the existing
-- FriendInvitation.token mechanism (per-invitation, expires, may pre-seed
-- interests). The per-user token is generated lazily on first GET to
-- /api/account/invite-token and can be rotated via /rotate, which 404s the
-- old URL.
--
-- Nullable for now — users get one assigned on first read of the API. The
-- unique partial index lets multiple users sit at NULL but enforces global
-- uniqueness once tokens are assigned.
--
-- Idempotent guards are also pre-applied in src/instrumentation.ts for
-- preview/production databases that may have this migration recorded
-- without the column or index actually present.
ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "invite_token" text;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_users_invite_token"
  ON "User" ("invite_token") WHERE "invite_token" IS NOT NULL;
