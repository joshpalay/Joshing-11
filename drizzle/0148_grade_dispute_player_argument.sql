-- "Argue your point" (B-ARGUE-01): lets a player attach a short, optional
-- written case (<=300 chars, enforced client + server side) to a recheck
-- instead of a bare "recheck this" tap.
--
-- WHY A COLUMN ON GradeDispute RATHER THAN A NEW TABLE. Every recheck already
-- writes exactly one GradeDispute row (grade-disputes.ts / the four recheck
-- routes). An argument is 1:1 with that same event -- it's the reason the
-- player gave for filing it -- so it belongs on the row it rode in on, not a
-- side table that would need its own FK and its own join everywhere the
-- dispute is read (the admin queue, the review scripts).
--
-- NULLABLE, no default: a plain recheck (no argument typed -- the textarea is
-- optional) and every dispute row written before this shipped both mean "no
-- argument was made", which NULL represents exactly. Never backfilled.
--
-- Rollback:
--   ALTER TABLE "GradeDispute" DROP COLUMN IF EXISTS "player_argument";

ALTER TABLE "GradeDispute"
  ADD COLUMN IF NOT EXISTS "player_argument" text;
