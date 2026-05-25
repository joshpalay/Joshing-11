-- Migration: drop the legacy User.portrait_visibility and
-- User.authorProfilePublic columns + the now-unused PortraitVisibility
-- enum type.
--
-- Phase 6 of the unified-profile + per-section-visibility rollout. The
-- replacements have been the authoritative source of truth since phase
-- 2 (PROFILE_SECTION_VISIBILITY rows backfilled in 0052):
--
--   User.portrait_visibility    -> PROFILE_SECTION_VISIBILITY (knowledge_map)
--   User.authorProfilePublic    -> PROFILE_SECTION_VISIBILITY (authored_questions)
--
-- No application code reads either column after this migration —
-- src/server/db/queries/account.ts, src/server/db/queries/questions.ts,
-- and src/server/profile/friend.ts all dropped their references in this
-- same commit, and src/server/db/schema.ts removed both columns + the
-- enum from the Drizzle schema definition.
--
-- IF EXISTS guards make this idempotent so preview/production DBs that
-- somehow already dropped one piece (manual hotfix, prior rollback) can
-- still finish the migration cleanly.
ALTER TABLE "User" DROP COLUMN IF EXISTS "portrait_visibility";
--> statement-breakpoint
ALTER TABLE "User" DROP COLUMN IF EXISTS "authorProfilePublic";
--> statement-breakpoint
DROP TYPE IF EXISTS "public"."PortraitVisibility";
