-- Migration: one-time "add two more areas" prompt dismissal flag.
--
-- Invite-seeded users start with up to three declared interests (the
-- inviter's pre-seeded suggestions). The app supports up to five active
-- interests, so the next time such a user plays we surface a one-time prompt
-- offering to top up to five. This nullable timestamp records that the prompt
-- was dismissed or completed, so it never reappears.
--
-- Additive nullable column — safe and non-destructive. An idempotent guard
-- mirroring this statement also lands in src/instrumentation.ts so a
-- preview/production database that records this migration without the column
-- actually present can still boot.
ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "area_top_up_prompt_dismissed_at" timestamptz;
