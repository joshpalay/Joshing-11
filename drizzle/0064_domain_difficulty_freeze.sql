-- Migration: add USER_DOMAIN_DIFFICULTY.freeze_until for the "Ease off" action.
--
-- Refine Your Game's difficulty_escalation item lets a player freeze a
-- subdomain's served difficulty at its current level for 30 days. freeze_until
-- holds the timestamp the freeze lapses; while it is in the future,
-- updateDomainDifficultyOnAnswer() (src/server/adaptive-difficulty.ts) must not
-- step the served difficulty up or down. NULL means "no freeze" (normal
-- adaptive behavior).
--
-- Additive nullable column — the safe case. Idempotent guard is also
-- pre-applied in src/instrumentation.ts for preview/production databases that
-- may have this migration recorded without the column present.
ALTER TABLE "USER_DOMAIN_DIFFICULTY"
  ADD COLUMN IF NOT EXISTS "freeze_until" timestamp with time zone;
