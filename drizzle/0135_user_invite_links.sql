-- B-FRIENDS-INVITE-LINKS-01: up to 3 named invite links per user, replacing
-- the single evergreen users.invite_token.
--
-- slot is the identity a link carries (0 = untagged, carries all 3 seed
-- topics; 1-3 = a specific slot in users.invite_seed_interests). slot is an
-- INTEGER, not the topic label, so renaming a topic never orphans a link or
-- changes its color -- the app resolves slot -> topic -> category at render
-- time, not at write time.
--
-- Deletion is soft (deleted_at). Nothing in a Friendship/Follow row
-- references the token, so deleting a link never affects people who already
-- joined through it; deleted_at also keeps the row so join-count stats and
-- users.joined_via_invite_link_id attribution never dangle.
--
-- Backfill: every existing users.invite_token becomes one untagged (slot 0)
-- UserInviteLink row, so every link already shared and in the wild keeps
-- resolving under the new table. users.invite_token itself is NOT dropped
-- here -- see the deprecation note on the column in schema.ts -- so a
-- rollback of the read-path swap has somewhere to land; a follow-up
-- migration drops it once the swap is verified.
--
-- Rollback: DROP TABLE "UserInviteLink"; ALTER TABLE "User" DROP COLUMN IF
-- EXISTS "joined_via_invite_link_id"; -- users.invite_token is untouched, so
-- the old read path (getOrCreateInviteToken/rotateInviteToken/resolveInviteLink
-- reading users.invite_token directly) still works if the app code is also
-- rolled back.

CREATE TABLE IF NOT EXISTS "UserInviteLink" (
  "id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
  "user_id" text NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
  "token" text NOT NULL,
  "slot" integer NOT NULL DEFAULT 0,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "UserInviteLink" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "UserInviteLink_token_key" ON "UserInviteLink" ("token");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "UserInviteLink_user_id_idx" ON "UserInviteLink" ("user_id");
--> statement-breakpoint
-- At most one LIVE link per named slot; slot 0 (untagged) is unrestricted, so
-- a user can hold several bio-style links alongside their tagged ones.
CREATE UNIQUE INDEX IF NOT EXISTS "UserInviteLink_user_id_slot_live_key"
  ON "UserInviteLink" ("user_id", "slot")
  WHERE "slot" <> 0 AND "deleted_at" IS NULL;
--> statement-breakpoint
-- Postgres has no ADD CONSTRAINT IF NOT EXISTS for a CHECK constraint, so this
-- is wrapped the same way the instrumentation.ts boot guard wraps it (and the
-- same pattern 0131's FK constraints use) -- required here because the guard
-- runs BEFORE migrate() on every boot and may have already created it.
DO $$ BEGIN
  ALTER TABLE "UserInviteLink"
    ADD CONSTRAINT "UserInviteLink_slot_range" CHECK ("slot" BETWEEN 0 AND 3);
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "joined_via_invite_link_id" text
    REFERENCES "UserInviteLink"("id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "User_joined_via_invite_link_id_idx"
  ON "User" ("joined_via_invite_link_id");
--> statement-breakpoint
INSERT INTO "UserInviteLink" ("id", "user_id", "token", "slot", "created_at")
SELECT gen_random_uuid()::text, "id", "invite_token", 0, COALESCE("created_at", now())
FROM "User"
WHERE "invite_token" IS NOT NULL
ON CONFLICT ("token") DO NOTHING;
