-- Each managed invite link now owns its recommendation set. NULL preserves
-- the legacy slot-based resolver for links created before this migration;
-- once a creator edits one, the exact corrected set is written here.
ALTER TABLE "UserInviteLink"
  ADD COLUMN IF NOT EXISTS "categories" jsonb;
