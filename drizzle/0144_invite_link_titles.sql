-- Creator-facing titles for managed invitation links. The column remains
-- nullable so links created before this migration keep their token, URL, and
-- attribution unchanged; application reads display "Your greatest hits" for
-- those legacy NULL values. All new creates and edits require a nonblank title.
ALTER TABLE "UserInviteLink"
  ADD COLUMN IF NOT EXISTS "title" text;
