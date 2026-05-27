-- Migration: PROFILE_SECTION_VISIBILITY table + QuestionVisibility 'friends' tier.
--
-- Two pieces in one file:
--
--   1. Extend QuestionVisibility enum with a 'friends' value so authored
--      questions can be friends-only (matching the three-tier model already
--      used by PROFILE_DOMAIN_VISIBILITY).
--
--   2. PROFILE_SECTION_VISIBILITY table — one row per (user_id, section) with
--      visibility in ('public', 'friends', 'private'). Modeled on the existing
--      PROFILE_DOMAIN_VISIBILITY shape. Sections covered: bio, tagline,
--      location, knowledge_map, mind_expanding, friends_list,
--      authored_questions. Backfilled from the legacy User.portrait_visibility
--      (-> knowledge_map) and User.authorProfilePublic (-> authored_questions)
--      columns. Both legacy columns remain in place until Phase 6 ships the
--      drop migration so the legacy code path can be rolled back if needed.
--
-- Idempotent guards mirroring this migration also land in
-- src/instrumentation.ts so preview/production databases that may have the
-- migration recorded without the pieces actually present can still boot.
ALTER TYPE "public"."QuestionVisibility" ADD VALUE IF NOT EXISTS 'friends';
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "public"."ProfileSection" AS ENUM(
    'bio', 'tagline', 'location',
    'knowledge_map', 'mind_expanding',
    'friends_list', 'authored_questions'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "PROFILE_SECTION_VISIBILITY" (
  "id"          text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "user_id"     text NOT NULL,
  "section"     "public"."ProfileSection" NOT NULL,
  "visibility"  text NOT NULL DEFAULT 'public',
  "updated_at"  timestamptz NOT NULL DEFAULT NOW(),
  CONSTRAINT "PROFILE_SECTION_VISIBILITY_visibility_check"
    CHECK ("visibility" IN ('public', 'friends', 'private'))
);
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'PROFILE_SECTION_VISIBILITY_user_id_User_id_fk'
      AND conrelid = to_regclass('public."PROFILE_SECTION_VISIBILITY"')
  ) THEN
    ALTER TABLE "PROFILE_SECTION_VISIBILITY"
      ADD CONSTRAINT "PROFILE_SECTION_VISIBILITY_user_id_User_id_fk"
      FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'PROFILE_SECTION_VISIBILITY_user_id_section_key'
      AND conrelid = to_regclass('public."PROFILE_SECTION_VISIBILITY"')
  ) THEN
    ALTER TABLE "PROFILE_SECTION_VISIBILITY"
      ADD CONSTRAINT "PROFILE_SECTION_VISIBILITY_user_id_section_key"
      UNIQUE ("user_id", "section");
  END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "PROFILE_SECTION_VISIBILITY_user_id_idx"
  ON "PROFILE_SECTION_VISIBILITY" ("user_id");
--> statement-breakpoint
-- Backfill: User.portrait_visibility -> knowledge_map section
INSERT INTO "PROFILE_SECTION_VISIBILITY" ("user_id", "section", "visibility", "updated_at")
SELECT "id",
       'knowledge_map'::"public"."ProfileSection",
       CASE "portrait_visibility"::text WHEN 'public' THEN 'public' ELSE 'private' END,
       NOW()
FROM "User"
ON CONFLICT ("user_id", "section") DO NOTHING;
--> statement-breakpoint
-- Backfill: User.authorProfilePublic -> authored_questions section
INSERT INTO "PROFILE_SECTION_VISIBILITY" ("user_id", "section", "visibility", "updated_at")
SELECT "id",
       'authored_questions'::"public"."ProfileSection",
       CASE WHEN "authorProfilePublic" THEN 'public' ELSE 'private' END,
       NOW()
FROM "User"
ON CONFLICT ("user_id", "section") DO NOTHING;
