-- Migration: add editable profile fields (bio, tagline, location).
--
-- Today /account renders an auto-generated "mind statement" as the bio
-- (computed via formatBio() in src/server/profile/bio.ts from the user's
-- top mastery domains + declared interests). This migration introduces
-- a user-editable bio column alongside two new short-form fields:
-- tagline (≤80 chars) and location (≤60 chars).
--
-- All three are nullable; when bio is NULL the existing formatBio()
-- default continues to render, so existing users see no change.
--
-- Idempotent guards are also pre-applied in src/instrumentation.ts for
-- preview/production databases that may have this migration recorded
-- without the columns actually present.
ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "bio" text;
--> statement-breakpoint
ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "tagline" text;
--> statement-breakpoint
ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "location" text;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_schema = 'public'
      AND table_name = 'User'
      AND constraint_name = 'user_bio_length'
  ) THEN
    ALTER TABLE "User"
      ADD CONSTRAINT user_bio_length CHECK (char_length("bio") <= 280);
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_schema = 'public'
      AND table_name = 'User'
      AND constraint_name = 'user_tagline_length'
  ) THEN
    ALTER TABLE "User"
      ADD CONSTRAINT user_tagline_length CHECK (char_length("tagline") <= 80);
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_schema = 'public'
      AND table_name = 'User'
      AND constraint_name = 'user_location_length'
  ) THEN
    ALTER TABLE "User"
      ADD CONSTRAINT user_location_length CHECK (char_length("location") <= 60);
  END IF;
END $$;
