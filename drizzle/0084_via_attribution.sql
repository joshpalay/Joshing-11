-- D-4 via-attribution — relay "via {source}" discovery on forwarded questions.
--
-- Adds two pieces the D-4 amendment specifies
-- (PRD-D-4-LATELY-MILESTONES-AND-PLUS2-REFRAME-SPEC.md, "Author + relay via"):
--
--   1. FeedItem.viaUserId — the user the FORWARDER got the question from (two
--      hops above the recipient). Stamped at forward time in /api/questions/send
--      as the forwarder's own sourceUserId; NULL when the forwarder authored the
--      question or received it organically. Drives the "via {source}" stranger-
--      discovery affordance. Nullable FK to User with ON DELETE SET NULL so a
--      deleted via-user cleanly drops the attribution rather than blocking the
--      delete. A covering index mirrors the 0079 treatment of the other FeedItem
--      FKs (so deleting a User doesn't seq-scan FeedItem).
--
--   2. User.discoverable_by_forward — the consent flag of the EXPOSED party that
--      gates the "via" exposure (D-2-style asymmetric gate). TEST-PHASE DEFAULT
--      true, mirroring discoverable_by_niche_match (0059); the production default
--      is an OPEN DECISION to revisit after the test. Additive boolean with a
--      DEFAULT — the safe case per CLAUDE.md (the default applies to every
--      existing row, no backfill pass needed).
--
-- All statements are additive and idempotent. No CONCURRENTLY: the runtime
-- migrator wraps statements in a transaction (matching every other index
-- migration here). Mirrored by a defensive guard in src/instrumentation.ts
-- (precedent: 0080) so a preview/production DB that records this migration
-- without the columns present still gets them on next boot.
--
-- Rollback:
--   DROP INDEX IF EXISTS "FeedItem_viaUserId_idx";
--   ALTER TABLE "FeedItem" DROP CONSTRAINT IF EXISTS "FeedItem_viaUserId_User_id_fk";
--   ALTER TABLE "FeedItem" DROP COLUMN IF EXISTS "viaUserId";
--   ALTER TABLE "User" DROP COLUMN IF EXISTS "discoverable_by_forward";

ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "discoverable_by_forward" boolean NOT NULL DEFAULT true;

ALTER TABLE "FeedItem"
  ADD COLUMN IF NOT EXISTS "viaUserId" text;

DO $$ BEGIN
  ALTER TABLE "FeedItem" ADD CONSTRAINT "FeedItem_viaUserId_User_id_fk"
    FOREIGN KEY ("viaUserId") REFERENCES "public"."User"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE INDEX IF NOT EXISTS "FeedItem_viaUserId_idx" ON "FeedItem" ("viaUserId");
