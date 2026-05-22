-- Data backfill — declared interests are supposed to seed a zero-point
-- PlayerMastery row so the daily-answer route's "bot questions can only
-- deepen existing territories" guard doesn't fire on a user's first daily
-- in a freshly-declared domain. The save-interests path was missing this
-- write; users who onboarded before this fix have orphaned DeclaredInterest
-- rows with no matching PlayerMastery row. Seed them now.
--
-- Idempotent: the ON CONFLICT clause is a no-op when a row already exists.

INSERT INTO "PLAYER_MASTERY" (user_id, canonical_subcategory, broad_category, total_points, tier, season_points_start, territory_type)
SELECT
  d."userId",
  d.domain,
  d."broadCategory",
  0,
  'establishing'::"MasteryTier",
  0,
  'declared'
FROM "DeclaredInterest" d
LEFT JOIN "PLAYER_MASTERY" pm
  ON pm.user_id = d."userId"
  AND pm.canonical_subcategory = d.domain
WHERE d."isActive" = true
  AND pm.id IS NULL
ON CONFLICT (user_id, canonical_subcategory) DO NOTHING;
