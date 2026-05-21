-- Data backfill — repair rows where canonical_subcategory landed as a 1–2 char
-- fragment due to the categorizer truncating abbreviations (`Mr. Hooper` → `Mr`)
-- or picking a leading single capital letter (`A loaf of bread...` → `A`).
--
-- In the affected database both bad labels happen to belong to Sesame Street
-- questions Robyn authored, so we consolidate them under one "Sesame Street"
-- territory in Film & Television. Mastery points are summed when a user has
-- both rows. The categorizer + write-boundary fixes in this same change ensure
-- new questions can't land here again.
--
-- Idempotent: after a successful run there are no rows with canonical_subcategory
-- in ('Mr', 'A'), so subsequent boots are no-ops.

BEGIN;

-- 1. Question — rename canonical/sub/broad/category on the two authored rows.
UPDATE "Question"
SET canonical_subcategory = 'Sesame Street',
    subcategory = 'Sesame Street',
    broad_category = 'Film & Television',
    category = 'film_tv',
    updated_at = NOW()
WHERE id IN (
  '43a93612-81cb-4998-af96-bd7433d544d6',
  'b1f075d1-e9c7-4439-87f9-73224293f3bc'
)
  AND canonical_subcategory IN ('Mr', 'A');

-- 2. MASTERY_EVENTS — every event under the broken labels gets rewritten.
UPDATE "MASTERY_EVENTS"
SET canonical_subcategory = 'Sesame Street'
WHERE canonical_subcategory IN ('Mr', 'A');

-- 3. PLAYER_MASTERY — for each user, sum points from any 'Mr' and/or 'A' rows
--    into a single 'Sesame Street' row, then delete the originals. ON CONFLICT
--    keeps this safe if a 'Sesame Street' row already exists for the user
--    (sums into the existing row instead of erroring on the unique constraint).
INSERT INTO "PLAYER_MASTERY" (user_id, canonical_subcategory, broad_category, total_points)
SELECT user_id, 'Sesame Street', 'Film & Television', SUM(total_points)
FROM "PLAYER_MASTERY"
WHERE canonical_subcategory IN ('Mr', 'A')
GROUP BY user_id
ON CONFLICT (user_id, canonical_subcategory) DO UPDATE
  SET total_points = "PLAYER_MASTERY".total_points + EXCLUDED.total_points,
      broad_category = 'Film & Television',
      updated_at = NOW();

DELETE FROM "PLAYER_MASTERY"
WHERE canonical_subcategory IN ('Mr', 'A');

COMMIT;
