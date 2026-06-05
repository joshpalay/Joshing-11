ALTER TABLE "DailyPreference"
  ADD COLUMN IF NOT EXISTS "domain_preference_frequency" jsonb NOT NULL DEFAULT '{}'::jsonb;
