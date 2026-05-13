ALTER TABLE "FriendInvitation" ADD COLUMN IF NOT EXISTS "inviteeDisplayName" text;
ALTER TABLE "FriendInvitation" ADD COLUMN IF NOT EXISTS "cancelledAt" timestamp with time zone;
CREATE INDEX IF NOT EXISTS "FriendInvitation_inviteePhone_idx" ON "FriendInvitation" ("inviteePhone");
CREATE INDEX IF NOT EXISTS "FriendInvitation_inviterUserId_inviteePhone_idx" ON "FriendInvitation" ("inviterUserId", "inviteePhone");
