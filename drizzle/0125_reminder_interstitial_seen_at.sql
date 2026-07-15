-- 0125: reminder_interstitial_seen_at on User (D-REMINDER-INTERSTITIAL-01).
--
-- The one-time, full-screen email-reminder interstitial fires on exit from the
-- daily summary. This column records that a player has been shown it, so it
-- fires at most once per account — stamped on BOTH outcomes (sign up AND skip).
--
-- It is deliberately SEPARATE from reminder_prompt_dismissed_at (Decision D):
-- skipping the interstitial means "not now", NOT "never". Skip writes only this
-- column; the standing inline RoundReminderCard keeps rendering, and only its
-- explicit "No thanks" writes reminder_prompt_dismissed_at. One column cannot
-- express both states, which is why this second column exists.
--
-- Additive + nullable → existing rows keep NULL (never shown the interstitial)
-- and are unaffected. Mirrored by a defensive guard in src/instrumentation.ts
-- (precedent: the 0124 rest_until guard on this same boot chain).
--
-- Rollback:
--   ALTER TABLE "User" DROP COLUMN IF EXISTS "reminder_interstitial_seen_at";
ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "reminder_interstitial_seen_at" timestamp with time zone;
