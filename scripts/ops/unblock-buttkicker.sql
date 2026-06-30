-- One-off ops fix — NOT a migration, do not add to drizzle/.
-- Run against a WRITABLE prod connection (Supabase SQL editor, or psql with the
-- service-role DATABASE_URL). The Supabase MCP connection is read-only and will
-- reject these UPDATEs.
--
-- Context: user "Buttkicker" (70476cf6-f9ef-47ae-816a-47652be057d4) cannot load
-- the Daily Five. Two compounding causes:
--   1. A duplicate "Tears of the Kingdom" territory (declared
--      "Tears of the Kingdom - the Legend of Zelda" vs demonstrated
--      "The Legend of Zelda: Tears of the Kingdom") — plus a case-only duplicate
--      of the history domain — fragmenting the palette and difficulty.
--   2. Adaptive difficulty ratcheted the narrow custom palette to `specialist`,
--      a tier the generator returns ~0 questions for (0-1 usable in ~70s), so
--      every build falls below the floor of 3 and 503s.
-- This merges the duplicates and steps the specialist ratchet back to moderate.

begin;

-- 1. Repoint duplicate demonstrated mastery events onto the canonical territory.
update "MASTERY_EVENTS"
   set canonical_subcategory = 'Tears of the Kingdom - the Legend of Zelda'
 where user_id = '70476cf6-f9ef-47ae-816a-47652be057d4'
   and canonical_subcategory = 'The Legend of Zelda: Tears of the Kingdom';

update "MASTERY_EVENTS"
   set canonical_subcategory = 'Early 20th Century American History'
 where user_id = '70476cf6-f9ef-47ae-816a-47652be057d4'
   and canonical_subcategory = 'Early 20th century American History';

-- 2. Fold the duplicate territories' points into the kept canonical rows.
update "PLAYER_MASTERY" k
   set total_points = k.total_points + d.total_points, updated_at = now()
  from "PLAYER_MASTERY" d
 where k.user_id = d.user_id
   and k.user_id = '70476cf6-f9ef-47ae-816a-47652be057d4'
   and k.canonical_subcategory = 'Tears of the Kingdom - the Legend of Zelda'
   and d.canonical_subcategory = 'The Legend of Zelda: Tears of the Kingdom';

update "PLAYER_MASTERY" k
   set total_points = k.total_points + d.total_points, updated_at = now()
  from "PLAYER_MASTERY" d
 where k.user_id = d.user_id
   and k.user_id = '70476cf6-f9ef-47ae-816a-47652be057d4'
   and k.canonical_subcategory = 'Early 20th Century American History'
   and d.canonical_subcategory = 'Early 20th century American History';

-- 3. Delete the duplicate territory rows + the dupe's split difficulty row.
delete from "PLAYER_MASTERY"
 where user_id = '70476cf6-f9ef-47ae-816a-47652be057d4'
   and canonical_subcategory in ('The Legend of Zelda: Tears of the Kingdom',
                                 'Early 20th century American History');

delete from "USER_DOMAIN_DIFFICULTY"
 where user_id = '70476cf6-f9ef-47ae-816a-47652be057d4'
   and canonical_subcategory = 'The Legend of Zelda: Tears of the Kingdom';

-- 4. Unblock generation: step the specialist ratchet in the active palette back to
--    moderate (the tier that generated fine before the 06-26 ratchet) and reset the
--    streaks so the next correct answer doesn't immediately re-ratchet.
update "USER_DOMAIN_DIFFICULTY"
   set served_difficulty = 'moderate', consecutive_correct = 0,
       consecutive_incorrect = 0, last_updated = now()
 where user_id = '70476cf6-f9ef-47ae-816a-47652be057d4'
   and canonical_subcategory in ('Tennis Fundamentals',
                                 'Tears of the Kingdom - the Legend of Zelda')
   and served_difficulty = 'specialist';

-- 5. De-duplicate the custom palette (selected_domains + frequency map).
update "DailyPreference"
   set selected_domains = (
         select jsonb_agg(e)
         from jsonb_array_elements(selected_domains) e
         where e <> '"The Legend of Zelda: Tears of the Kingdom"'::jsonb
       ),
       domain_preference_frequency =
         domain_preference_frequency - 'The Legend of Zelda: Tears of the Kingdom',
       updated_at = now()
 where user_id = '70476cf6-f9ef-47ae-816a-47652be057d4';

-- Sanity check before committing — expect 5 distinct territories, no dupes,
-- and no specialist tier left in the active palette.
select canonical_subcategory, broad_category, total_points
  from "PLAYER_MASTERY"
 where user_id = '70476cf6-f9ef-47ae-816a-47652be057d4'
 order by total_points desc;

commit;
