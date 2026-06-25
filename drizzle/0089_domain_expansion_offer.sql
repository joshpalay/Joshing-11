-- Migration: add USER_DOMAIN_DIFFICULTY.expansion_eligible_since and
-- .expansion_offered_at for the post-daily-Five "you're crushing X — branch out?"
-- expansion offer.
--
-- When the daily orchestrator has to serve a domain BELOW the tier the player has
-- climbed to (Part 2's supply-side correction in src/server/adaptive-difficulty.ts)
-- and that climb topped the ladder, the player has out-leveled the domain's
-- available content — exactly the moment to offer adjacent domains. The cron sets
-- expansion_eligible_since; the daily summary surfaces the offer while it is set
-- and expansion_offered_at is still NULL; accepting or dismissing the offer stamps
-- expansion_offered_at so it shows once. Both NULL = normal (no pending offer).
--
-- Two additive nullable columns — the safe case. Idempotent guards are also
-- pre-applied in src/instrumentation.ts for preview/production databases that may
-- have this migration recorded without the columns present.
ALTER TABLE "USER_DOMAIN_DIFFICULTY"
  ADD COLUMN IF NOT EXISTS "expansion_eligible_since" timestamp with time zone;

ALTER TABLE "USER_DOMAIN_DIFFICULTY"
  ADD COLUMN IF NOT EXISTS "expansion_offered_at" timestamp with time zone;
