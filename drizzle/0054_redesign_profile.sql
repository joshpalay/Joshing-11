-- Migration: redesign of the profile + section-visibility surface.
--
-- Three changes in one file:
--
--   1. Add a new 'knowledge_base' value to the ProfileSection enum. It
--      collapses the previously-separate 'knowledge_map' and
--      'mind_expanding' sections into a single toggle that gates the
--      whole Knowledge base block on the profile.
--
--   2. Backfill PROFILE_SECTION_VISIBILITY rows for the new
--      'knowledge_base' section from each user's existing 'knowledge_map'
--      / 'mind_expanding' rows. The most-restrictive of the two wins
--      (private > friends > public) so we never accidentally widen
--      visibility during the consolidation.
--
--   3. Drop the User.bio, User.tagline, and User.location columns plus
--      their length CHECKs. These editable text fields were removed from
--      the redesigned profile — the auto-generated "a mind that is
--      into …" statement now serves as the tagline, and bio/location
--      are gone entirely.
--
-- Idempotent guards mirroring this migration also land in
-- src/instrumentation.ts so preview/production databases that may have
-- the migration recorded without the pieces actually present can still
-- boot. Postgres does not allow dropping individual enum values, so the
-- legacy 'bio', 'tagline', 'location', 'knowledge_map', and
-- 'mind_expanding' values remain in the enum type as zombies — no app
-- code references them after this migration.
ALTER TYPE "public"."ProfileSection" ADD VALUE IF NOT EXISTS 'knowledge_base';
--> statement-breakpoint
-- Backfill: collapse knowledge_map + mind_expanding into knowledge_base.
-- More-restrictive visibility wins so we never widen access.
INSERT INTO "PROFILE_SECTION_VISIBILITY" ("user_id", "section", "visibility", "updated_at")
SELECT
  "user_id",
  'knowledge_base'::"public"."ProfileSection",
  CASE
    WHEN bool_or("visibility" = 'private') THEN 'private'
    WHEN bool_or("visibility" = 'friends') THEN 'friends'
    ELSE 'public'
  END,
  NOW()
FROM "PROFILE_SECTION_VISIBILITY"
WHERE "section" IN ('knowledge_map', 'mind_expanding')
GROUP BY "user_id"
ON CONFLICT ("user_id", "section") DO NOTHING;
--> statement-breakpoint
-- Delete the now-unused per-section rows. The bio/tagline/location rows
-- are deleted alongside the column drops since the underlying data is
-- gone anyway.
DELETE FROM "PROFILE_SECTION_VISIBILITY"
WHERE "section" IN ('bio', 'tagline', 'location', 'knowledge_map', 'mind_expanding');
--> statement-breakpoint
ALTER TABLE "User" DROP CONSTRAINT IF EXISTS "user_bio_length";
--> statement-breakpoint
ALTER TABLE "User" DROP CONSTRAINT IF EXISTS "user_tagline_length";
--> statement-breakpoint
ALTER TABLE "User" DROP CONSTRAINT IF EXISTS "user_location_length";
--> statement-breakpoint
ALTER TABLE "User" DROP COLUMN IF EXISTS "bio";
--> statement-breakpoint
ALTER TABLE "User" DROP COLUMN IF EXISTS "tagline";
--> statement-breakpoint
ALTER TABLE "User" DROP COLUMN IF EXISTS "location";
